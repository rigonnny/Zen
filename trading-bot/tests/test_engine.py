"""Tests for the Phase 5 trading engine, using a fake exchange.

The FakeExchange records every order instead of sending it anywhere, and
serves hand-built candles. So these tests prove the engine's DECISIONS —
enters when it should, attaches stops, respects the risk gates, ratchets
trails, halts on the kill file — with zero network and zero randomness.
"""

import json
from datetime import datetime, timezone

import pytest

import bot.engine as engine_mod
from bot.engine import DecisionLogger, EngineSettings, TradingEngine
from bot.risk import RiskConfig
from bot.strategy import StrategyParams

NOW = datetime(2026, 7, 22, 12, 0, tzinfo=timezone.utc)
TF_MS = 14_400_000

# Small warm-ups so tests need few candles.
STRAT = StrategyParams(ema_fast=3, ema_slow=6, rsi_period=3, atr_period=3,
                       entry_mode="breakout", breakout_lookback=4,
                       exit_mode="trailing", trail_atr_mult=2.0)


def make_candles(closes):
    out = []
    prev = closes[0]
    for i, c in enumerate(closes):
        out.append({
            "symbol": "BTCUSDT", "timeframe": "4h",
            "open_time": 1656633600000 + i * TF_MS,
            "open": prev, "high": max(prev, c) + 1.0, "low": min(prev, c) - 1.0,
            "close": c, "volume": 1000.0,
            "close_time": 1656633600000 + (i + 1) * TF_MS - 1,
            "quote_volume": 1e5, "trade_count": 100,
        })
        prev = c
    return out


BREAKOUT = [100 + 2 * i for i in range(10)] + [118] * 4 + [125]   # ends in a signal
FLAT = [100.0] * 15                                               # never signals


class FakeExchange:
    """Looks like FuturesExchange to the engine; records everything."""

    def __init__(self, closes=None, balance=10_000.0):
        self.closes = closes or FLAT
        self.balance = balance
        self.positions = []          # what get_positions() returns
        self.orders = []             # every order the engine sent
        self.cancelled = []          # symbols whose orders were cancelled
        self.fail_stop_placement = False
        self.is_testnet = True

    def get_usdt_balance(self):
        return self.balance

    def get_positions(self):
        return self.positions

    def get_closed_candles(self, symbol, timeframe, limit=400):
        return make_candles(self.closes)

    def round_quantity(self, symbol, q):
        return round(q, 3)

    def min_viable_quantity(self, symbol, price):
        return 0.001

    def market_order(self, symbol, side, quantity, reduce_only=False):
        self.orders.append(("MARKET", symbol, side, quantity, reduce_only))
        return {"orderId": len(self.orders)}

    def place_stop_loss(self, symbol, position_side, stop_price):
        if self.fail_stop_placement:
            raise RuntimeError("exchange rejected stop")
        self.orders.append(("STOP", symbol, position_side, stop_price))
        return {"orderId": len(self.orders)}

    def cancel_all_orders(self, symbol):
        self.cancelled.append(symbol)


@pytest.fixture
def eng(tmp_path, monkeypatch):
    """Engine factory wired to temp dirs and a fake exchange."""
    monkeypatch.setattr(engine_mod, "KILL_FILE", tmp_path / "KILL")

    def build(closes=None, risk_overrides=None, ex=None):
        exchange = ex or FakeExchange(closes)
        settings = EngineSettings(
            trading_timeframe="4h",
            state_file=str(tmp_path / "state.json"),
            decision_log_dir=str(tmp_path / "logs"),
        )
        e = TradingEngine(exchange, STRAT, RiskConfig(**(risk_overrides or {})),
                          ["BTCUSDT"], settings,
                          DecisionLogger(tmp_path / "logs"))
        return e, exchange
    return build


def logged_events(tmp_path):
    lines = []
    for f in (tmp_path / "logs").glob("*.jsonl"):
        lines += [json.loads(l) for l in f.read_text().splitlines()]
    return [l["event"] for l in lines]


# ---------------------------------------------------------------------- #
def test_enters_on_signal_with_stop_attached(eng):
    e, ex = eng(closes=BREAKOUT)
    e.run_once(NOW)

    kinds = [o[0] for o in ex.orders]
    assert kinds == ["MARKET", "STOP"]          # entry then stop, immediately
    market, stop = ex.orders
    assert market[2] == "BUY"                   # breakout long
    assert stop[3] < 125                        # protective stop below entry
    assert "BTCUSDT" in e.positions
    # Sizing honored rule #3: risk ≈ 1% of 10,000 = 100 USDT.
    meta = e.positions["BTCUSDT"]
    risked = (meta["entry_price"] - meta["stop"]) * meta["size"]
    assert risked == pytest.approx(100.0, rel=0.01)


def test_no_signal_no_orders(eng, tmp_path):
    e, ex = eng(closes=FLAT)
    e.run_once(NOW)
    assert ex.orders == []
    assert "no_signal" in logged_events(tmp_path)   # silence is logged too


