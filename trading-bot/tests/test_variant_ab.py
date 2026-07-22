"""Tests for strategy variant A+B: breakout entries + trailing exits."""

import numpy as np
import pandas as pd
import pytest

from bot.backtest import BacktestParams, run_backtest
from bot.strategy import LONG, SHORT, StrategyParams, explain_row, generate_signals
from tests.test_strategy import make_df

VARIANT = StrategyParams(
    ema_fast=3, ema_slow=6, rsi_period=3, atr_period=3,
    entry_mode="breakout", breakout_lookback=4,
    exit_mode="trailing", trail_atr_mult=2.0,
)


# ---------------------------------------------------------------------- #
# Params validation
# ---------------------------------------------------------------------- #
def test_modes_validated():
    with pytest.raises(ValueError, match="entry_mode"):
        StrategyParams(entry_mode="vibes")
    with pytest.raises(ValueError, match="exit_mode"):
        StrategyParams(exit_mode="hope")
    with pytest.raises(ValueError, match="breakout_lookback"):
        StrategyParams(breakout_lookback=1)
    with pytest.raises(ValueError, match="trail_atr_mult"):
        StrategyParams(trail_atr_mult=0)


def test_min_rr_check_skipped_for_trailing_only():
    """1:1 target/stop is refused with a fixed target (v1 rule) but fine in
    trailing mode, where reward isn't capped so no ratio exists to check."""
    with pytest.raises(ValueError, match="Reward-to-risk"):
        StrategyParams(atr_target_mult=2.0, atr_stop_mult=2.0)
    StrategyParams(atr_target_mult=2.0, atr_stop_mult=2.0, exit_mode="trailing")


# ---------------------------------------------------------------------- #
# Breakout entries
# ---------------------------------------------------------------------- #
def test_breakout_long_fires_on_new_high_in_uptrend():
    """Rise, 4 flat candles (forming a channel), then a candle closing above
    all of them → breakout long, with a stop but no fixed target."""
    prices = [100 + 2 * i for i in range(10)] + [118, 118, 118, 118] + [125]
    result = generate_signals(make_df(prices), VARIANT)

    last = result.iloc[-1]
    assert last["signal"] == LONG
    assert last["stop_price"] == pytest.approx(last["close"] - 2.0 * last["atr"])
    assert np.isnan(last["target_price"])       # trailing mode: no fixed target


def test_no_breakout_without_new_extreme():
    """Flat channel, close inside it → silence."""
    prices = [100 + 2 * i for i in range(10)] + [118] * 6
    result = generate_signals(make_df(prices), VARIANT)
    assert (result["signal"].iloc[-5:] == 0).all()


def test_breakout_short_needs_downtrend_and_new_low():
    prices = [200 - 2 * i for i in range(12)] + [178, 178, 178, 178] + [170]
    result = generate_signals(make_df(prices), VARIANT)
    last = result.iloc[-1]
    assert last["signal"] == SHORT
    assert not last["uptrend"]


def test_breakout_against_trend_is_ignored():
    """New high while EMAs still say downtrend → no long. The trend filter
    outranks the trigger in every mode."""
    prices = [200 - 4 * i for i in range(12)] + [155, 158, 161, 164, 168]
    result = generate_signals(make_df(prices), VARIANT)
    in_down = result[~result["uptrend"]]
    assert (in_down["signal"] != LONG).all()


def test_explain_row_describes_breakout_and_trailing():
    prices = [100 + 2 * i for i in range(10)] + [118, 118, 118, 118] + [125]
    result = generate_signals(make_df(prices), VARIANT)
    text = explain_row(result.iloc[-1], VARIANT)
    assert "highest close" in text
    assert "trailing stop" in text


# ---------------------------------------------------------------------- #
# Trailing-stop mechanics in the backtester
# ---------------------------------------------------------------------- #
FREE = BacktestParams(initial_equity=1000.0, fee_pct=0.0, slippage_pct=0.0)


def tframe(rows):
    """Signal-frame builder with an atr column (needed for trailing)."""
    n = len(rows)
    idx = pd.date_range("2024-01-01", periods=n, freq="4h", tz="UTC")
    return pd.DataFrame({
        "open": [r["o"] for r in rows],
        "high": [r["h"] for r in rows],
        "low": [r["l"] for r in rows],
        "close": [r["c"] for r in rows],
        "atr": [r.get("atr", 5.0) for r in rows],
        "signal": [r.get("sig", 0) for r in rows],
        "stop_price": [r.get("stop", np.nan) for r in rows],
        "target_price": [np.nan] * n,               # trailing: no fixed target
        "exit_long": [False] * n,
        "exit_short": [False] * n,
    }, index=idx)


