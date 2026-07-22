"""Tests for the SQLite storage layer."""

import pandas as pd

from bot.data.storage import MarketDataStore


def make_candle(open_time: int, close: float = 100.0, symbol="BTCUSDT", timeframe="4h") -> dict:
    """Helper: build one fake candle dict with sensible defaults."""
    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "open_time": open_time,
        "open": 99.0,
        "high": 101.0,
        "low": 98.0,
        "close": close,
        "volume": 1000.0,
        "close_time": open_time + 14_400_000 - 1,  # 4h later, minus 1ms
        "quote_volume": 100_000.0,
        "trade_count": 500,
    }


def test_save_and_load_roundtrip(tmp_path):
    """What we save is exactly what we get back, in time order."""
    with MarketDataStore(tmp_path / "t.db") as store:
        # Save deliberately OUT of order — the store must sort on read.
        store.save_candles([make_candle(14_400_000), make_candle(0)])
        df = store.load_candles("BTCUSDT", "4h")

    assert len(df) == 2
    assert df.index.is_monotonic_increasing          # sorted by time
    assert isinstance(df.index, pd.DatetimeIndex)    # real datetimes, not ints
    assert str(df.index.tz) == "UTC"                 # and explicitly UTC
    assert df.iloc[0]["close"] == 100.0


def test_duplicate_candles_are_not_double_stored(tmp_path):
    """Saving the same candle twice must leave exactly one row.

    This is the property that makes re-running the pipeline always safe.
    """
    with MarketDataStore(tmp_path / "t.db") as store:
        store.save_candles([make_candle(0, close=100.0)])
        store.save_candles([make_candle(0, close=105.0)])  # same candle, newer data
        df = store.load_candles("BTCUSDT", "4h")

    assert len(df) == 1
    assert df.iloc[0]["close"] == 105.0  # the re-save overwrote the old row


def test_symbols_and_timeframes_are_kept_separate(tmp_path):
    """BTCUSDT-4h data must never leak into ETHUSDT or 1d queries."""
    with MarketDataStore(tmp_path / "t.db") as store:
        store.save_candles([make_candle(0, symbol="BTCUSDT", timeframe="4h")])
        store.save_candles([make_candle(0, symbol="ETHUSDT", timeframe="4h")])
        store.save_candles([make_candle(0, symbol="BTCUSDT", timeframe="1d")])

        assert store.candle_count("BTCUSDT", "4h") == 1
        assert store.candle_count("ETHUSDT", "4h") == 1
        assert store.candle_count("BTCUSDT", "1d") == 1
        assert store.candle_count("ETHUSDT", "1d") == 0


def test_latest_candle_time(tmp_path):
    with MarketDataStore(tmp_path / "t.db") as store:
        assert store.latest_candle_time("BTCUSDT", "4h") is None  # empty db
        store.save_candles([make_candle(0), make_candle(14_400_000)])
        assert store.latest_candle_time("BTCUSDT", "4h") == 14_400_000


def test_funding_rates_roundtrip(tmp_path):
    with MarketDataStore(tmp_path / "t.db") as store:
        assert store.latest_funding_time("BTCUSDT") is None
        store.save_funding_rates([
            {"symbol": "BTCUSDT", "funding_time": 1000, "funding_rate": 0.0001},
            {"symbol": "BTCUSDT", "funding_time": 2000, "funding_rate": -0.0002},
            # a duplicate — must overwrite, not duplicate:
            {"symbol": "BTCUSDT", "funding_time": 2000, "funding_rate": -0.0003},
        ])
        df = store.load_funding_rates("BTCUSDT")
        assert store.latest_funding_time("BTCUSDT") == 2000

    assert len(df) == 2
    assert df.iloc[1]["funding_rate"] == -0.0003


def test_empty_load_returns_empty_dataframe(tmp_path):
    """Asking for data we don't have gives an empty frame, not a crash."""
    with MarketDataStore(tmp_path / "t.db") as store:
        assert store.load_candles("BTCUSDT", "4h").empty
        assert store.load_funding_rates("BTCUSDT").empty
