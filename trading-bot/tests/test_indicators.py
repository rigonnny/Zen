"""Tests for the indicator math.

The important expected values below were computed BY HAND (small periods,
short series, arithmetic you can redo on paper). That makes these tests an
independent check on the code — if both the code and the test agreed only
because they share the same bug, hand-computed numbers would catch it.
"""

import numpy as np
import pandas as pd
import pytest

from bot.indicators import atr, ema, rsi, sma, true_range


def s(*values) -> pd.Series:
    return pd.Series(list(values), dtype=float)


# ---------------------------------------------------------------------- #
# SMA / EMA
# ---------------------------------------------------------------------- #
def test_sma_hand_computed():
    result = sma(s(1, 2, 3, 4, 5), 3)
    assert np.isnan(result.iloc[0]) and np.isnan(result.iloc[1])  # warm-up
    assert result.iloc[2] == 2.0   # (1+2+3)/3
    assert result.iloc[3] == 3.0   # (2+3+4)/3
    assert result.iloc[4] == 4.0   # (3+4+5)/3


def test_ema_hand_computed():
    """period=3 → alpha = 2/(3+1) = 0.5. Seeded with the first price:
        ema_0 = 10                       (hidden by warm-up)
        ema_1 = 0.5*11 + 0.5*10   = 10.5 (hidden by warm-up)
        ema_2 = 0.5*12 + 0.5*10.5 = 11.25
        ema_3 = 0.5*13 + 0.5*11.25 = 12.125
    """
    result = ema(s(10, 11, 12, 13), 3)
    assert np.isnan(result.iloc[0]) and np.isnan(result.iloc[1])  # warm-up
    assert result.iloc[2] == pytest.approx(11.25)
    assert result.iloc[3] == pytest.approx(12.125)


def test_ema_reacts_faster_than_sma():
    """The defining property: after a price jump, EMA moves first."""
    prices = s(*([100.0] * 10 + [110.0] * 3))
    e, m = ema(prices, 5), sma(prices, 5)
    assert e.iloc[-1] > m.iloc[-1]


# ---------------------------------------------------------------------- #
# RSI
# ---------------------------------------------------------------------- #
def test_rsi_hand_computed():
    """period=3, closes 10,11,12,11,12,13,14.
    Changes: +1,+1,-1,+1,+1,+1 → gains 1,1,0,1,1,1 / losses 0,0,1,0,0,0.

    Seed (mean of first 3): avg_gain=2/3, avg_loss=1/3 → RS=2
        RSI[3] = 100 - 100/(1+2)            = 66.667
    Wilder steps ( (prev*2 + new)/3 ):
        RSI[4]: g=7/9,   l=2/9  → RS=3.5    → 77.778
        RSI[5]: g=23/27, l=4/27 → RS=5.75   → 85.185
        RSI[6]: g=73/81, l=8/81 → RS=9.125  → 90.123
    """
    result = rsi(s(10, 11, 12, 11, 12, 13, 14), period=3)
    assert result.iloc[:3].isna().all()  # warm-up
    assert result.iloc[3] == pytest.approx(66.6667, abs=1e-3)
    assert result.iloc[4] == pytest.approx(77.7778, abs=1e-3)
    assert result.iloc[5] == pytest.approx(85.1852, abs=1e-3)
    assert result.iloc[6] == pytest.approx(90.1235, abs=1e-3)


def test_rsi_extremes_and_bounds():
    only_up = rsi(s(*range(1, 20)), period=3)         # never a down candle
    assert only_up.iloc[-1] == 100.0
    only_down = rsi(s(*range(20, 1, -1)), period=3)   # never an up candle
    assert only_down.iloc[-1] == 0.0
    flat = rsi(s(*([5.0] * 10)), period=3)            # no movement at all
    assert flat.iloc[-1] == 50.0                      # neutral, not a crash

    wiggly = rsi(s(10, 12, 9, 14, 8, 15, 7, 16), period=3)
    valid = wiggly.dropna()
    assert ((valid >= 0) & (valid <= 100)).all()      # always inside 0..100


# ---------------------------------------------------------------------- #
# True Range / ATR
# ---------------------------------------------------------------------- #
def test_true_range_includes_gaps():
    """Bar closes at 11, next bar opens way up at 20-18: the gap counts.
    TR of bar 1 = max(20-18, |20-11|, |18-11|) = 9, not just 2."""
    high, low, close = s(12, 20), s(10, 18), s(11, 19)
    tr = true_range(high, low, close)
    assert tr.iloc[0] == 2.0   # first bar: just high - low
    assert tr.iloc[1] == 9.0   # gap included


def test_atr_hand_computed():
    """period=2. Bars (h,l,c): (12,10,11) (13,11,12) (15,12,14) (14,11,12)
    TRs: 2, 2, 3, 3   (bar2: max(3,|15-12|,|12-12|)=3; bar3: max(3,0,3)=3)
        ATR[1] = mean(2,2)      = 2
        ATR[2] = (2*1 + 3)/2    = 2.5
        ATR[3] = (2.5*1 + 3)/2  = 2.75
    """
    high, low, close = s(12, 13, 15, 14), s(10, 11, 12, 11), s(11, 12, 14, 12)
    result = atr(high, low, close, period=2)
    assert np.isnan(result.iloc[0])
    assert result.iloc[1] == pytest.approx(2.0)
    assert result.iloc[2] == pytest.approx(2.5)
    assert result.iloc[3] == pytest.approx(2.75)


def test_atr_constant_range_converges_to_that_range():
    """Candles that always travel exactly 5 → ATR must be exactly 5."""
    n = 30
    high = s(*([105.0] * n))
    low = s(*([100.0] * n))
    close = s(*([102.0] * n))
    result = atr(high, low, close, period=14)
    assert result.iloc[-1] == pytest.approx(5.0)


# ---------------------------------------------------------------------- #
# Shared behaviors
# ---------------------------------------------------------------------- #
def test_bad_period_rejected():
    for fn in (lambda: sma(s(1, 2), 0), lambda: ema(s(1, 2), 0),
               lambda: rsi(s(1, 2), 0), lambda: atr(s(1), s(1), s(1), 0)):
        with pytest.raises(ValueError):
            fn()


def test_short_series_returns_all_nan_not_crash():
    assert rsi(s(1, 2), period=14).isna().all()
    assert atr(s(1, 2), s(1, 2), s(1, 2), period=14).isna().all()
