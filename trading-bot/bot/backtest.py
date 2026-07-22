"""Phase 3: the backtesting engine.

WHAT A BACKTEST IS
==================
We replay history candle by candle, pretending to trade the Phase 2 signals
with pretend money, and account for every cost a real trade would pay. The
output is an equity curve (account value over time) and a trade list, from
which we compute the honest statistics: return, drawdown, win rate, etc.

THE RULES OF HONESTY built into this simulator — each one exists because
the sloppy alternative flatters results:

1.  NEXT-OPEN FILLS. A signal is computed on candle N's close, so the
    earliest a real order could fill is candle N+1's open. We fill there,
    never at the signal candle's own close (that price is already gone).

2.  COSTS ON EVERY TRADE:
      * taker fee on entry and exit (Binance USDT-M taker: 0.05%),
      * slippage on market-style fills — entry, stop-loss, forced exits —
        (you never get exactly the price you saw; default 0.03% against us),
      * funding payments for every 8-hour funding event the position sits
        through, using the real historical rates we downloaded in Phase 1.
        Take-profit exits fill at the target price with no slippage: they
        model a resting limit order, which by definition fills at its price.

3.  WORST-CASE TIE-BREAK. If one candle's range touches BOTH the stop and
    the target, we cannot know from OHLC data which was hit first — so we
    assume the STOP was (the losing outcome). Pessimistic by design.

4.  POSITION SIZING BY RISK, NOT BY GUT. Each trade risks a fixed fraction
    of current equity (default 1%): position size = risk amount ÷ distance
    to stop. Volatile market → wider stop → smaller position, automatically.
    This is safety rule #3, live in code. A leverage cap (safety rule #2,
    default 2×) shrinks any position whose notional would exceed it.

5.  ONE POSITION PER MARKET, and signals that arrive while a position is
    open are ignored. (Portfolio-level caps and loss cooldowns are Phase 4;
    keeping them out of Phase 3 keeps this module a pure measurement tool.)

SIMPLIFICATIONS to be aware of (all noted, none flattering):
  * Stop/target levels come from the signal candle's close (as Phase 2
    computed them) and are not re-anchored to the actual fill price.
  * Funding is charged to a trade's P&L at trade close (summed over the
    events it sat through) rather than dripped into the equity curve.
  * Positions are sized in fractional units with no minimum order size —
    fine for BTC/ETH at the account sizes this project targets.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd

from bot.risk import position_size
from bot.strategy import LONG, SHORT


@dataclass
class BacktestParams:
    """Every knob of the simulation, with honest defaults."""

    initial_equity: float = 10_000.0   # starting pretend-money, in USDT
    fee_pct: float = 0.05              # taker fee per fill, % of notional
    slippage_pct: float = 0.03         # adverse slip per market-style fill, %
    risk_per_trade_pct: float = 1.0    # % of equity risked between entry and stop
    max_leverage: float = 2.0          # notional may not exceed this × equity

    def __post_init__(self) -> None:
        if self.initial_equity <= 0:
            raise ValueError("initial_equity must be positive.")
        if not (0 < self.risk_per_trade_pct <= 2.0):
            # Safety rule #3: 1–2% risk per trade, and the code means it.
            raise ValueError(
                f"risk_per_trade_pct is {self.risk_per_trade_pct} — must be in "
                "(0, 2]. Risking more than 2% per trade is how accounts die; "
                "this backtester refuses to model it as if it were sane."
            )
        if not (0 < self.max_leverage <= 3.0):
            # Safety rule #2: leverage ceiling of 3× is a hard wall here.
            raise ValueError(
                f"max_leverage is {self.max_leverage} — must be in (0, 3]."
            )
        if self.fee_pct < 0 or self.slippage_pct < 0:
            raise ValueError("fee_pct and slippage_pct cannot be negative.")


@dataclass
class Trade:
    """One completed round-trip, with every cost itemized."""

    side: int                  # LONG (+1) or SHORT (-1)
    entry_time: pd.Timestamp
    entry_price: float         # actual fill (open ± slippage)
    exit_time: pd.Timestamp
    exit_price: float
    size: float                # position size in base units (e.g. ETH)
    exit_reason: str           # 'stop' | 'target' | 'trend_flip' | 'end_of_data'
    gross_pnl: float           # price movement × size, before costs
    fees: float                # entry + exit fees, USDT
    funding: float             # net funding paid (+ = we paid), USDT
    net_pnl: float             # what the account actually gained/lost


@dataclass
class BacktestResult:
    trades: list = field(default_factory=list)
    equity: Optional[pd.Series] = None   # account value at each candle close
    params: Optional[BacktestParams] = None


def run_backtest(
    signals: pd.DataFrame,
    funding: Optional[pd.DataFrame] = None,
    params: Optional[BacktestParams] = None,
) -> BacktestResult:
    """Simulate trading a generate_signals() DataFrame. Pure & deterministic.

    `signals` must contain: open/high/low/close, signal, stop_price,
    target_price, exit_long, exit_short (i.e. generate_signals output).
    `funding` is the load_funding_rates() frame (may be None/empty).
    """
    params = params or BacktestParams()
    fee = params.fee_pct / 100.0
    slip = params.slippage_pct / 100.0

    # Funding events as parallel arrays for quick range lookups.
    if funding is not None and len(funding) > 0:
        f_times = funding.index
        f_rates = funding["funding_rate"].to_numpy()
    else:
        f_times, f_rates = pd.DatetimeIndex([]), np.array([])

    idx = signals.index
    open_ = signals["open"].to_numpy()
    high = signals["high"].to_numpy()
    low = signals["low"].to_numpy()
    close = signals["close"].to_numpy()
    sig = signals["signal"].to_numpy()
    stop_arr = signals["stop_price"].to_numpy()
    target_arr = signals["target_price"].to_numpy()
    exit_long = signals["exit_long"].to_numpy()
    exit_short = signals["exit_short"].to_numpy()

    equity = params.initial_equity
    equity_curve = np.full(len(signals), np.nan)
    trades: list[Trade] = []

    # --- simulator state ---
    pending: Optional[dict] = None   # a signal waiting for next candle's open
    pos: Optional[dict] = None       # the currently open position
    flip_exit_pending = False        # trend flipped → leave at next open

    def funding_between(t0: pd.Timestamp, t1: pd.Timestamp, notional: float, side: int) -> float:
        """Net funding PAID over [t0, t1]. Positive rate: longs pay shorts."""
        if len(f_times) == 0:
            return 0.0
        mask = (f_times >= t0) & (f_times <= t1)
        # side=+1 (long) pays positive rates; side=-1 (short) receives them.
        return float(np.sum(f_rates[mask]) * notional * side)

    def close_position(i: int, exit_price: float, reason: str) -> None:
        """Book the round-trip and update equity.

        (We charge the taker fee on every exit, including take-profits that
        would often qualify for the cheaper maker fee — one more small,
        deliberate pessimism.)
        """
        nonlocal pos, equity, flip_exit_pending
        p = pos
        gross = (exit_price - p["entry_price"]) * p["size"] * p["side"]
        exit_fee = exit_price * p["size"] * fee
        fees = p["entry_fee"] + exit_fee
        fund = funding_between(p["entry_time"], idx[i], p["notional"], p["side"])
        net = gross - fees - fund
        equity += net
        trades.append(Trade(
            side=p["side"], entry_time=p["entry_time"], entry_price=p["entry_price"],
            exit_time=idx[i], exit_price=exit_price, size=p["size"],
            exit_reason=reason, gross_pnl=gross, fees=fees, funding=fund, net_pnl=net,
        ))
        pos = None
        flip_exit_pending = False

    for i in range(len(signals)):
        # ---------- 1. Fills queued from the previous candle ----------
        if pos is not None and flip_exit_pending:
            # Trend-flip exit: market order at this candle's open.
            px = open_[i] * (1 - slip * pos["side"])   # slip works against us
            close_position(i, px, "trend_flip")

        if pos is None and pending is not None:
            # Enter at this candle's open, slipped against us. Sizing and
            # the leverage cap come from bot.risk — the SAME code the live
            # bot uses, so simulation and reality cannot drift apart.
            side = pending["side"]
            fill = open_[i] * (1 + slip * side)
            try:
                sized = position_size(
                    equity, fill, pending["stop"],
                    params.risk_per_trade_pct, params.max_leverage,
                    side=side,
                )
            except ValueError:
                # e.g. the slipped fill landed on the wrong side of the
                # stop — a trade that can't be protected doesn't happen.
                sized = None
            if sized is not None:
                pos = {
                    "side": side, "entry_price": fill, "size": sized.size,
                    "notional": sized.notional, "stop": pending["stop"],
                    "target": pending["target"], "entry_time": idx[i],
                    "entry_fee": sized.notional * fee,
                }
            pending = None

        # ---------- 2. Does this candle's range hit stop or target? ----------
        if pos is not None:
            s, t, side = pos["stop"], pos["target"], pos["side"]
            hit_stop = low[i] <= s if side == LONG else high[i] >= s
            hit_target = high[i] >= t if side == LONG else low[i] <= t

            if hit_stop:
                # Worst-case rule: stop wins any tie with the target.
                # Stop is a market-style fill → slippage applies against us.
                px = s * (1 - slip * side)
                close_position(i, px, "stop")
            elif hit_target:
                # Resting limit order: fills at its own price, no slippage.
                close_position(i, t, "target")

        # ---------- 3. React to this candle's close (signals/flips) ----------
        if pos is not None:
            if (pos["side"] == LONG and exit_long[i]) or (pos["side"] == SHORT and exit_short[i]):
                flip_exit_pending = True
        elif pending is None and sig[i] != 0:
            pending = {"side": int(sig[i]), "stop": stop_arr[i], "target": target_arr[i]}

        # ---------- 4. Mark to market for the equity curve ----------
        unrealized = 0.0
        if pos is not None:
            unrealized = (close[i] - pos["entry_price"]) * pos["size"] * pos["side"]
        equity_curve[i] = equity + unrealized

    # Anything still open at the end closes at the last close (no pretending
    # an open loser doesn't exist).
    if pos is not None:
        close_position(len(signals) - 1, close[-1], "end_of_data")
        equity_curve[-1] = equity

    return BacktestResult(
        trades=trades,
        equity=pd.Series(equity_curve, index=idx, name="equity"),
        params=params,
    )


# ---------------------------------------------------------------------- #
# Performance metrics
# ---------------------------------------------------------------------- #
def compute_metrics(result: BacktestResult, periods_per_year: float) -> dict:
    """Turn a backtest result into the numbers that matter.

    `periods_per_year`: how many candles fit in a year (4h → 2190, 1d → 365).
    Needed to annualize Sharpe/Sortino so different timeframes compare fairly.
    """
    eq = result.equity.dropna()
    trades = result.trades
    m: dict = {"trade_count": len(trades)}

    if len(eq) < 2:
        return m

    initial = result.params.initial_equity
    final = float(eq.iloc[-1])
    m["final_equity"] = final
    m["total_return_pct"] = (final / initial - 1) * 100

    years = len(eq) / periods_per_year
    if years > 0 and final > 0:
        # CAGR: the constant yearly growth rate that turns start into end.
        m["cagr_pct"] = ((final / initial) ** (1 / years) - 1) * 100

    # Per-candle returns feed the risk-adjusted stats.
    rets = eq.pct_change().dropna()
    if len(rets) > 1 and rets.std() > 0:
        # Sharpe: average return per unit of total volatility, annualized.
        # Rule of thumb: <1 weak, 1–2 decent, >2 suspicious for a simple bot.
        m["sharpe"] = float(rets.mean() / rets.std() * np.sqrt(periods_per_year))
        downside = rets[rets < 0]
        if len(downside) > 0 and downside.std() > 0:
            # Sortino: like Sharpe but only penalizes DOWNWARD volatility —
            # nobody complains about upside surprises.
            m["sortino"] = float(rets.mean() / downside.std() * np.sqrt(periods_per_year))

    # Max drawdown: worst peak-to-valley fall of the equity curve. The
    # single most important number for "could I psychologically survive
    # trading this?" — a strategy you'd abandon mid-drawdown is worthless.
    m["max_drawdown_pct"] = float((eq / eq.cummax() - 1).min() * 100)

    if trades:
        pnls = np.array([t.net_pnl for t in trades])
        wins, losses = pnls[pnls > 0], pnls[pnls <= 0]
        m["win_rate_pct"] = len(wins) / len(pnls) * 100
        m["avg_win"] = float(wins.mean()) if len(wins) else 0.0
        m["avg_loss"] = float(losses.mean()) if len(losses) else 0.0
        gross_win, gross_loss = wins.sum(), -losses.sum()
        # Profit factor: gross gains ÷ gross losses. >1 = profitable,
        # <1 = losing, 1.0 = treading water (before your time is counted).
        m["profit_factor"] = float(gross_win / gross_loss) if gross_loss > 0 else float("inf")
        m["total_fees"] = float(sum(t.fees for t in trades))
        m["total_funding"] = float(sum(t.funding for t in trades))

        # Longest run of consecutive losers — the "how long will it feel
        # broken while working exactly as designed?" number.
        streak = longest = 0
        for p in pnls:
            streak = streak + 1 if p <= 0 else 0
            longest = max(longest, streak)
        m["longest_loss_streak"] = longest

    return m


PERIODS_PER_YEAR = {
    "1h": 24 * 365, "2h": 12 * 365, "4h": 6 * 365, "6h": 4 * 365,
    "8h": 3 * 365, "12h": 2 * 365, "1d": 365, "3d": 365 / 3, "1w": 52,
}
