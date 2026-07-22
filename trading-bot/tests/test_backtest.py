"""Tests for the backtesting engine.

Method: instead of feeding real market data (where nothing is verifiable by
hand), we hand-build tiny signal DataFrames where we know exactly what the
simulator must do, and check the resulting P&L to the cent.
"""

import numpy as np
import pandas as pd
import pytest

from bot.backtest import BacktestParams, PERIODS_PER_YEAR, compute_metrics, run_backtest

IDX = lambda n: pd.date_range("2024-01-01", periods=n, freq="4h", tz="UTC")  # noqa: E731


def frame(rows):
    """rows: list of dicts with o/h/l/c and optional signal/stop/target/exits."""
    n = len(rows)
    df = pd.DataFrame({
        "open": [r["o"] for r in rows],
        "high": [r["h"] for r in rows],
        "low": [r["l"] for r in rows],
        "close": [r["c"] for r in rows],
        "signal": [r.get("sig", 0) for r in rows],
        "stop_price": [r.get("stop", np.nan) for r in rows],
        "target_price": [r.get("tgt", np.nan) for r in rows],
        "exit_long": [r.get("xl", False) for r in rows],
        "exit_short": [r.get("xs", False) for r in rows],
    }, index=IDX(n))
    return df


def quiet(o=100.0):
    """A candle where nothing happens, well away from stops/targets."""
    return {"o": o, "h": o + 0.5, "l": o - 0.5, "c": o}


# Zero-cost params: isolate the trade mechanics from fees/slippage.
FREE = BacktestParams(initial_equity=1000.0, fee_pct=0.0, slippage_pct=0.0,
                      risk_per_trade_pct=1.0, max_leverage=2.0)


def test_long_target_hit_risk_math_exact():
    """Signal on candle 1 → fill at candle 2's open (100). Stop 90 (dist 10),
    so risking 1% of 1000 = 10 USDT → size exactly 1.0 unit. Candle 4 hits
    the 115 target → profit (115-100)×1 = 15 → equity 1015. Every number
    hand-checkable."""
    df = frame([
        quiet(),
        {**quiet(), "sig": 1, "stop": 90.0, "tgt": 115.0},
        quiet(100.0),                                   # entry candle
        quiet(101.0),
        {"o": 101, "h": 116, "l": 100, "c": 114},        # target touched
        quiet(114.0),
    ])
    res = run_backtest(df, params=FREE)

    assert len(res.trades) == 1
    t = res.trades[0]
    assert t.entry_price == 100.0                       # next candle's open
    assert t.size == pytest.approx(1.0)                 # 10 risk / 10 stop-dist
    assert t.exit_reason == "target"
    assert t.exit_price == 115.0
    assert t.net_pnl == pytest.approx(15.0)
    assert res.equity.iloc[-1] == pytest.approx(1015.0)


def test_long_stop_hit_loses_exactly_the_risked_percent():
    """Same setup, but price collapses: loss must be exactly the 1% risked
    (10 USDT) — the position-sizing promise, verified."""
    df = frame([
        quiet(),
        {**quiet(), "sig": 1, "stop": 90.0, "tgt": 115.0},
        quiet(100.0),
        {"o": 99, "h": 99.5, "l": 89, "c": 90.5},        # stop touched
        quiet(90.0),
    ])
    res = run_backtest(df, params=FREE)
    t = res.trades[0]
    assert t.exit_reason == "stop"
    assert t.net_pnl == pytest.approx(-10.0)
    assert res.equity.iloc[-1] == pytest.approx(990.0)


def test_stop_and_target_same_candle_assumes_stop():
    """The worst-case tie-break: candle spans BOTH levels → count the loss."""
    df = frame([
        quiet(),
        {**quiet(), "sig": 1, "stop": 90.0, "tgt": 115.0},
        quiet(100.0),
        {"o": 100, "h": 120, "l": 85, "c": 110},         # touches both!
        quiet(110.0),
    ])
    res = run_backtest(df, params=FREE)
    assert res.trades[0].exit_reason == "stop"
    assert res.trades[0].net_pnl == pytest.approx(-10.0)


def test_short_mechanics_mirror_longs():
    """Short at 100, stop 110 (dist 10 → size 1), target 85 hit → +15."""
    df = frame([
        quiet(),
        {**quiet(), "sig": -1, "stop": 110.0, "tgt": 85.0},
        quiet(100.0),
        {"o": 99, "h": 100, "l": 84, "c": 86},           # target (below) touched
        quiet(86.0),
    ])
    res = run_backtest(df, params=FREE)
    t = res.trades[0]
    assert t.side == -1
    assert t.exit_reason == "target"
    assert t.net_pnl == pytest.approx(15.0)


def test_fees_charged_on_both_fills():
    """fee 0.1%: entry fee = 0.1% × (100×1) = 0.10; exit at target 115 →
    0.1% × 115 = 0.115. Net = 15 − 0.215."""
    params = BacktestParams(initial_equity=1000.0, fee_pct=0.1, slippage_pct=0.0)
    df = frame([
        quiet(),
        {**quiet(), "sig": 1, "stop": 90.0, "tgt": 115.0},
        quiet(100.0),
        {"o": 101, "h": 116, "l": 100, "c": 114},
        quiet(114.0),
    ])
    res = run_backtest(df, params=params)
    t = res.trades[0]
    assert t.fees == pytest.approx(0.10 + 0.115)
    assert t.net_pnl == pytest.approx(15.0 - 0.215)


