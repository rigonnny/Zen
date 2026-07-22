"""Phase 4: the risk-management module — the seven safety rules as code.

This module is the bot's conscience. The strategy (Phase 2) proposes
trades; this module decides whether they're ALLOWED, how BIG they may be,
and when trading must STOP. It is deliberately standalone and stateful-
but-simple, so it can be tested exhaustively on its own and then wired
into both the backtester and the live engine — one set of rules, every
code path.

Where each of the seven non-negotiable safety rules lives:

  #1 Testnet by default        → RiskConfig.live_trading (default False).
                                 Phase 5's exchange client will REFUSE to
                                 build a live connection unless this flag —
                                 and an environment confirmation — agree.
  #2 Leverage cap              → position_size() clamps notional at
                                 max_leverage × equity; RiskConfig refuses
                                 values above HARD_MAX_LEVERAGE (3×) and
                                 logs a loud warning above 2×.
  #3 Risk per trade            → position_size() risks exactly
                                 risk_per_trade_pct of equity between entry
                                 and stop; RiskConfig refuses >2%.
  #4 Mandatory stop-loss       → validate_protective_stop() — the live
                                 engine calls it before ANY entry order,
                                 and there is no code path that opens a
                                 position without passing through it.
  #5 Daily loss circuit breaker→ RiskManager tracks realized PnL per UTC
                                 day; beyond daily_loss_limit_pct of the
                                 day's starting equity, no new entries
                                 until the next UTC day.
  #6 API key scope             → not enforceable from Python (permissions
                                 live on Binance's side) — but Phase 5
                                 loads keys only from .env, never logs
                                 them, and the README/`.env.example` insist
                                 on trade-only, no-withdrawal keys.
  #7 Kill switch               → RiskManager.activate_kill_switch():
                                 one-way for the life of the process; every
                                 can_open_position() answer becomes NO.
                                 Phase 5 adds the "flatten all positions"
                                 half, which needs the exchange client.

Plus two trading-psychology rules from the project brief:
  * max concurrent positions (default 2) — no stacking correlated bets,
  * cooldown after a stop-loss (default 24h per symbol) — the coded
    equivalent of "walk away from the screen after a loss", because the
    urge to immediately win it back (revenge-trading) is how small losses
    become big ones. A bot doesn't feel the urge, but without this rule it
    would happily re-enter one candle after being stopped out, which is
    the same behavior with better posture.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path

import yaml

log = logging.getLogger(__name__)

# Hard walls. These are module-level constants, not config, on purpose:
# nothing in a YAML file may move them.
HARD_MAX_RISK_PCT = 2.0
HARD_MAX_LEVERAGE = 3.0
SOFT_MAX_LEVERAGE = 2.0   # above this we allow it, but complain loudly


@dataclass
class RiskConfig:
    """All risk settings. Every field is validated the moment it's created."""

    risk_per_trade_pct: float = 1.0      # rule #3
    max_leverage: float = 2.0            # rule #2
    daily_loss_limit_pct: float = 4.0    # rule #5 (of day-start equity)
    max_concurrent_positions: int = 2
    cooldown_hours_after_stop: float = 24.0
    live_trading: bool = False           # rule #1 — testnet unless flipped

    def __post_init__(self) -> None:
        if not (0 < self.risk_per_trade_pct <= HARD_MAX_RISK_PCT):
            raise ValueError(
                f"risk_per_trade_pct={self.risk_per_trade_pct} refused: must be "
                f"in (0, {HARD_MAX_RISK_PCT}]. This ceiling is not configurable."
            )
        if not (0 < self.max_leverage <= HARD_MAX_LEVERAGE):
            raise ValueError(
                f"max_leverage={self.max_leverage} refused: must be in "
                f"(0, {HARD_MAX_LEVERAGE}]. This ceiling is not configurable."
            )
        if self.max_leverage > SOFT_MAX_LEVERAGE:
            # Rule #2's "warn loudly": allowed, but you'll hear about it.
            log.warning(
                "max_leverage=%.1fx is above the recommended %.1fx. Leverage "
                "multiplies losses exactly as efficiently as gains.",
                self.max_leverage, SOFT_MAX_LEVERAGE,
            )
        if not (0 < self.daily_loss_limit_pct <= 10):
            raise ValueError("daily_loss_limit_pct must be in (0, 10].")
        if self.max_concurrent_positions < 1:
            raise ValueError("max_concurrent_positions must be >= 1.")
        if self.cooldown_hours_after_stop < 0:
            raise ValueError("cooldown_hours_after_stop cannot be negative.")
        if self.live_trading:
            # Rule #1's tripwire. Setting this flag alone must feel alarming.
            log.warning(
                "live_trading=True in config. This alone does NOT enable live "
                "trading (Phase 5 requires a separate confirmation), but check "
                "that you really meant it."
            )

    @classmethod
    def from_yaml(cls, path: str | Path = "config.yaml") -> "RiskConfig":
        with open(path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
        section = raw.get("risk") or {}
        valid = set(cls.__dataclass_fields__)
        unknown = set(section) - valid
        if unknown:
            raise ValueError(
                f"Unknown risk option(s) in config.yaml: {sorted(unknown)}. "
                f"Valid options: {sorted(valid)}"
            )
        return cls(**section)


# ---------------------------------------------------------------------- #
# Rule #4: mandatory, sane stop-loss
# ---------------------------------------------------------------------- #
def validate_protective_stop(side: int, entry_price: float, stop_price: float) -> None:
    """Raise unless the stop exists and sits on the PROTECTIVE side.

    A long's stop must be below entry (it cuts the loss when price falls);
    a short's stop must be above. A stop on the wrong side is worse than
    none — it would trigger instantly or never.
    """
    if side not in (1, -1):
        raise ValueError(f"side must be 1 (long) or -1 (short), got {side!r}.")
    if entry_price <= 0:
        raise ValueError(f"entry_price must be positive, got {entry_price}.")
    if stop_price is None or stop_price != stop_price or stop_price <= 0:  # x != x catches NaN
        raise ValueError("No valid stop-loss price. Rule #4: no stop, no trade.")
    if side == 1 and stop_price >= entry_price:
        raise ValueError(
            f"Long stop {stop_price} is not below entry {entry_price} — "
            "it would not protect anything."
        )
    if side == -1 and stop_price <= entry_price:
        raise ValueError(
            f"Short stop {stop_price} is not above entry {entry_price} — "
            "it would not protect anything."
        )


# ---------------------------------------------------------------------- #
# Rules #2 + #3: position sizing
# ---------------------------------------------------------------------- #
@dataclass
class SizedPosition:
    size: float        # base units (e.g. 0.5 ETH)
    notional: float    # size × entry price, in USDT
    leverage: float    # notional ÷ equity
    risk_amount: float # USDT lost if the stop is hit (excl. fees/slippage)


def position_size(
    equity: float,
    entry_price: float,
    stop_price: float,
    risk_per_trade_pct: float,
    max_leverage: float,
    side: int | None = None,
) -> SizedPosition:
    """Fixed-fractional sizing: risk a set % of equity between entry & stop.

        size = (equity × risk%) ÷ |entry − stop|

    Consequences worth internalizing:
      * wide stop (volatile market) → small position, automatically;
      * tight stop → big position — WHICH IS WHY the leverage cap then
        steps in and shrinks it. A tight stop is not a license to bet big.
    After a cap, the actual amount at risk is LESS than requested — the cap
    only ever makes positions smaller, never larger.
    """
    if equity <= 0:
        raise ValueError(f"equity must be positive, got {equity}.")
    # If the caller states which direction it intends to trade, validate the
    # stop against THAT intention — a short whose stop sits below entry must
    # be rejected, not silently re-interpreted as a long. Only infer the
    # side when the caller didn't state one.
    if side is None:
        side = 1 if stop_price < entry_price else -1
    validate_protective_stop(side, entry_price, stop_price)

    stop_distance = abs(entry_price - stop_price)
    risk_amount = equity * risk_per_trade_pct / 100.0
    size = risk_amount / stop_distance

    max_notional = equity * max_leverage
    if size * entry_price > max_notional:
        size = max_notional / entry_price          # rule #2 shrinks it
        risk_amount = size * stop_distance         # actual risk after cap

    notional = size * entry_price
    return SizedPosition(
        size=size, notional=notional,
        leverage=notional / equity, risk_amount=risk_amount,
    )


# ---------------------------------------------------------------------- #
# Rules #5 + #7 + psychology rules: the stateful gatekeeper
# ---------------------------------------------------------------------- #
@dataclass
class Decision:
    """An answer plus its reason — so logs always explain themselves."""
    allowed: bool
    reason: str

    def __bool__(self) -> bool:
        return self.allowed


@dataclass
class RiskManager:
    """The gatekeeper the trading engine must ask before every entry.

    Usage contract (Phase 5's engine follows this exactly):
        * call start_day_if_needed(now, equity) every loop tick,
        * call can_open_position(symbol, now) before entering — a False
          answer is final, not advisory,
        * call register_entry / register_exit around every position,
        * activate_kill_switch() stops everything, permanently for the
          life of the process.

    All methods take `now` explicitly instead of reading the clock — that
    makes every scenario testable (and the backtester can replay history
    through the exact same rules).
    """

    cfg: RiskConfig

    # --- internal state (all fields have defaults → constructible clean) ---
    _killed: bool = False
    _kill_reason: str = ""
    _current_day: date | None = None
    _day_start_equity: float = 0.0
    _daily_realized_pnl: float = 0.0
    _open_symbols: set = field(default_factory=set)
    _cooldown_until: dict = field(default_factory=dict)   # symbol → datetime

    # ---------------- rule #7: kill switch ----------------
    def activate_kill_switch(self, reason: str = "manual") -> None:
        self._killed = True
        self._kill_reason = reason
        log.critical("KILL SWITCH ACTIVATED (%s). No further entries this run.", reason)

    @property
    def killed(self) -> bool:
        return self._killed

    # ---------------- rule #5: daily circuit breaker ----------------
    def start_day_if_needed(self, now: datetime, equity: float) -> None:
        """On the first call of each UTC day: snapshot equity, reset PnL."""
        today = now.date()
        if self._current_day != today:
            self._current_day = today
            self._day_start_equity = equity
            self._daily_realized_pnl = 0.0

    def _circuit_breaker_tripped(self) -> bool:
        if self._day_start_equity <= 0:
            return False
        limit = self._day_start_equity * self.cfg.daily_loss_limit_pct / 100.0
        return self._daily_realized_pnl <= -limit

    # ---------------- bookkeeping the engine must do ----------------
    def register_entry(self, symbol: str) -> None:
        self._open_symbols.add(symbol)

    def register_exit(self, symbol: str, pnl: float, hit_stop: bool, now: datetime) -> None:
        """Record a closed trade: update daily PnL; start cooldown on stops."""
        self._open_symbols.discard(symbol)
        self._daily_realized_pnl += pnl
        if hit_stop and self.cfg.cooldown_hours_after_stop > 0:
            until = now + timedelta(hours=self.cfg.cooldown_hours_after_stop)
            self._cooldown_until[symbol] = until
            log.info("%s stopped out — cooldown until %s (anti-revenge-trading).",
                     symbol, until.isoformat())
        if self._circuit_breaker_tripped():
            log.warning(
                "DAILY CIRCUIT BREAKER: realized %.2f USDT today (limit %.1f%% "
                "of %.2f). No new entries until the next UTC day.",
                self._daily_realized_pnl, self.cfg.daily_loss_limit_pct,
                self._day_start_equity,
            )

    # ---------------- the one question that matters ----------------
    def can_open_position(self, symbol: str, now: datetime) -> Decision:
        """May the engine open a NEW position in `symbol` right now?

        Checks run strictest-first; the reason string says exactly which
        rule said no, so every refusal is self-explanatory in the logs.
        """
        if self._killed:
            return Decision(False, f"kill switch active ({self._kill_reason})")

        if self._circuit_breaker_tripped():
            return Decision(
                False,
                f"daily circuit breaker: {self._daily_realized_pnl:+.2f} USDT "
                f"today exceeds the {self.cfg.daily_loss_limit_pct}% limit",
            )

        if symbol in self._open_symbols:
            return Decision(False, f"position already open in {symbol}")

        if len(self._open_symbols) >= self.cfg.max_concurrent_positions:
            return Decision(
                False,
                f"already at max concurrent positions "
                f"({self.cfg.max_concurrent_positions})",
            )

        until = self._cooldown_until.get(symbol)
        if until is not None and now < until:
            return Decision(
                False, f"{symbol} in post-stop cooldown until {until.isoformat()}"
            )

        return Decision(True, "all risk checks passed")

    # ---------------- persistence (used by the live engine) ----------------
    # The engine restarts (crashes, reboots, deploys) but risk state must
    # not: a circuit breaker that forgets today's losses on restart, or a
    # cooldown that resets, would be a rule with a trivial bypass.
    def to_dict(self) -> dict:
        return {
            "killed": self._killed,
            "kill_reason": self._kill_reason,
            "current_day": self._current_day.isoformat() if self._current_day else None,
            "day_start_equity": self._day_start_equity,
            "daily_realized_pnl": self._daily_realized_pnl,
            "open_symbols": sorted(self._open_symbols),
            "cooldown_until": {s: t.isoformat() for s, t in self._cooldown_until.items()},
        }

    def restore(self, state: dict) -> None:
        """Load state saved by to_dict(). Unknown/missing keys keep defaults."""
        self._killed = bool(state.get("killed", False))
        self._kill_reason = state.get("kill_reason", "")
        day = state.get("current_day")
        self._current_day = date.fromisoformat(day) if day else None
        self._day_start_equity = float(state.get("day_start_equity", 0.0))
        self._daily_realized_pnl = float(state.get("daily_realized_pnl", 0.0))
        self._open_symbols = set(state.get("open_symbols", []))
        self._cooldown_until = {
            s: datetime.fromisoformat(t)
            for s, t in (state.get("cooldown_until") or {}).items()
        }