def quiet(o=100.0, atr=5.0):
    return {"o": o, "h": o + 0.5, "l": o - 0.5, "c": o, "atr": atr}


def test_trailing_stop_ratchets_up_and_locks_in_profit():
    """Long at 100 (initial stop 90), ATR constant 5, trail 2×ATR = 10.
    Price climbs to close 120 → stop ratchets to 110. Price then falls to
    108 → stop at 110 is hit FIRST → profit locked in: +10 per unit.
    With risk 1% of 1000 = 10 and stop distance 10, size = 1 → +10 USDT."""
    df = tframe([
        quiet(),
        {**quiet(), "sig": 1, "stop": 90.0},
        quiet(100.0),                                  # entry at open 100
        {"o": 101, "h": 113, "l": 100, "c": 112, "atr": 5.0},   # stop → 102
        {"o": 113, "h": 121, "l": 112, "c": 120, "atr": 5.0},   # stop → 110
        {"o": 119, "h": 119.5, "l": 108, "c": 109, "atr": 5.0}, # hits 110
        quiet(109.0),
    ])
    res = run_backtest(df, params=FREE, trail_atr_mult=2.0)
    t = res.trades[0]
    assert t.exit_reason == "stop"
    assert t.exit_price == pytest.approx(110.0)
    assert t.net_pnl == pytest.approx(+10.0)        # a WINNING stop-out


def test_trailing_stop_never_loosens():
    """After ratcheting to 110, a price collapse must not move the stop
    back down: next candle's plunge exits at 110, not at the naive
    (new best-close − 2×ATR) which would be lower."""
    df = tframe([
        quiet(),
        {**quiet(), "sig": 1, "stop": 90.0},
        quiet(100.0),
        {"o": 113, "h": 121, "l": 112, "c": 120, "atr": 5.0},   # stop → 110
        {"o": 118, "h": 118, "l": 95, "c": 96, "atr": 5.0},     # crash through 110
        quiet(96.0),
    ])
    res = run_backtest(df, params=FREE, trail_atr_mult=2.0)
    assert res.trades[0].exit_price == pytest.approx(110.0)


def test_trailing_short_mirrors():
    """Short at 100 (stop 110), price falls to close 80 → stop ratchets down
    to 90; bounce to 91 hits it → +10 per unit locked in."""
    df = tframe([
        quiet(),
        {**quiet(), "sig": -1, "stop": 110.0},
        quiet(100.0),
        {"o": 99, "h": 100, "l": 79, "c": 80, "atr": 5.0},      # stop → 90
        {"o": 81, "h": 92, "l": 80, "c": 91, "atr": 5.0},       # hits 90
        quiet(91.0),
    ])
    res = run_backtest(df, params=FREE, trail_atr_mult=2.0)
    t = res.trades[0]
    assert t.side == SHORT
    assert t.exit_price == pytest.approx(90.0)
    assert t.net_pnl == pytest.approx(+10.0)


def test_trailing_requires_atr_column():
    df = tframe([quiet()] * 3).drop(columns=["atr"])
    with pytest.raises(ValueError, match="atr"):
        run_backtest(df, params=FREE, trail_atr_mult=2.0)


def test_v1_unaffected_when_trailing_disabled():
    """Without trail_atr_mult, stops must stay exactly where the signal put
    them — the v1 code path is untouched by the variant."""
    df = tframe([
        quiet(),
        {**quiet(), "sig": 1, "stop": 90.0},
        quiet(100.0),
        {"o": 113, "h": 121, "l": 112, "c": 120, "atr": 5.0},
        {"o": 118, "h": 118, "l": 95, "c": 96, "atr": 5.0},   # through 110 AND 90? no: low 95 > 90
        {"o": 96, "h": 96, "l": 89, "c": 90, "atr": 5.0},     # now through 90
        quiet(90.0),
    ])
    res = run_backtest(df, params=FREE)   # no trailing
    assert res.trades[0].exit_price == pytest.approx(90.0)  # original stop
    assert res.trades[0].net_pnl == pytest.approx(-10.0)
