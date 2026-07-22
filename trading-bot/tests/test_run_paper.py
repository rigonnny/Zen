"""Tests for run_paper's config assembly (no network, no keys needed)."""

import pytest

from run_paper import load_engine_settings


def test_engine_section_overrides(tmp_path):
    p = tmp_path / "c.yaml"
    p.write_text(
        "engine:\n"
        "  state_file: 'data/other_state.json'\n"
        "  decision_log_dir: 'logs_other'\n"
        "  candle_history: 250\n"
    )
    s = load_engine_settings(p, trading_timeframe="1h")
    assert s.state_file == "data/other_state.json"
    assert s.decision_log_dir == "logs_other"
    assert s.candle_history == 250
    assert s.trading_timeframe == "1h"     # taken from data.timeframes[0]


def test_engine_section_optional(tmp_path):
    p = tmp_path / "c.yaml"
    p.write_text("data:\n  symbols: [BTCUSDT]\n")
    s = load_engine_settings(p, trading_timeframe="4h")
    assert s.state_file == "data/engine_state.json"    # defaults
    assert s.trading_timeframe == "4h"


def test_engine_section_rejects_typos(tmp_path):
    p = tmp_path / "c.yaml"
    p.write_text("engine:\n  state_fil: 'x.json'\n")
    with pytest.raises(ValueError, match="Unknown engine option"):
        load_engine_settings(p, trading_timeframe="4h")


def test_demo_playground_config_is_wired_apart():
    """The real point: demo and variant configs must never share state or
    logs, and the demo must be locked to testnet."""
    import yaml

    s = load_engine_settings("config_demo_playground.yaml", "1h")
    v = load_engine_settings("config_variant_ab.yaml", "4h")
    assert s.state_file != v.state_file
    assert s.decision_log_dir != v.decision_log_dir

    demo = yaml.safe_load(open("config_demo_playground.yaml"))
    assert demo["risk"]["live_trading"] is False
    assert demo["data"]["timeframes"] == ["1h"]
