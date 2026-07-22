"""Tests for the risk-management module — the seven safety rules.

These tests are the project's most important ones: a bug in strategy code
loses an edge; a bug in risk code loses an account. Every rule gets both a
"blocks what it should" and an "allows what it should" test — a risk system
that blocks everything is as broken as one that blocks nothing.
"""

from datetime import datetime, timedelta, timezone

import pytest

from bot.risk import (
    Decision,
    RiskConfig,
    RiskManager,
    position_size,
    validate_protective_stop,
)

T0 = datetime(2026, 7, 22, 10, 0, tzinfo=timezone.utc)


def manager(**cfg_overrides) -> RiskManager:
    rm = RiskManager(cfg=RiskConfig(**cfg_overrides))
    rm.start_day_if_needed(T0, equity=10_000.0)
    return rm


# ---------------------------------------------------------------------- #
# RiskConfig validation (rules #1, #2, #3 at the config level)
# ---------------------------------------------------------------------- #
def test_config_defaults_are_the_safe_ones():
    cfg = RiskConfig()
    assert cfg.live_trading is False            # rule #1: testnet by default
    assert cfg.max_leverage <= 2.0              # rule #2
    assert cfg.risk_per_trade_pct <= 1.0        # rule #3


def test_config_refuses_excess_risk_and_leverage():
    with pytest.raises(ValueError, match="risk_per_trade_pct"):
        RiskConfig(risk_per_trade_pct=2.5)      # > hard max 2%
    with pytest.raises(ValueError, match="max_leverage"):
        RiskConfig(max_leverage=5.0)            # > hard max 3x
    with pytest.raises(ValueError, match="daily_loss_limit_pct"):
        RiskConfig(daily_loss_limit_pct=50.0)


def test_config_warns_loudly_when_leverage_raised(caplog):
    """Rule #2's second half: 2x < leverage <= 3x is allowed but noisy."""
    import logging
    with caplog.at_level(logging.WARNING):
        RiskConfig(max_leverage=3.0)
    assert any("above the recommended" in r.message for r in caplog.records)


def test_config_from_yaml_rejects_typos(tmp_path):
    p = tmp_path / "c.yaml"
    p.write_text("risk:\n  risk_per_trade_pc: 1.0\n")   # missing 't'
    with pytest.raises(ValueError, match="Unknown risk option"):
        RiskConfig.from_yaml(p)


# ---------------------------------------------------------------------- #
# Rule #4: mandatory protective stop
# ---------------------------------------------------------------------- #
def test_stop_must_exist():
    with pytest.raises(ValueError, match="no stop, no trade"):
        validate_protective_stop(1, 100.0, float("nan"))
    with pytest.raises(ValueError, match="no stop, no trade"):
        validate_protective_stop(1, 100.0, None)


def test_stop_must_be_on_protective_side():
    validate_protective_stop(1, 100.0, 95.0)      # good long stop: below
    validate_protective_stop(-1, 100.0, 105.0)    # good short stop: above
    with pytest.raises(ValueError, match="not below"):
        validate_protective_stop(1, 100.0, 105.0)   # long stop above = useless
    with pytest.raises(ValueError, match="not above"):
        validate_protective_stop(-1, 100.0, 95.0)   # short stop below = useless
    with pytest.raises(ValueError, match="not below"):
        validate_protective_stop(1, 100.0, 100.0)   # stop == entry


# ---------------------------------------------------------------------- #
# Rules #2 + #3: position sizing
# ---------------------------------------------------------------------- #
def test_sizing_risks_exactly_the_configured_fraction():
    """10,000 equity, 1% risk = 100 USDT; stop 10 away → size 10 units."""
    s = position_size(10_000, 100.0, 90.0, risk_per_trade_pct=1.0, max_leverage=2.0)
    assert s.size == pytest.approx(10.0)
    assert s.risk_amount == pytest.approx(100.0)
    assert s.leverage == pytest.approx(0.1)     # 1,000 notional / 10,000


def test_leverage_cap_shrinks_tight_stop_positions():
    """Stop 0.1 away → naive size 1000 units = 100,000 notional = 10x.
    Cap at 2x → 200 units, and actual risk drops to 20 USDT (not 100)."""
    s = position_size(10_000, 100.0, 99.9, risk_per_trade_pct=1.0, max_leverage=2.0)
    assert s.size == pytest.approx(200.0)
    assert s.leverage == pytest.approx(2.0)
    assert s.risk_amount == pytest.approx(20.0)  # cap only ever REDUCES risk


def test_sizing_rejects_wrong_side_stop_for_stated_side():
    """A short whose stop is below entry must be refused, not silently
    treated as a long (the bug the explicit `side` argument prevents)."""
    with pytest.raises(ValueError, match="not above"):
        position_size(10_000, 100.0, 90.0, 1.0, 2.0, side=-1)


