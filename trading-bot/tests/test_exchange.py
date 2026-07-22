"""Tests for the exchange client: signing math and the testnet gate.

No network involved — we test the parts that must be correct BEFORE any
request leaves the machine.
"""

import pytest

from bot.exchange import (
    LIVE_BASE_URL,
    LIVE_CONFIRM_PHRASE,
    TESTNET_BASE_URL,
    ExchangeError,
    FuturesExchange,
)


def make(monkeypatch, live_cfg=False, confirm=None):
    if confirm is None:
        monkeypatch.delenv("CONFIRM_LIVE_TRADING", raising=False)
    else:
        monkeypatch.setenv("CONFIRM_LIVE_TRADING", confirm)
    return FuturesExchange("test-key", "test-secret", live_trading_config=live_cfg)


# ---------------------------------------------------------------------- #
# Rule #1: the testnet gate
# ---------------------------------------------------------------------- #
def test_defaults_to_testnet(monkeypatch):
    ex = make(monkeypatch)
    assert ex.is_testnet
    assert ex.base_url == TESTNET_BASE_URL


def test_config_flag_alone_is_not_enough_for_live(monkeypatch):
    """live_trading: true in YAML without the env phrase → still testnet."""
    ex = make(monkeypatch, live_cfg=True)
    assert ex.is_testnet


def test_env_phrase_alone_is_not_enough_for_live(monkeypatch):
    """The env phrase without the config flag → still testnet."""
    ex = make(monkeypatch, live_cfg=False, confirm=LIVE_CONFIRM_PHRASE)
    assert ex.is_testnet


def test_wrong_phrase_refuses_to_start(monkeypatch):
    """A garbled confirmation is treated as operator error, not testnet."""
    with pytest.raises(ExchangeError, match="Refusing to start"):
        make(monkeypatch, live_cfg=True, confirm="i-accept-whatever")


def test_both_flag_and_exact_phrase_enable_live(monkeypatch):
    ex = make(monkeypatch, live_cfg=True, confirm=LIVE_CONFIRM_PHRASE)
    assert not ex.is_testnet
    assert ex.base_url == LIVE_BASE_URL


def test_missing_keys_rejected(monkeypatch):
    with pytest.raises(ExchangeError, match="Missing API key"):
        FuturesExchange("", "")


# ---------------------------------------------------------------------- #
# Request signing
# ---------------------------------------------------------------------- #
def test_signature_matches_reference_hmac(monkeypatch):
    """Check our signing against an independently computed HMAC-SHA256.

    (Computed with Python's hmac directly — if bot code and this test ever
    disagree, the bot's request would be rejected by Binance anyway; this
    test catches it before any network call.)
    """
    import hashlib
    import hmac as hmac_mod
    from urllib.parse import urlencode

    ex = make(monkeypatch)
    params = {"symbol": "BTCUSDT", "side": "BUY", "type": "MARKET",
              "quantity": 0.5, "timestamp": 1700000000000}
    expected = hmac_mod.new(b"test-secret", urlencode(params).encode(),
                            hashlib.sha256).hexdigest()
    assert ex._sign(params) == expected


def test_signature_depends_on_every_param(monkeypatch):
    ex = make(monkeypatch)
    a = ex._sign({"symbol": "BTCUSDT", "timestamp": 1})
    b = ex._sign({"symbol": "BTCUSDT", "timestamp": 2})
    assert a != b


# ---------------------------------------------------------------------- #
# Rounding helpers (with a stubbed filter cache — no network)
# ---------------------------------------------------------------------- #
def stub_filters(ex):
    ex._filters = {"BTCUSDT": {
        "step_size": 0.001, "min_qty": 0.001,
        "tick_size": 0.10, "min_notional": 100.0,
    }}


def test_quantity_rounds_down_never_up(monkeypatch):
    ex = make(monkeypatch)
    stub_filters(ex)
    # 0.0129 → 0.012, not 0.013: rounding UP would oversize the position.
    assert ex.round_quantity("BTCUSDT", 0.0129) == pytest.approx(0.012)


def test_price_rounds_to_tick(monkeypatch):
    ex = make(monkeypatch)
    stub_filters(ex)
    assert ex.round_price("BTCUSDT", 64123.456) == pytest.approx(64123.4)


def test_min_viable_quantity_respects_notional(monkeypatch):
    ex = make(monkeypatch)
    stub_filters(ex)
    # At price 50,000: min notional 100 USDT → 0.002; bigger than min_qty.
    assert ex.min_viable_quantity("BTCUSDT", 50_000) == pytest.approx(0.002)
