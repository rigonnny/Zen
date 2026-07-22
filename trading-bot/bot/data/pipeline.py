"""Ties the pieces together: download what's missing, store it, verify it.

The flow for each symbol × timeframe pair:

    1. Ask the database: "what's the newest candle I already have?"
    2. Download only candles newer than that (or from `start_date` if the
       database is empty). This is called an *incremental* update — the
       first run downloads years of history, every later run takes seconds.
    3. Save each batch as it arrives, so an interrupted download loses
       nothing — just run the command again and it continues.
    4. Afterwards, run a data-quality check that looks for gaps (missing
       candles). Bad data in means garbage backtests out, so we verify
       instead of assuming.
"""

from __future__ import annotations

import logging

from bot.config import DataConfig
from bot.data.binance_client import TIMEFRAME_MS, BinancePublicClient
from bot.data.storage import MarketDataStore

log = logging.getLogger(__name__)


def update_market_data(
    cfg: DataConfig,
    client: BinancePublicClient | None = None,
    store: MarketDataStore | None = None,
) -> dict[str, int]:
    """Bring the local database up to date. Returns rows written per dataset.

    The `client` and `store` parameters exist mainly for testing: the unit
    tests pass in a fake client that returns canned data, so we can prove
    this logic is correct without touching the real internet. This pattern
    is called *dependency injection* — fancy name, simple idea.
    """
    client = client or BinancePublicClient()
    store = store or MarketDataStore(cfg.db_path)
    written: dict[str, int] = {}

    for symbol in cfg.symbols:
        # --- Candles, one timeframe at a time ---
        for timeframe in cfg.timeframes:
            latest = store.latest_candle_time(symbol, timeframe)
            if latest is None:
                start_ms = cfg.start_ms()
                log.info("%s %s: empty locally — downloading from %s.",
                         symbol, timeframe, cfg.start_date)
            else:
                # Start one candle-length after the newest one we have.
                start_ms = latest + TIMEFRAME_MS[timeframe]
                log.info("%s %s: updating incrementally.", symbol, timeframe)

            rows = 0
            for batch in client.iter_klines(symbol, timeframe, start_ms):
                rows += store.save_candles(batch)
            written[f"{symbol}:{timeframe}"] = rows
            log.info("%s %s: wrote %d new candles (total stored: %d).",
                     symbol, timeframe, rows, store.candle_count(symbol, timeframe))

        # --- Funding rates (per symbol, not per timeframe) ---
        if cfg.fetch_funding_rates:
            latest_f = store.latest_funding_time(symbol)
            start_ms = cfg.start_ms() if latest_f is None else latest_f + 1
            rows = 0
            for batch in client.iter_funding_rates(symbol, start_ms):
                rows += store.save_funding_rates(batch)
            written[f"{symbol}:funding"] = rows
            log.info("%s funding: wrote %d new rows.", symbol, rows)

    return written


def find_gaps(store: MarketDataStore, symbol: str, timeframe: str) -> list[tuple[int, int]]:
    """Return (expected_open_time, actual_next_open_time) for every gap.

    In a perfect dataset, consecutive 4h candles are exactly 4 hours apart.
    A bigger jump means candles are missing — usually an exchange outage or
    an interrupted download. We report gaps instead of silently ignoring
    them, because an indicator computed across an unnoticed 3-day hole
    would quietly produce nonsense.
    """
    times = store.candle_open_times(symbol, timeframe)
    if len(times) < 2:
        return []

    tf_ms = TIMEFRAME_MS[timeframe]

    gaps = []
    for prev, nxt in zip(times, times[1:]):
        if nxt - prev != tf_ms:
            gaps.append((prev + tf_ms, nxt))
    return gaps


def verify_data(cfg: DataConfig, store: MarketDataStore | None = None) -> bool:
    """Run the gap check for every symbol/timeframe. True = all clean."""
    store = store or MarketDataStore(cfg.db_path)
    all_clean = True

    for symbol in cfg.symbols:
        for timeframe in cfg.timeframes:
            count = store.candle_count(symbol, timeframe)
            gaps = find_gaps(store, symbol, timeframe)
            if gaps:
                all_clean = False
                log.warning("%s %s: %d candles, %d GAP(S) found:",
                            symbol, timeframe, count, len(gaps))
                for expected, actual in gaps[:10]:  # show at most 10
                    log.warning("  expected candle at %d, next stored is %d", expected, actual)
                log.warning("  Fix: usually just re-run `python fetch_data.py`.")
            else:
                log.info("%s %s: %d candles, no gaps. ✔", symbol, timeframe, count)

    return all_clean