def test_sizing_short_mirror():
    s = position_size(10_000, 100.0, 110.0, 1.0, 2.0, side=-1)
    assert s.size == pytest.approx(10.0)
    assert s.risk_amount == pytest.approx(100.0)


# ---------------------------------------------------------------------- #
# Rule #5: daily loss circuit breaker
# ---------------------------------------------------------------------- #
def test_circuit_breaker_trips_after_daily_limit():
    rm = manager(daily_loss_limit_pct=4.0)      # 4% of 10,000 = 400 USDT
    assert rm.can_open_position("BTCUSDT", T0)

    rm.register_entry("BTCUSDT")
    rm.register_exit("BTCUSDT", pnl=-250.0, hit_stop=False, now=T0)
    assert rm.can_open_position("BTCUSDT", T0)  # -250: still under the limit

    rm.register_entry("BTCUSDT")
    rm.register_exit("BTCUSDT", pnl=-200.0, hit_stop=False, now=T0)
    d = rm.can_open_position("BTCUSDT", T0)     # -450: tripped
    assert not d
    assert "circuit breaker" in d.reason


def test_profits_offset_losses_within_the_day():
    rm = manager(daily_loss_limit_pct=4.0)
    rm.register_entry("A"); rm.register_exit("A", +300.0, False, T0)
    rm.register_entry("A"); rm.register_exit("A", -450.0, False, T0)
    # Net -150 — breaker (limit 400) must NOT be tripped.
    assert rm.can_open_position("A", T0)


def test_circuit_breaker_resets_next_utc_day():
    rm = manager(daily_loss_limit_pct=4.0)
    rm.register_entry("A"); rm.register_exit("A", -500.0, False, T0)
    assert not rm.can_open_position("A", T0)

    next_day = T0 + timedelta(days=1)
    rm.start_day_if_needed(next_day, equity=9_500.0)
    assert rm.can_open_position("A", next_day)  # new day, fresh allowance


# ---------------------------------------------------------------------- #
# Rule #7: kill switch
# ---------------------------------------------------------------------- #
def test_kill_switch_blocks_everything_permanently():
    rm = manager()
    assert rm.can_open_position("BTCUSDT", T0)
    rm.activate_kill_switch("user pressed the big red button")
    d = rm.can_open_position("BTCUSDT", T0)
    assert not d and "kill switch" in d.reason
    # Not even a new day lifts it.
    next_day = T0 + timedelta(days=2)
    rm.start_day_if_needed(next_day, equity=10_000.0)
    assert not rm.can_open_position("BTCUSDT", next_day)
    assert rm.killed


# ---------------------------------------------------------------------- #
# Psychology rules: concurrency cap + post-stop cooldown
# ---------------------------------------------------------------------- #
def test_max_concurrent_positions():
    rm = manager(max_concurrent_positions=2)
    rm.register_entry("BTCUSDT")
    rm.register_entry("ETHUSDT")
    d = rm.can_open_position("SOLUSDT", T0)
    assert not d and "max concurrent" in d.reason
    rm.register_exit("BTCUSDT", +10.0, False, T0)   # one closes...
    assert rm.can_open_position("SOLUSDT", T0)      # ...slot frees up


def test_no_second_position_in_same_symbol():
    rm = manager()
    rm.register_entry("BTCUSDT")
    d = rm.can_open_position("BTCUSDT", T0)
    assert not d and "already open" in d.reason


def test_cooldown_after_stop_loss_only():
    rm = manager(cooldown_hours_after_stop=24.0)
    # A NON-stop exit (target/flip) causes no cooldown:
    rm.register_entry("BTCUSDT")
    rm.register_exit("BTCUSDT", +150.0, hit_stop=False, now=T0)
    assert rm.can_open_position("BTCUSDT", T0)

    # A stop-loss exit does:
    rm.register_entry("BTCUSDT")
    rm.register_exit("BTCUSDT", -100.0, hit_stop=True, now=T0)
    d = rm.can_open_position("BTCUSDT", T0 + timedelta(hours=23))
    assert not d and "cooldown" in d.reason
    # Other symbols are unaffected (the loss was BTC's, not ETH's):
    assert rm.can_open_position("ETHUSDT", T0)
    # And it expires:
    assert rm.can_open_position("BTCUSDT", T0 + timedelta(hours=25))


# ---------------------------------------------------------------------- #
# Decision ergonomics
# ---------------------------------------------------------------------- #
def test_decision_is_truthy_and_explains_itself():
    assert Decision(True, "ok")
    assert not Decision(False, "nope")
    rm = manager()
    assert "passed" in rm.can_open_position("BTCUSDT", T0).reason
