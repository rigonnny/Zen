"""Tests for config loading and validation.

A note on why we bother testing "boring" code: the config module is the
front door for every user mistake (typos, bad dates, unsupported
timeframes). These tests pin down that each mistake produces a clear error
instead of a mystery crash later on.
"""

import pytest

from bot.config import load_config


def write_config(tmp_path, text: str):
    """Helper: write a temporary config.yaml and return its path.

    `tmp_path` is a pytest built-in: a fresh empty folder for each test,
    automatically deleted afterwards. Tests never touch the real config.
    """
    p = tmp_path / "config.yaml"
    p.write_text(text)
    return p


VALID = """
data:
  symbols: [BTCUSDT, ETHUSDT]
  timeframes: [4h, 1d]
  start_date: "2022-07-01"
  db_path: "data/test.db"
  fetch_funding_rates: true
"""


def test_valid_config_loads(tmp_path):
    cfg = load_config(write_config(tmp_path, VALID))
    assert cfg.symbols == ["BTCUSDT", "ETHUSDT"]
    assert cfg.timeframes == ["4h", "1d"]
    assert cfg.fetch_funding_rates is True


def test_start_ms_is_correct_utc(tmp_path):
    cfg = load_config(write_config(tmp_path, VALID))
    # 2022-07-01 00:00 UTC — checked against a known Unix timestamp.
    # This guards against the classic bug of accidentally using local time.
    assert cfg.start_ms() == 1656633600000


def test_missing_file_gives_clear_error(tmp_path):
    with pytest.raises(ValueError, match="not found"):
        load_config(tmp_path / "nope.yaml")


def test_bad_timeframe_rejected(tmp_path):
    bad = VALID.replace("[4h, 1d]", "[5m, 1d]")  # 5m = day-trading noise, not supported
    with pytest.raises(ValueError, match="not supported"):
        load_config(write_config(tmp_path, bad))


def test_bad_date_rejected(tmp_path):
    bad = VALID.replace('"2022-07-01"', '"01/07/2022"')
    with pytest.raises(ValueError, match="YYYY-MM-DD"):
        load_config(write_config(tmp_path, bad))


def test_lowercase_symbol_rejected(tmp_path):
    bad = VALID.replace("[BTCUSDT, ETHUSDT]", "[btcusdt]")
    with pytest.raises(ValueError, match="doesn't look like"):
        load_config(write_config(tmp_path, bad))


def test_empty_symbols_rejected(tmp_path):
    bad = VALID.replace("[BTCUSDT, ETHUSDT]", "[]")
    with pytest.raises(ValueError, match="empty"):
        load_config(write_config(tmp_path, bad))