def test_slippage_worsens_entry_fill():
    """1% slippage on a long: see price 100, actually fill at 101."""
    params = BacktestParams(initial_equity=1000.0, fee_pct=0.0, slippage_pct=1.0)
    df = frame([
        quiet(),
        {**quiet(), "sig": 1, "stop": 90.0, "tgt": 115.0},
        quiet(100.0),
        quiet(100.0),
    ])
    res = run_backtest(df, params=params)
    # Position force-closed at end of data; check the entry price itself.
    assert res.trades[0].entry_price == pytest.approx(101.0)


def test_funding_costs_long_and_pays_short():
    """One funding event of +0.01% while the position is open. Long with
    notional 100 → pays 0.01; a short would RECEIVE it."""
    fund = pd.DataFrame(
        {"funding_rate": [0.0001]},
        index=pd.DatetimeIndex([IDX(6)[3]]),  # event during the open trade
    )
    df = frame([
        quiet(),
        {**quiet(), "sig": 1, "stop": 90.0, "tgt": 115.0},
        quiet(100.0),
        quiet(100.0),
        {"o": 101, "h": 116, "l": 100, "c": 114},
        quiet(114.0),
    ])
    res = run_backtest(df, funding=fund, params=FREE)
    assert res.trades[0].funding == pytest.approx(0.01)     # long paid
    assert res.trades[0].net_pnl == pytest.approx(15.0 - 0.01)

    df_short = frame([
        quiet(),
        {**quiet(), "sig": -1, "stop": 110.0, "tgt": 85.0},
        quiet(100.0),
        quiet(100.0),
        {"o": 99, "h": 100, "l": 84, "c": 86},
        quiet(86.0),
    ])
    res2 = run_backtest(df_short, funding=fund, params=FREE)
    assert res2.trades[0].funding == pytest.approx(-0.01)   # short received


def test_trend_flip_exits_at_next_open():
    df = frame([
        quiet(),
        {**quiet(), "sig": 1, "stop": 90.0, "tgt": 130.0},
        quiet(100.0),
        {**quiet(105.0), "xl": True},   # flip detected at this close
        {"o": 104, "h": 104.5, "l": 103.5, "c": 104},   # exit here at open
        quiet(104.0),
    ])
    res = run_backtest(df, params=FREE)
    t = res.trades[0]
    assert t.exit_reason == "trend_flip"
    assert t.exit_price == pytest.approx(104.0)


def test_leverage_cap_shrinks_oversized_positions():
    """Stop only 0.1 away → naive size = 10/0.1 = 100 units = 10,000 notional
    = 10× leverage on 1,000 equity. Cap (2×) must shrink it to 20 units."""
    df = frame([
        quiet(),
        {**quiet(), "sig": 1, "stop": 99.9, "tgt": 115.0},
        quiet(100.0),
        quiet(100.0),
    ])
    res = run_backtest(df, params=FREE)
    assert res.trades[0].size == pytest.approx(20.0)    # 2×1000 / 100


def test_signals_ignored_while_position_open():
    df = frame([
        quiet(),
        {**quiet(), "sig": 1, "stop": 90.0, "tgt": 130.0},
        quiet(100.0),
        {**quiet(101.0), "sig": 1, "stop": 91.0, "tgt": 131.0},  # must be ignored
        quiet(102.0),
        quiet(103.0),
    ])
    res = run_backtest(df, params=FREE)
    assert len(res.trades) == 1                          # not two


def test_open_position_closed_at_end_of_data():
    df = frame([
        quiet(),
        {**quiet(), "sig": 1, "stop": 90.0, "tgt": 130.0},
        quiet(100.0),
        quiet(102.0),
    ])
    res = run_backtest(df, params=FREE)
    assert res.trades[0].exit_reason == "end_of_data"
    assert res.trades[0].exit_price == pytest.approx(102.0)


def test_no_signals_no_trades_no_crash():
    res = run_backtest(frame([quiet()] * 5), params=FREE)
    assert res.trades == []
    assert (res.equity == 1000.0).all()
    m = compute_metrics(res, PERIODS_PER_YEAR["4h"])
    assert m["trade_count"] == 0
    assert m["total_return_pct"] == pytest.approx(0.0)


def test_params_enforce_safety_rails():
    with pytest.raises(ValueError, match="accounts die"):
        BacktestParams(risk_per_trade_pct=5.0)          # >2% risk refused
    with pytest.raises(ValueError, match="max_leverage"):
        BacktestParams(max_leverage=10.0)               # >3× leverage refused


def test_metrics_hand_computed():
    """Equity 1000→1100→990→1089: max drawdown is the 1100→990 fall = -10%.
    Two trades +100/-110 → win rate 50%, profit factor 100/110."""
    res = run_backtest(frame([quiet()] * 4), params=FREE)  # shell result
    res.equity = pd.Series([1000.0, 1100.0, 990.0, 1089.0], index=IDX(4))

    class T:  # minimal stand-in trades
        def __init__(self, pnl):
            self.net_pnl, self.fees, self.funding = pnl, 0.0, 0.0
    res.trades = [T(100.0), T(-110.0)]

    m = compute_metrics(res, PERIODS_PER_YEAR["4h"])
    assert m["max_drawdown_pct"] == pytest.approx(-10.0)
    assert m["win_rate_pct"] == pytest.approx(50.0)
    assert m["profit_factor"] == pytest.approx(100.0 / 110.0)
    assert m["total_return_pct"] == pytest.approx(8.9)
    assert m["longest_loss_streak"] == 1
