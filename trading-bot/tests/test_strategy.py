"""Tests for the strategy rules.

Approach: build small synthetic price series that engineer exactly one
situation (uptrend + RSI dip and recovery, trend flip, etc.), then assert
the strategy reacts the way its plain-English description promises.
"""

import numpy as np
import pandas as pd
import pytest

from bot.strategy import LONG, NONE, SHORT, StrategyParams, explain_row, generate_signals

# Small, fast test params (same shape as the real ones, tiny warm-ups).
TEST_PARAMS = StrategyParams(
    ema_fast=3,
    ema_slow=6,
    rsi_period=3,
    atr_period=3,
    atr_stop_mult=2.0,
    atr_target_mult=3.0,
)


def make_df(closes) -> pd.DataFrame:
    """Wrap a list of closes into an OHLCV frame with a 4h UTC index.

    Highs/lows are drawn a fixed 1.0 above/below close — simple, and it
    makes ATR values easy to reason about in assertions.
    """
    closes = pd.Series(closes, dtype=float)
    idx = pd.date_range("2024-01-01", periods=len(closes), freq="4h", tz="UTC")
    return pd.DataFrame(
        {
            "open": closes.shift(1).fillna(closes.iloc[0]).values,
            "high": closes.values + 1.0,
            "low": closes.values - 1.0,
            "close": closes.values,
            "volume": 1000.0,
        },
        index=idx,
    )


def uptrend_with_pullback() -> pd.DataFrame:
    """Rising prices, then a 3-candle dip (RSI drops below 50), then a
    strong recovery (RSI crosses back above 50) while the trend EMAs stay
    bullish → should produce exactly the textbook LONG setup."""
    rise = [100 + 2 * i for i in range(12)]      # steady climb to 122
    dip = [120, 118, 116]                        # the pullback
    recover = [121, 126]                         # momentum returns
    return make_df(rise + dip + recover)


def test_long_signal_fires_on_textbook_setup():
    result = generate_signals(uptrend_with_pullback(), TEST_PARAMS)
    signals = result[result["signal"] == LONG]
    assert len(signals) >= 1, "expected at least one LONG on this setup"

    row = signals.iloc[-1]
    assert row["uptrend"], "long may only fire in an uptrend"
    assert row["rsi"] > TEST_PARAMS.rsi_midline


def test_every_signal_has_stop_and_target():
    """Safety rule #4 starts here: a signal without a stop cannot exist."""
    result = generate_signals(uptrend_with_pullback(), TEST_PARAMS)
    with_signal = result[result["signal"] != NONE]
    assert len(with_signal) >= 1
    assert with_signal["stop_price"].notna().all()
    assert with_signal["target_price"].notna().all()

    # And the geometry is right: for a LONG, stop below entry, target above,
    # at exactly 2×ATR and 3×ATR.
    row = result[result["signal"] == LONG].iloc[-1]
    assert row["stop_price"] == pytest.approx(row["close"] - 2.0 * row["atr"])
    assert row["target_price"] == pytest.approx(row["close"] + 3.0 * row["atr"])
    assert row["stop_price"] < row["close"] < row["target_price"]


def test_short_signal_is_mirror_image():
    """Falling market, brief bounce, momentum rolls back over → SHORT."""
    fall = [200 - 2 * i for i in range(12)]      # steady decline to 178
    bounce = [180, 182, 184]                     # the pullback (upward)
    rollover = [179, 174]                        # sellers take over again
    result = generate_signals(make_df(fall + bounce + rollover), TEST_PARAMS)

    signals = result[result["signal"] == SHORT]
    assert len(signals) >= 1
    row = signals.iloc[-1]
    assert not row["uptrend"]
    assert row["stop_price"] > row["close"] > row["target_price"]  # mirrored


def test_no_longs_against_the_trend():
    """RSI crossing up during a DOWNTREND must be ignored — that's the
    whole point of the trend filter."""
    fall = [200 - 3 * i for i in range(14)]
    bounce = [160, 168, 176]                     # sharp bounce, RSI crosses 50
    result = generate_signals(make_df(fall + bounce), TEST_PARAMS)
    in_downtrend = result[~result["uptrend"]]
    assert (in_downtrend["signal"] != LONG).all()


def test_allow_shorts_false_kills_shorts():
    fall = [200 - 2 * i for i in range(12)]
    bounce_roll = [180, 182, 184, 179, 174]
    params = StrategyParams(ema_fast=3, ema_slow=6, rsi_period=3, atr_period=3,
                            allow_shorts=False)
    result = generate_signals(make_df(fall + bounce_roll), params)
    assert (result["signal"] != SHORT).all()


def test_no_signals_during_warmup():
    """Before the slow EMA has enough history, the bot must stay silent."""
    result = generate_signals(uptrend_with_pullback(), TEST_PARAMS)
    warmup = result.iloc[: TEST_PARAMS.ema_slow - 1]
    assert (warmup["signal"] == NONE).all()


def test_trend_flip_produces_exit():
    """Long uptrend, then a hard crash: somewhere the fast EMA crosses
    below the slow EMA, and that candle must raise exit_long."""
    up = [100 + 2 * i for i in range(15)]
    crash = [128 - 6 * i for i in range(10)]
    result = generate_signals(make_df(up + crash), TEST_PARAMS)
    assert result["exit_long"].any()
    # The flip candle really is the first one where fast < slow after
    # having been above:
    flip = result[result["exit_long"]].iloc[0]
    assert flip["ema_fast"] < flip["ema_slow"]


def test_no_lookahead_bias():
    """THE most important test in this file.

    Rule: the signal on candle N may use only candles 0..N. So if we chop
    off the future and recompute, every surviving row must be identical.
    A strategy that fails this test would show beautiful backtests and
    then fall apart in live trading, where the future isn't available.
    """
    df = uptrend_with_pullback()
    full = generate_signals(df, TEST_PARAMS)
    truncated = generate_signals(df.iloc[:-3], TEST_PARAMS)

    cols = ["signal", "stop_price", "target_price", "exit_long", "exit_short"]
    pd.testing.assert_frame_equal(
        full.iloc[:-3][cols], truncated[cols], check_dtype=False
    )


def test_params_validation():
    with pytest.raises(ValueError, match="must be smaller"):
        StrategyParams(ema_fast=200, ema_slow=50)   # swapped fast/slow
    with pytest.raises(ValueError, match="Reward-to-risk"):
        StrategyParams(atr_stop_mult=2.0, atr_target_mult=2.0)  # 1:1 < 1.5:1
    with pytest.raises(ValueError, match="positive"):
        StrategyParams(atr_stop_mult=-1.0)


def test_params_from_yaml(tmp_path):
    p = tmp_path / "config.yaml"
    p.write_text("strategy:\n  ema_fast: 30\n  atr_stop_mult: 2.5\n  atr_target_mult: 4.0\n")
    params = StrategyParams.from_yaml(p)
    assert params.ema_fast == 30
    assert params.atr_stop_mult == 2.5
    assert params.ema_slow == 200               # untouched default

    p.write_text("strategy:\n  ema_fst: 30\n")  # typo'd key
    with pytest.raises(ValueError, match="Unknown strategy option"):
        StrategyParams.from_yaml(p)


def test_explain_row_produces_readable_text():
    result = generate_signals(uptrend_with_pullback(), TEST_PARAMS)
    row = result[result["signal"] == LONG].iloc[-1]
    text = explain_row(row)
    assert "LONG" in text and "stop" in text and "target" in text
    quiet = explain_row(result.iloc[0])
    assert quiet == "No signal."