def test_stop_placement_failure_closes_position(eng, tmp_path):
    """Rule #4: if the stop can't be attached, the position must not live."""
    ex = FakeExchange(closes=BREAKOUT)
    ex.fail_stop_placement = True
    e, _ = eng(ex=ex)
    e.run_once(NOW)

    kinds = [(o[0], o[4] if o[0] == "MARKET" else None) for o in ex.orders]
    assert kinds == [("MARKET", False), ("MARKET", True)]   # entry, then undo
    assert e.positions == {}
    assert "entry_aborted" in logged_events(tmp_path)


def test_kill_file_halts_everything(eng, tmp_path, monkeypatch):
    e, ex = eng(closes=BREAKOUT)
    (tmp_path / "KILL").write_text("stop")
    e.run_once(NOW)
    assert ex.orders == []                      # not even with a valid signal
    assert e.risk.killed


def test_risk_block_is_logged_not_traded(eng, tmp_path):
    e, ex = eng(closes=BREAKOUT)
    e.risk.activate_kill_switch("test")
    e.run_once(NOW)
    assert ex.orders == []


def test_cooldown_blocks_reentry_after_remote_stop_hit(eng, tmp_path):
    """Engine thinks a position is open; exchange says flat → it must record
    a stop-hit (starting the cooldown) and NOT immediately re-enter on the
    still-valid signal."""
    e, ex = eng(closes=BREAKOUT)
    e.positions["BTCUSDT"] = {"side": 1, "size": 1.0, "entry_price": 120.0,
                              "stop": 110.0, "best_close": 120.0}
    ex.positions = []                           # exchange: flat
    e.run_once(NOW)

    events = logged_events(tmp_path)
    assert "stop_hit_while_away" in events
    assert "entry_blocked" in events            # cooldown said no
    assert ex.orders == []
    assert "BTCUSDT" not in e.positions


def test_trailing_stop_ratchets_via_exchange(eng, tmp_path):
    """Open long from 100 with stop 90; price runs to ~125 (ATR ≈ 2.3) →
    the engine must cancel and re-place a TIGHTER stop."""
    e, ex = eng(closes=BREAKOUT)
    e.positions["BTCUSDT"] = {"side": 1, "size": 1.0, "entry_price": 100.0,
                              "stop": 90.0, "best_close": 100.0}
    ex.positions = [{"symbol": "BTCUSDT", "size": 1.0, "entry_price": 100.0,
                     "unrealized_pnl": 0.0}]
    e.run_once(NOW)

    stops = [o for o in ex.orders if o[0] == "STOP"]
    assert len(stops) == 1
    assert stops[0][3] > 90.0                   # strictly tighter
    assert ex.cancelled == ["BTCUSDT"]          # old stop removed first
    assert e.positions["BTCUSDT"]["stop"] == pytest.approx(stops[0][3])


def test_unmanaged_position_left_alone(eng, tmp_path):
    """A position the bot didn't open (manual trade) must not be touched."""
    e, ex = eng(closes=BREAKOUT)
    ex.positions = [{"symbol": "BTCUSDT", "size": 5.0, "entry_price": 100.0,
                     "unrealized_pnl": 0.0}]
    e.run_once(NOW)
    assert ex.orders == []
    assert "unmanaged_position" in logged_events(tmp_path)


def test_state_survives_restart(eng, tmp_path):
    """Cooldowns and positions must come back after a process restart."""
    e1, ex1 = eng(closes=BREAKOUT)
    e1.run_once(NOW)                            # enters a position
    assert "BTCUSDT" in e1.positions

    # "Restart": build a new engine over the same state file. The exchange
    # still shows the position, so it should be managed, not re-entered.
    ex2 = FakeExchange(closes=BREAKOUT)
    ex2.positions = [{"symbol": "BTCUSDT", "size": 1.0, "entry_price": 125.0,
                      "unrealized_pnl": 0.0}]
    e2, _ = eng(ex=ex2)
    assert "BTCUSDT" in e2.positions            # remembered from state file
    e2.run_once(NOW)
    marketish = [o for o in ex2.orders if o[0] == "MARKET" and not o[4]]
    assert marketish == []                      # no duplicate entry


def test_risk_state_roundtrip():
    from bot.risk import RiskManager
    rm = RiskManager(cfg=RiskConfig())
    rm.start_day_if_needed(NOW, 10_000)
    rm.register_entry("BTCUSDT")
    rm.register_exit("BTCUSDT", -120.0, hit_stop=True, now=NOW)
    rm.activate_kill_switch("test")

    rm2 = RiskManager(cfg=RiskConfig())
    rm2.restore(rm.to_dict())
    assert rm2.killed
    assert not rm2.can_open_position("BTCUSDT", NOW)
    assert rm2.to_dict() == rm.to_dict()
