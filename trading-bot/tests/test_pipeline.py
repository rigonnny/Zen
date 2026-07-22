"""Tests for the pipeline: incremental updates and gap detection."""

from bot.config import DataConfig
from bot.data.pipeline import find_gaps, update_market_data, verify_data
from bot.data.storage import MarketDataStore
from tests.test_storage import make_candle

TF_4H_MS = 14_400_000

# A start date whose timestamp is easy to reason about; the fake client
# below ignores it anyway.
BASE = 1656633600000  # 2022-07-01 00:00 UTC


def cfg_for(tmp_path, **overrides) -> DataConfig:
    defaults = dict(
        symbols=["BTCUSDT"],
        timeframes=["4h"],
        start_date="2022-07-01",
        db_path=str(tmp_path / "t.db"),
        fetch_funding_rates=False,
    )
    defaults.update(overrides)
    return DataConfig(**defaults)


class ScriptedClient:
    """A fake BinancePublicClient that records what was asked of it.

    It "has" candles from BASE onward and returns only the ones at or after
    the requested start time — mimicking how the real API responds to an
    incremental request.
    """

    def __init__(self, candle_open_times, funding_times=()):
        self.candle_open_times = list(candle_open_times)
        self.funding_times = list(funding_times)
        self.kline_calls = []
        self.funding_calls = []

    def iter_klines(self, symbol, timeframe, start_ms, end_ms=None):
        self.kline_calls.append((symbol, timeframe, start_ms))
        batch = [
            make_candle(t, symbol=symbol, timeframe=timeframe)
            for t in self.candle_open_times
            if t >= start_ms
        ]
        if batch:
            yield batch

    def iter_funding_rates(self, symbol, start_ms, end_ms=None):
        self.funding_calls.append((symbol, start_ms))
        batch = [
            {"symbol": symbol, "funding_time": t, "funding_rate": 0.0001}
            for t in self.funding_times
            if t >= start_ms
        ]
        if batch:
            yield batch


def test_first_run_downloads_from_start_date(tmp_path):
    cfg = cfg_for(tmp_path)
    client = ScriptedClient([BASE, BASE + TF_4H_MS])
    store = MarketDataStore(cfg.db_path)

    written = update_market_data(cfg, client=client, store=store)

    assert written["BTCUSDT:4h"] == 2
    # The request must have started at the configured start date.
    assert client.kline_calls[0] == ("BTCUSDT", "4h", cfg.start_ms())


def test_second_run_is_incremental(tmp_path):
    """Run twice: the second run must only ask for candles it doesn't have."""
    cfg = cfg_for(tmp_path)
    store = MarketDataStore(cfg.db_path)

    update_market_data(cfg, client=ScriptedClient([BASE, BASE + TF_4H_MS]), store=store)

    client2 = ScriptedClient([BASE, BASE + TF_4H_MS, BASE + 2 * TF_4H_MS])
    written = update_market_data(cfg, client=client2, store=store)

    # Asked to start exactly one candle-length after the newest stored one:
    assert client2.kline_calls[0] == ("BTCUSDT", "4h", BASE + 2 * TF_4H_MS)
    # ...and therefore only 1 new candle was written, not 3.
    assert written["BTCUSDT:4h"] == 1
    assert store.candle_count("BTCUSDT", "4h") == 3


def test_funding_rates_fetched_when_enabled(tmp_path):
    cfg = cfg_for(tmp_path, fetch_funding_rates=True)
    client = ScriptedClient([BASE], funding_times=[BASE, BASE + 1000])
    store = MarketDataStore(cfg.db_path)

    written = update_market_data(cfg, client=client, store=store)

    assert written["BTCUSDT:funding"] == 2
    # Incremental logic for funding too: second run starts after latest+1.
    client2 = ScriptedClient([BASE], funding_times=[BASE, BASE + 1000])
    update_market_data(cfg, client=client2, store=store)
    assert client2.funding_calls[0] == ("BTCUSDT", BASE + 1000 + 1)


def test_find_gaps_detects_missing_candle(tmp_path):
    with MarketDataStore(tmp_path / "t.db") as store:
        # Candles at hours 0, 4, and 12 — the candle at hour 8 is missing.
        store.save_candles([
            make_candle(BASE),
            make_candle(BASE + TF_4H_MS),
            make_candle(BASE + 3 * TF_4H_MS),
        ])
        gaps = find_gaps(store, "BTCUSDT", "4h")

    assert gaps == [(BASE + 2 * TF_4H_MS, BASE + 3 * TF_4H_MS)]


def test_find_gaps_clean_data_has_none(tmp_path):
    with MarketDataStore(tmp_path / "t.db") as store:
        store.save_candles([make_candle(BASE + i * TF_4H_MS) for i in range(10)])
        assert find_gaps(store, "BTCUSDT", "4h") == []


def test_verify_data_reports_overall_status(tmp_path):
    cfg = cfg_for(tmp_path)
    store = MarketDataStore(cfg.db_path)
    store.save_candles([make_candle(BASE), make_candle(BASE + TF_4H_MS)])
    assert verify_data(cfg, store=store) is True

    store.save_candles([make_candle(BASE + 5 * TF_4H_MS)])  # creates a gap
    assert verify_data(cfg, store=store) is False
