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

    # --- Variant A+B (pre-registered after the v1 backtest verdict) ---
    # entry_mode:
    #   "rsi_cross" — v1: enter on an RSI cross of the midline (a pullback
    #                 ending). Diagnosis from the v1 backtest: caught too
    #                 many falling knives; win rate below breakeven.
    #   "breakout"  — variant B: enter when price closes beyond its most
    #                 extreme close of the last `breakout_lookback` candles
    #                 (a Donchian-channel breakout). Only fires when the
    #                 move is already confirmed by a new high/low.
    # exit_mode:
    #   "fixed_target" — v1: take profit at atr_target_mult × ATR.
    #   "trailing"     — variant A: NO fixed target; instead a stop that
    #                    follows price at trail_atr_mult × ATR behind the
    #                    best close since entry, ratcheting only in our
    #                    favor (a "chandelier" stop). Rare big winners are
    #                    allowed to stay winners.
    # Rule #4 is unchanged in every mode: the initial 2×ATR stop-loss is
    # attached at entry no matter what.
    entry_mode: str = "rsi_cross"
    exit_mode: str = "fixed_target"
    breakout_lookback: int = 20   # candles in the Donchian channel
    trail_atr_mult: float = 3.0   # trailing distance, in ATRs

    # --- Research candidates (pre-registered after the A+B review) ---
    # entry_mode "rsi_dip" (candidate A — mean reversion): in an uptrend,
    #   buy PANIC — a very short RSI (2 candles) collapsing below ~10 means
    #   a sharp multi-candle drop; in uptrends such drops have historically
    #   tended to snap back. Mirror for shorts in downtrends. This is the
    #   OPPOSITE bet from breakout entries — it profits from the chop that
    #   bleeds trend-following, which is exactly why it's worth testing:
    #   uncorrelated logic, not another knob on the same idea.
    # exit_mode "reversion" (pairs with rsi_dip): exit when the fast RSI
    #   recovers past `reversion_exit_level` — the snap-back happened, the
    #   trade's reason is spent. Stop-loss still attached at entry (rule #4).
    # trend_strength_atr (candidate B — regime filter, works with ANY entry
    #   mode): require the EMAs to be at least this many ATRs apart before
    #   any entry. 0 = off. Rationale: nearly all of A+B's losses came from
    #   chop, where the EMAs hug each other and every cross is noise;
    #   demanding real separation stands the bot aside in exactly those
    #   periods. Fewer trades, fewer fees, hopefully better ones.
    rsi_dip_period: int = 2       # very short RSI for the dip trigger
    rsi_dip_buy_below: float = 10.0    # long trigger level (uptrend only)
    rsi_dip_sell_above: float = 90.0   # short trigger level (downtrend only)
    reversion_exit_level: float = 50.0
    trend_strength_atr: float = 0.0    # 0 = filter off

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
        if self.entry_mode not in ("rsi_cross", "breakout", "rsi_dip"):
            raise ValueError(
                f"entry_mode {self.entry_mode!r} unknown — use 'rsi_cross', "
                "'breakout' or 'rsi_dip'."
            )
        if self.exit_mode not in ("fixed_target", "trailing", "reversion"):
            raise ValueError(
                f"exit_mode {self.exit_mode!r} unknown — use 'fixed_target', "
                "'trailing' or 'reversion'."
            )
        if self.breakout_lookback < 2:
            raise ValueError("breakout_lookback must be >= 2.")
        if self.trail_atr_mult <= 0:
            raise ValueError("trail_atr_mult must be positive.")
        if self.rsi_dip_period < 2:
            raise ValueError("rsi_dip_period must be >= 2.")
        if not (0 < self.rsi_dip_buy_below < self.reversion_exit_level
                < self.rsi_dip_sell_above < 100):
            raise ValueError(
                "Need 0 < rsi_dip_buy_below < reversion_exit_level < "
                "rsi_dip_sell_above < 100 — otherwise entries and exits overlap."
            )
        if self.trend_strength_atr < 0:
            raise ValueError("trend_strength_atr cannot be negative.")
        # The reward-to-risk floor only applies when there IS a fixed
        # target. A trailing exit has unbounded upside — its reward isn't
        # capped, so there is no ratio to check at signal time.
        if self.exit_mode == "fixed_target":
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
    # The very fast RSI used by the mean-reversion candidate. Cheap to
    # compute, so we always include it — one indicator set for every mode.
    out["rsi_fast"] = rsi(out["close"], params.rsi_dip_period)
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

    if params.entry_mode == "rsi_dip":
        # Mean reversion: buy panic in an uptrend / sell euphoria in a
        # downtrend. State-based (may stay true several candles in a row);
        # the backtester/engine ignore signals while a position is open.
        rf = out["rsi_fast"]
        trigger_long = rf < params.rsi_dip_buy_below
        trigger_short = rf > params.rsi_dip_sell_above
        ready = ready & rf.notna()
    elif params.entry_mode == "breakout":
        # Donchian breakout: the highest/lowest close of the PREVIOUS
        # `breakout_lookback` candles (shift(1) excludes today — comparing
        # today's close against a channel that already contains it could
        # never fire). A close beyond that channel is, by definition, the
        # strongest close in `breakout_lookback` candles: momentum
        # confirmed, no knife-catching possible.
        prior_high = close.shift(1).rolling(params.breakout_lookback).max()
        prior_low = close.shift(1).rolling(params.breakout_lookback).min()
        trigger_long = close > prior_high
        trigger_short = close < prior_low
        ready = ready & prior_high.notna() & prior_low.notna()
    else:
        # v1: "crosses above 50" = was at-or-below 50, now above it. The
        # shift(1) is what makes it a cross rather than a state.
        trigger_long = (prev_r <= params.rsi_midline) & (r > params.rsi_midline)
        trigger_short = (prev_r >= params.rsi_midline) & (r < params.rsi_midline)

    long_entry = ready & (fast > slow) & trigger_long
    short_entry = ready & (fast < slow) & trigger_short

    # Candidate B's regime filter: only act when the trend is STRONG —
    # EMAs separated by at least trend_strength_atr ATRs. In chop the EMAs
    # hug each other, so this stands the bot aside exactly where the A+B
    # review showed the losses concentrated.
    if params.trend_strength_atr > 0:
        strong = (fast - slow).abs() > params.trend_strength_atr * out["atr"]
        long_entry &= strong
        short_entry &= strong

    if not params.allow_shorts:
        short_entry &= False

    out["signal"] = np.select([long_entry, short_entry], [LONG, SHORT], default=NONE)

    # --- Mandatory stop & target, priced off the signal candle's close ---
    # (Reference prices; Phase 3 fills at next open.) The stop exists in
    # EVERY mode (rule #4). The fixed target exists only in fixed_target
    # mode — in trailing mode it stays NaN and the backtester/live engine
    # manages a ratcheting stop instead.
    stop_dist = params.atr_stop_mult * out["atr"]
    out["stop_price"] = np.where(
        long_entry, close - stop_dist,
        np.where(short_entry, close + stop_dist, np.nan),
    )
    if params.exit_mode == "fixed_target":
        target_dist = params.atr_target_mult * out["atr"]
        out["target_price"] = np.where(
            long_entry, close + target_dist,
            np.where(short_entry, close - target_dist, np.nan),
        )
    else:
        out["target_price"] = np.nan

    # --- Exit rules for positions already open ---
    # Every mode exits on a trend flip (the reason for the trade is gone).
    trend_flipped_down = ready & (prev_fast >= prev_slow) & (fast < slow)
    trend_flipped_up = ready & (prev_fast <= prev_slow) & (fast > slow)
    out["exit_long"] = trend_flipped_down
    out["exit_short"] = trend_flipped_up

    if params.exit_mode == "reversion":
        # Mean reversion's whole thesis is "the snap-back will happen".
        # Once the fast RSI recovers past the exit level, it HAS happened —
        # take the profit and leave; hanging around is a different trade.
        rf = out["rsi_fast"]
        out["exit_long"] = out["exit_long"] | (rf > params.reversion_exit_level)
        out["exit_short"] = out["exit_short"] | (rf < params.reversion_exit_level)

    return out


