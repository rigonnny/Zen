"""Phase 5: the trading engine — the loop that runs against the exchange.

WHAT ONE "TICK" DOES (run_once), per symbol:

    1. HALT CHECKS   — kill file present? kill switch tripped? → do nothing.
    2. FETCH         — recent closed candles from the exchange (the same
                       venue orders go to), compute signals with the exact
                       Phase 2 code the backtester used.
    3. RECONCILE     — compare what WE think is open with what the EXCHANGE
                       says is open. The exchange is always right: if our
                       stop was hit while we were away, record the exit
                       (which starts the cooldown) and move on.
    4. MANAGE        — position open? maybe ratchet the trailing stop
                       (cancel + replace the server-side stop order), or
                       exit on a trend flip.
    5. ENTER         — no position, fresh signal, and RiskManager says yes?
                       size it, place the market entry, and IMMEDIATELY
                       attach the server-side stop. If the stop cannot be
                       placed, the position is closed again on the spot —
                       rule #4 means a position without a stop must not
                       survive even for one loop tick.
    6. LOG           — every decision, including every "did nothing
                       because ...", lands in a JSONL decision log. When a
                       bot surprises you, the first question is "what was
                       it thinking?" — this file is the answer.

DESIGN CHOICES worth knowing:
  * The engine is stateless-ish: everything it must remember between ticks
    (position metadata, risk state) lives in a JSON state file, so crashes
    and restarts are safe. On restart it re-syncs against the exchange.
  * Stops live ON THE EXCHANGE (STOP_MARKET closePosition), not in our
    loop — they protect us even when the bot is offline. The trailing
    ratchet only ever REPLACES a stop with a tighter one; between the
    cancel and the new placement there is a moment with no stop, so the
    replace happens immediately and any failure closes the position.
  * PnL for closed-by-stop trades is ESTIMATED from the stop price (the
    exchange's exact fill isn't fetched) — good enough for the circuit
    breaker, and clearly labeled an estimate in the logs.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from bot.risk import RiskConfig, RiskManager, position_size, validate_protective_stop
from bot.strategy import LONG, SHORT, StrategyParams, explain_row, generate_signals

log = logging.getLogger(__name__)

KILL_FILE = Path("KILL")   # presence of this file halts the engine


@dataclass
class EngineSettings:
    trading_timeframe: str = "4h"   # the ONE timeframe the engine trades on
    candle_history: int = 400       # candles fetched per tick (indicator warm-up)
    state_file: str = "data/engine_state.json"
    decision_log_dir: str = "logs"


class DecisionLogger:
    """Appends one JSON line per decision + mirrors it to the console."""

    def __init__(self, log_dir: str | Path) -> None:
        self.dir = Path(log_dir)
        self.dir.mkdir(parents=True, exist_ok=True)

    def log(self, event: str, symbol: str = "-", **detail) -> None:
        now = datetime.now(timezone.utc)
        record = {"ts": now.isoformat(), "event": event, "symbol": symbol, **detail}
        path = self.dir / f"decisions-{now:%Y%m%d}.jsonl"
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, default=str) + "\n")
        log.info("[%s] %s %s", event, symbol,
                 " ".join(f"{k}={v}" for k, v in detail.items()))


class TradingEngine:
    """Wires exchange + strategy + risk together. One instance per run."""

    def __init__(
        self,
        exchange,                       # FuturesExchange or a fake in tests
        strategy: StrategyParams,
        risk_cfg: RiskConfig,
        symbols: list[str],
        settings: EngineSettings | None = None,
        decisions: DecisionLogger | None = None,
    ) -> None:
        self.exchange = exchange
        self.strategy = strategy
        self.symbols = symbols
        self.settings = settings or EngineSettings()
        self.decisions = decisions or DecisionLogger(self.settings.decision_log_dir)
        self.risk = RiskManager(cfg=risk_cfg)
        # positions[symbol] = metadata the exchange can't tell us (why we
        # entered, where the trail's best close is, ...)
        self.positions: dict[str, dict] = {}
        self._load_state()

    # ------------------------------------------------------------------ #
    # State persistence
    # ------------------------------------------------------------------ #
    def _load_state(self) -> None:
        p = Path(self.settings.state_file)
        if p.exists():
            state = json.loads(p.read_text())
            self.risk.restore(state.get("risk", {}))
            self.positions = state.get("positions", {})
            log.info("Restored engine state from %s.", p)

    def _save_state(self) -> None:
        p = Path(self.settings.state_file)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(
            {"risk": self.risk.to_dict(), "positions": self.positions},
            indent=2, default=str,
        ))

    # ------------------------------------------------------------------ #
    # The tick
    # ------------------------------------------------------------------ #
    def run_once(self, now: datetime | None = None) -> None:
        now = now or datetime.now(timezone.utc)

        # ---- 1. halt checks ----
        if KILL_FILE.exists():
            self.risk.activate_kill_switch("KILL file present")
            self.decisions.log("halted", detail="KILL file present — engine idle")
            return
        if self.risk.killed:
            self.decisions.log("halted", detail="kill switch active")
            return

        equity = self.exchange.get_usdt_balance()
        self.risk.start_day_if_needed(now, equity)
        live_positions = {p["symbol"]: p for p in self.exchange.get_positions()}

        for symbol in self.symbols:
            try:
                self._process_symbol(symbol, now, equity, live_positions.get(symbol))
            except Exception as exc:   # one symbol's failure must not kill the rest
                log.exception("Error processing %s", symbol)
                self.decisions.log("error", symbol, detail=str(exc))

        self._save_state()

    # ------------------------------------------------------------------ #
    def _process_symbol(self, symbol: str, now: datetime, equity: float,
                        live_pos: dict | None) -> None:
        tf = self.settings.trading_timeframe

        # ---- 2. fetch + signals ----
        raw = self.exchange.get_closed_candles(symbol, tf, self.settings.candle_history)
        if len(raw) < self.strategy.ema_slow + 5:
            self.decisions.log("skipped", symbol,
                               detail=f"only {len(raw)} candles — not enough warm-up")
            return
        df = pd.DataFrame(raw)
        df["open_time"] = pd.to_datetime(df["open_time"], unit="ms", utc=True)
        df = df.set_index("open_time")
        signals = generate_signals(df, self.strategy)
        last = signals.iloc[-1]           # the most recent CLOSED candle

        meta = self.positions.get(symbol)

        # ---- 3. reconcile: exchange truth vs our records ----
        if meta and live_pos is None:
            # We thought a position was open; the exchange says flat →
            # our server-side stop must have fired while we weren't looking.
            est_pnl = ((meta["stop"] - meta["entry_price"])
                       * meta["size"] * meta["side"])
            self.risk.register_exit(symbol, est_pnl, hit_stop=True, now=now)
            self.exchange.cancel_all_orders(symbol)   # clear any leftovers
            del self.positions[symbol]
            self.decisions.log("stop_hit_while_away", symbol,
                               estimated_pnl=round(est_pnl, 2),
                               note="pnl estimated from stop price")
            meta = None
        elif meta is None and live_pos is not None:
            # A position we have no record of (manual trade? lost state) —
            # refuse to manage what we don't understand, and say so loudly.
            self.decisions.log("unmanaged_position", symbol,
                               size=live_pos["size"],
                               detail="position exists on exchange but not in "
                                      "bot state — not touching it")
            return

        # ---- 4. manage an open position ----
        if meta is not None:
            self._manage_open_position(symbol, meta, last, now)
            return

        # ---- 5. maybe enter ----
        if last["signal"] == 0:
            self.decisions.log("no_signal", symbol, close=float(last["close"]))
            return

        decision = self.risk.can_open_position(symbol, now)
        if not decision:
            self.decisions.log("entry_blocked", symbol, reason=decision.reason,
                               wanted=explain_row(last, self.strategy))
            return

        self._enter(symbol, last, equity, now)

    # ------------------------------------------------------------------ #
    def _manage_open_position(self, symbol: str, meta: dict, last: pd.Series,
                              now: datetime) -> None:
        side = meta["side"]

        # Trend flip → exit at market (mirror of the backtester's rule).
        flipped = (side == LONG and bool(last["exit_long"])) or \
                  (side == SHORT and bool(last["exit_short"]))
        if flipped:
            self.exchange.cancel_all_orders(symbol)
            order_side = "SELL" if side == LONG else "BUY"
            self.exchange.market_order(symbol, order_side, meta["size"], reduce_only=True)
            est_pnl = (float(last["close"]) - meta["entry_price"]) * meta["size"] * side
            self.risk.register_exit(symbol, est_pnl, hit_stop=False, now=now)
            del self.positions[symbol]
            self.decisions.log("trend_flip_exit", symbol,
                               estimated_pnl=round(est_pnl, 2))
            return

        # Trailing mode: ratchet the stop if the market moved our way.
        if self.strategy.exit_mode == "trailing" and not pd.isna(last["atr"]):
            close = float(last["close"])
            best = meta.get("best_close", meta["entry_price"])
            best = max(best, close) if side == LONG else min(best, close)
            meta["best_close"] = best
            trail = (best - self.strategy.trail_atr_mult * float(last["atr"])
                     if side == LONG
                     else best + self.strategy.trail_atr_mult * float(last["atr"]))
            tighter = trail > meta["stop"] if side == LONG else trail < meta["stop"]
            if tighter:
                # Replace the server-side stop with the tighter one.
                self.exchange.cancel_all_orders(symbol)
                try:
                    self.exchange.place_stop_loss(symbol, side, trail)
                except Exception:
                    # No stop on the exchange = rule #4 violated. Close now.
                    order_side = "SELL" if side == LONG else "BUY"
                    self.exchange.market_order(symbol, order_side, meta["size"],
                                               reduce_only=True)
                    est_pnl = (close - meta["entry_price"]) * meta["size"] * side
                    self.risk.register_exit(symbol, est_pnl, hit_stop=False, now=now)
                    del self.positions[symbol]
                    self.decisions.log("emergency_exit", symbol,
                                       detail="failed to replace trailing stop; "
                                              "closed position instead")
                    return
                old = meta["stop"]
                meta["stop"] = trail
                self.decisions.log("trail_ratchet", symbol,
                                   old_stop=round(old, 4), new_stop=round(trail, 4))
                return

        self.decisions.log("holding", symbol, stop=round(meta["stop"], 4),
                           entry=meta["entry_price"])

    # ------------------------------------------------------------------ #
    def _enter(self, symbol: str, last: pd.Series, equity: float,
               now: datetime) -> None:
        side = int(last["signal"])
        entry_ref = float(last["close"])
        stop = float(last["stop_price"])

        # Rule #4, checked BEFORE any order exists:
        validate_protective_stop(side, entry_ref, stop)

        sized = position_size(equity, entry_ref, stop,
                              self.risk.cfg.risk_per_trade_pct,
                              self.risk.cfg.max_leverage, side=side)
        qty = self.exchange.round_quantity(symbol, sized.size)
        if qty < self.exchange.min_viable_quantity(symbol, entry_ref):
            self.decisions.log("entry_skipped", symbol,
                               detail=f"sized qty {qty} below exchange minimum — "
                                      "account too small for this trade")
            return

        order_side = "BUY" if side == LONG else "SELL"
        self.exchange.market_order(symbol, order_side, qty)
        try:
            self.exchange.place_stop_loss(symbol, side, stop)
        except Exception:
            # Could not attach the stop → the position may not live. Undo.
            undo = "SELL" if side == LONG else "BUY"
            self.exchange.market_order(symbol, undo, qty, reduce_only=True)
            self.decisions.log("entry_aborted", symbol,
                               detail="stop-loss placement failed; position "
                                      "closed immediately (rule #4)")
            return

        self.risk.register_entry(symbol)
        self.positions[symbol] = {
            "side": side, "size": qty, "entry_price": entry_ref,
            "stop": stop, "entered_at": now.isoformat(),
            "best_close": entry_ref,
        }
        self.decisions.log("entered", symbol,
                           side="long" if side == LONG else "short",
                           qty=qty, entry_ref=entry_ref, stop=stop,
                           risk_usdt=round(sized.risk_amount, 2),
                           why=explain_row(last, self.strategy))
