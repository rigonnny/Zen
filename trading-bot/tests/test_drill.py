"""Tests for the fire drill — the forced demo entry."""

import pytest

from tests.test_engine import FLAT, NOW, FakeExchange, eng, logged_events  # noqa: F401


def test_drill_enters_without_any_signal(eng, tmp_path):
    """FLAT prices produce no signal ever — the drill enters anyway,
    through the real path: market order + stop, sized to risk 1%."""
    e, ex = eng(closes=FLAT)
    e.drill_entry("BTCUSDT", NOW)

    kinds = [o[0] for o in ex.orders]
    assert kinds == ["MARKET", "STOP"]
    assert "BTCUSDT" in e.positions
    meta = e.positions["BTCUSDT"]
    risked = (meta["entry_price"] - meta["stop"]) * meta["size"]
    assert risked == pytest.approx(100.0, rel=0.01)   # 1% of 10,000
    assert "drill" in logged_events(tmp_path)         # honestly labeled


def test_drill_refuses_outside_testnet(eng):
    ex = FakeExchange(closes=FLAT)
    ex.is_testnet = False
    e, _ = eng(ex=ex)
    with pytest.raises(RuntimeError, match="not the testnet"):
        e.drill_entry("BTCUSDT", NOW)
    assert ex.orders == []


def test_drill_respects_kill_file(eng, tmp_path):
    e, ex = eng(closes=FLAT)
    (tmp_path / "KILL").write_text("stop")
    e.drill_entry("BTCUSDT", NOW)
    assert ex.orders == []
    assert "drill_blocked" in logged_events(tmp_path)


def test_drill_respects_risk_gate(eng, tmp_path):
    e, ex = eng(closes=FLAT)
    e.risk.activate_kill_switch("test")
    e.drill_entry("BTCUSDT", NOW)
    assert ex.orders == []


def test_drill_skips_if_position_already_open(eng, tmp_path):
    e, ex = eng(closes=FLAT)
    e.drill_entry("BTCUSDT", NOW)
    orders_after_first = len(ex.orders)
    e.drill_entry("BTCUSDT", NOW)                     # second drill: no-op
    assert len(ex.orders) == orders_after_first
    assert "drill_skipped" in logged_events(tmp_path)


def test_drilled_position_is_then_managed_normally(eng, tmp_path):
    """After the drill, a normal tick must treat it like any position —
    here the FLAT market means it just holds, with the stop untouched."""
    e, ex = eng(closes=FLAT)
    e.drill_entry("BTCUSDT", NOW)
    ex.positions = [{"symbol": "BTCUSDT", "size": e.positions["BTCUSDT"]["size"],
                     "entry_price": 100.0, "unrealized_pnl": 0.0}]
    e.run_once(NOW)
    assert "holding" in logged_events(tmp_path)
    assert "BTCUSDT" in e.positions
