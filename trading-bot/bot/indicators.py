"""Technical indicators, implemented from scratch.

Why hand-rolled instead of a library like pandas-ta? Three reasons:
    1. You can read every line of the math — no black box.
    2. Our tests pin each indicator to values computed by hand, so we KNOW
       they're right, rather than trusting a dependency.
    3. Different libraries disagree on small details (how to seed an EMA,
       Wilder vs simple smoothing). Owning the code means the backtest and
       the live bot compute the exact same numbers.

The three indicators, in plain English:

*   EMA — Exponential Moving Average. An average of recent prices where
    newer candles count more than older ones. Comparing a fast EMA (short
    window) to a slow EMA (long window) tells you which way the market has
    been leaning: fast above slow = uptrend, below = downtrend.

*   RSI — Relative Strength Index. Measures how one-sided recent movement
    has been, from 0 to 100. Above 50 means recent gains outweigh recent
    losses (momentum up); below 50, the opposite. We use the 50-line as a
    momentum switch rather than the classic 70/30 "overbought/oversold"
    levels — in trends, RSI can sit above 70 for weeks, so 70/30 works
    poorly for trend-following.

*   ATR — Average True Range. The average size of a candle's full travel,
    in price units. It answers "how much does this market typically move
    per candle right now?" We use it to place stop-losses: a stop 2×ATR
    away is outside normal noise, so ordinary wiggles don't knock us out,
    while a real move against us still does. It also drives position
    sizing later (volatile market → wider stop → smaller position).

A note on NaN values: every indicator needs some history before its output
is meaningful (you can't average 200 candles when you only have 10). We
return NaN ("not a number") for that warm-up period instead of a misleading
half-baked value, and the strategy simply never trades on NaN.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def sma(series: pd.Series, period: int) -> pd.Series:
    """Simple Moving Average: the plain mean of the last `period` values."""
    if period < 1:
        raise ValueError("period must be >= 1")
    return series.rolling(window=period).mean()


def ema(series: pd.Series, period: int) -> pd.Series:
    """Exponential Moving Average.

    Each new value blends the newest price with yesterday's EMA:
        EMA_today = alpha * price_today + (1 - alpha) * EMA_yesterday
    where alpha = 2 / (period + 1). Bigger alpha = reacts faster.

    We seed with the first price (the standard "adjust=False" recursion)
    and blank out the first `period - 1` values as warm-up, since an EMA
    that has only seen a handful of prices isn't a real average yet.
    """
    if period < 1:
        raise ValueError("period must be >= 1")
    result = series.ewm(span=period, adjust=False).mean()
    result.iloc[: period - 1] = np.nan
    return result


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    """Relative Strength Index (Wilder's original method), 0..100.

    The recipe:
        1. Split each candle-to-candle change into a gain or a loss.
        2. Average the gains and losses over `period` candles — but using
           Wilder's smoothing: the first average is a plain mean, and each
           later one is  (previous_avg * (period-1) + newest) / period.
           This is like an EMA that turns more slowly.
        3. RSI = 100 - 100 / (1 + avg_gain / avg_loss).

    All gains and no losses → RSI 100. All losses → 0. Balanced → 50.

    Implemented as an explicit loop rather than pandas tricks: with ~9,000
    candles this is still instant, and you can follow the math line by line.
    """
    if period < 1:
        raise ValueError("period must be >= 1")

    values = close.to_numpy(dtype=float)
    n = len(values)
    out = np.full(n, np.nan)
    if n <= period:
        return pd.Series(out, index=close.index)

    change = np.diff(values)                    # price change per candle
    gains = np.where(change > 0, change, 0.0)   # up-moves only, else 0
    losses = np.where(change < 0, -change, 0.0) # down-moves as positive numbers

    # Step 2a: seed with the plain average of the first `period` changes.
    avg_gain = gains[:period].mean()
    avg_loss = losses[:period].mean()
    out[period] = _rsi_from_averages(avg_gain, avg_loss)

    # Step 2b: Wilder smoothing for every candle after that.
    for i in range(period, n - 1):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        out[i + 1] = _rsi_from_averages(avg_gain, avg_loss)

    return pd.Series(out, index=close.index)


def _rsi_from_averages(avg_gain: float, avg_loss: float) -> float:
    """The final RSI formula, with the divide-by-zero case handled."""
    if avg_loss == 0:
        # No losses at all in the window: maximum reading.
        return 100.0 if avg_gain > 0 else 50.0  # flat market → neutral 50
    rs = avg_gain / avg_loss                    # "relative strength"
    return 100.0 - 100.0 / (1.0 + rs)


def true_range(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    """True Range: how far price really traveled during one candle.

    Usually that's just high - low, BUT if price gapped between candles
    (e.g. closed at 100, next candle opens at 105), the gap was real
    movement too. So TR is the largest of:
        * high - low                      (today's range)
        * |high - yesterday's close|      (range including an up-gap)
        * |low  - yesterday's close|      (range including a down-gap)
    """
    prev_close = close.shift(1)
    ranges = pd.concat(
        [
            high - low,
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ],
        axis=1,
    )
    tr = ranges.max(axis=1)
    # The very first candle has no "yesterday", so TR is just high - low.
    tr.iloc[0] = high.iloc[0] - low.iloc[0]
    return tr


def atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    """Average True Range: Wilder-smoothed average of the True Range.

    Same smoothing recipe as RSI: plain mean of the first `period` TRs to
    start, then (previous_atr * (period-1) + newest_tr) / period after.
    """
    if period < 1:
        raise ValueError("period must be >= 1")

    tr = true_range(high, low, close).to_numpy(dtype=float)
    n = len(tr)
    out = np.full(n, np.nan)
    if n < period:
        return pd.Series(out, index=close.index)

    out[period - 1] = tr[:period].mean()        # seed
    for i in range(period, n):
        out[i] = (out[i - 1] * (period - 1) + tr[i]) / period

    return pd.Series(out, index=close.index)
