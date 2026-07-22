"""The trading strategy: explicit, readable entry/exit rules.

THE STRATEGY IN PLAIN ENGLISH
=============================
It's a classic *trend-following pullback* approach:

    "Only trade in the direction the market has already been moving, and
     enter when momentum turns back in that direction after a breather."

Concretely, on each CLOSED candle:

    LONG signal (betting price goes up) when BOTH:
      1. Trend filter:      EMA(50) is above EMA(200)
                            → the market has been in an uptrend.
      2. Momentum trigger:  RSI(14) crosses UP through 50
                            → after a dip or pause, buyers are back in
                              control. The *cross* matters: RSI merely
                              sitting above 50 is old news; crossing tells
                              us something just changed.

    SHORT signal (betting price goes down): the mirror image —
      EMA(50) below EMA(200), and RSI crosses DOWN through 50.

    Attached to every signal, calculated from ATR(14):
      * stop-loss  = 2.0 × ATR away from entry — outside normal market
        noise, so random wiggles don't stop us out, but a genuine move
        against us does. NO SIGNAL EXISTS WITHOUT A STOP.
      * take-profit = 3.0 × ATR away — 1.5× the stop distance, so the
        reward-to-risk ratio is 1.5:1. Winners must pay for losers: at
        1.5:1 you can be wrong on 45% of trades and still come out ahead
        (before fees). Params enforce a minimum ratio at load time.

    EXIT (for a position already open — Phase 3's backtester applies these):
      * stop-loss hit, or take-profit hit, or
      * the trend flips (EMA fast crosses to the wrong side of EMA slow)
        → the reason we entered no longer exists, so we leave.

Why so simple? Every added rule is another dial that can be (accidentally)
tuned until the backtest looks great on the past and fails on the future —
that's *overfitting*, the #1 killer of retail strategies. We start simple,
measure honestly in Phase 3, and only add complexity if the evidence says to.

WHAT THIS MODULE DELIBERATELY DOES NOT DO
=========================================
No position sizing, leverage, cooldowns, or account logic — that's Phase 4
(risk management). This module is a *pure function*: candles in, signals
out. Same input, same output, every time. That's what makes it testable.

A NOTE ON TIMING (the honest part)
==================================
Signals are computed on the CLOSE of a candle. In live trading you cannot
buy at a price that has already happened — so the assumption throughout
this project is: signal on candle N's close → trade executes at candle
N+1's open. Phase 3's backtester enforces exactly that. Backtests that
"fill" you at the signal candle's own close are quietly cheating.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

from bot.indicators import atr, ema, rsi

# Signal codes used in the output DataFrame. Plain integers, easy to filter.
LONG = 1      # enter a long position (profit if price rises)
SHORT = -1    # enter a short position (profit if price falls)
NONE = 0      # do nothing


@dataclass
class StrategyParams:
    """Every tunable number in the strategy, in one place.

    If a value isn't in this dataclass, it isn't tunable — that's a
    feature. Fewer knobs = less room to overfit.
    """

    ema_fast: int = 50        # "fast" trend EMA (candles)
    ema_slow: int = 200       # "slow" trend EMA (candles)
    rsi_period: int = 14      # RSI lookback
    rsi_midline: float = 50.0 # the momentum switch level
    atr_period: int = 14      # ATR lookback
    atr_stop_mult: float = 2.0    # stop-loss distance, in ATRs
    atr_target_mult: float = 3.0  # take-profit distance, in ATRs
    min_reward_risk: float = 1.5  # required target/stop ratio
    allow_shorts: bool = True     # futures can short as easily as long

    def __post_init__(self) -> None:
        """Sanity-check the numbers the moment params are created."""
        if self.ema_fast >= self.ema_slow:
            raise ValueError(
                f"ema_fast ({self.ema_fast}) must be smaller than "
                f"ema_slow ({self.ema_slow}) — otherwise 'fast above slow' "
                "doesn't mean 'uptrend'."
            )
        for name in ("ema_fast", "rsi_period", "atr_period"):
            if getattr(self, name) < 2:
                raise ValueError(f"{name} must be >= 2.")
        if self.atr_stop_mult <= 0 or self.atr_target_mult <= 0:
            raise ValueError("ATR multiples must be positive.")
        # The reward-to-risk floor, enforced at load time: a signal whose
        # target pays less than min_reward_risk × its stop distance is not
        # allowed to exist in this system.
        rr = self.atr_target_mult / self.atr_stop_mult
        if rr < self.min_reward_risk:
            raise ValueError(
                f"Reward-to-risk is {rr:.2f}:1 (target {self.atr_target_mult} ATR "
                f"/ stop {self.atr_stop_mult} ATR) but the configured minimum is "
                f"{self.min_reward_risk}:1. Widen the target or tighten the stop."
            )

    @classmethod
    def from_yaml(cls, path: str | Path = "config.yaml") -> "StrategyParams":
        """Load the `strategy:` section of config.yaml (missing keys keep
        their defaults, unknown keys are rejected as probable typos)."""
        with open(path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
        section = raw.get("strategy") or {}
        valid = set(cls.__dataclass_fields__)
        unknown = set(section) - valid
        if unknown:
            raise ValueError(
                f"Unknown strategy option(s) in config.yaml: {sorted(unknown)}. "
                f"Valid options: {sorted(valid)}"
            )
        return cls(**section)


def compute_indicators(df: pd.DataFrame, params: StrategyParams) -> pd.DataFrame:
    """Add indicator columns to a candle DataFrame (returns a copy).

    Input: the DataFrame produced by MarketDataStore.load_candles —
    columns open/high/low/close/volume, indexed by UTC open time.
    """
    out = df.copy()
    out["ema_fast"] = ema(out["close"], params.ema_fast)
    out["ema_slow"] = ema(out["close"], params.ema_slow)
    out["rsi"] = rsi(out["close"], params.rsi_period)
    out["atr"] = atr(out["high"], out["low"], out["close"], params.atr_period)
    return out


def generate_signals(df: pd.DataFrame, params: StrategyParams | None = None) -> pd.DataFrame:
    """The heart of Phase 2: candles in → signals out.

    Returns the input DataFrame plus these columns:
        ema_fast, ema_slow, rsi, atr : the indicator values
        uptrend      : True where EMA fast > EMA slow
        signal       : 1 = enter long, -1 = enter short, 0 = nothing
        stop_price   : where the mandatory stop-loss goes (NaN if no signal)
        target_price : where the take-profit goes (NaN if no signal)
        exit_long    : True = an open LONG should close (trend flipped down)
        exit_short   : True = an open SHORT should close (trend flipped up)

    Every row's values use ONLY that row's candle and earlier ones —
    never future data. The tests verify this property explicitly.
    """
    params = params or StrategyParams()
    out = compute_indicators(df, params)

    close = out["close"]
    fast, slow, r = out["ema_fast"], out["ema_slow"], out["rsi"]
    prev_r = r.shift(1)          # yesterday's RSI, for detecting the cross
    prev_fast, prev_slow = fast.shift(1), slow.shift(1)

    # Only rows where every indicator has warmed up are allowed to signal.
    ready = fast.notna() & slow.notna() & r.notna() & prev_r.notna() & out["atr"].notna()

    out["uptrend"] = (fast > slow) & ready

    # "Crosses above 50" = was at-or-below 50, now above it. The shift(1)
    # is what makes it a cross rather than a state.
    rsi_crossed_up = (prev_r <= params.rsi_midline) & (r > params.rsi_midline)
    rsi_crossed_down = (prev_r >= params.rsi_midline) & (r < params.rsi_midline)

    long_entry = ready & (fast > slow) & rsi_crossed_up
    short_entry = ready & (fast < slow) & rsi_crossed_down
    if not params.allow_shorts:
        short_entry &= False

    out["signal"] = np.select([long_entry, short_entry], [LONG, SHORT], default=NONE)

    # --- Mandatory stop & target, priced off the signal candle's close ---
    # (Reference prices; Phase 3 fills at next open and re-anchors these.)
    stop_dist = params.atr_stop_mult * out["atr"]
    target_dist = params.atr_target_mult * out["atr"]
    out["stop_price"] = np.where(
        long_entry, close - stop_dist,
        np.where(short_entry, close + stop_dist, np.nan),
    )
    out["target_price"] = np.where(
        long_entry, close + target_dist,
        np.where(short_entry, close - target_dist, np.nan),
    )

    # --- Exit rules for positions already open: the trend flipped ---
    trend_flipped_down = ready & (prev_fast >= prev_slow) & (fast < slow)
    trend_flipped_up = ready & (prev_fast <= prev_slow) & (fast > slow)
    out["exit_long"] = trend_flipped_down
    out["exit_short"] = trend_flipped_up

    return out


def explain_row(row: pd.Series) -> str:
    """One row of generate_signals output → a plain-English sentence.

    Exists so `show_signals.py` (and later, live-trading logs) can tell you
    WHY the bot wants to trade, not just that it does. A bot you can't
    interrogate is a bot you can't trust.
    """
    if row["signal"] == LONG:
        return (
            f"LONG: uptrend (EMA fast {row['ema_fast']:.2f} > "
            f"EMA slow {row['ema_slow']:.2f}) "
            f"and RSI crossed up through the midline (now {row['rsi']:.1f}). "
            f"Entry ref {row['close']:.2f}, stop {row['stop_price']:.2f}, "
            f"target {row['target_price']:.2f}."
        )
    if row["signal"] == SHORT:
        return (
            f"SHORT: downtrend (EMA fast {row['ema_fast']:.2f} < "
            f"EMA slow {row['ema_slow']:.2f}) and RSI crossed down through the "
            f"midline (now {row['rsi']:.1f}). "
            f"Entry ref {row['close']:.2f}, stop {row['stop_price']:.2f}, "
            f"target {row['target_price']:.2f}."
        )
    if row.get("exit_long"):
        return "EXIT LONGS: trend flipped down (EMA fast crossed below EMA slow)."
    if row.get("exit_short"):
        return "EXIT SHORTS: trend flipped up (EMA fast crossed above EMA slow)."
    return "No signal."