def explain_row(row: pd.Series, params: StrategyParams | None = None) -> str:
    """One row of generate_signals output → a plain-English sentence.

    Exists so `show_signals.py` (and later, live-trading logs) can tell you
    WHY the bot wants to trade, not just that it does. A bot you can't
    interrogate is a bot you can't trust.
    """
    breakout = params is not None and params.entry_mode == "breakout"
    lookback = params.breakout_lookback if params else 0
    # NaN target means the exit is a trailing stop, not a fixed price.
    has_target = row["target_price"] == row["target_price"]
    target_txt = (
        f"target {row['target_price']:.2f}" if has_target
        else "exit via trailing stop (no fixed target)"
    )
    if row["signal"] == LONG:
        why = (
            f"closed above its highest close of the last {lookback} candles"
            if breakout else
            f"RSI crossed up through the midline (now {row['rsi']:.1f})"
        )
        return (
            f"LONG: uptrend (EMA fast {row['ema_fast']:.2f} > "
            f"EMA slow {row['ema_slow']:.2f}) and {why}. "
            f"Entry ref {row['close']:.2f}, stop {row['stop_price']:.2f}, {target_txt}."
        )
    if row["signal"] == SHORT:
        why = (
            f"closed below its lowest close of the last {lookback} candles"
            if breakout else
            f"RSI crossed down through the midline (now {row['rsi']:.1f})"
        )
        return (
            f"SHORT: downtrend (EMA fast {row['ema_fast']:.2f} < "
            f"EMA slow {row['ema_slow']:.2f}) and {why}. "
            f"Entry ref {row['close']:.2f}, stop {row['stop_price']:.2f}, {target_txt}."
        )
    if row.get("exit_long"):
        return "EXIT LONGS: trend flipped down (EMA fast crossed below EMA slow)."
    if row.get("exit_short"):
        return "EXIT SHORTS: trend flipped up (EMA fast crossed above EMA slow)."
    return "No signal."
