#!/usr/bin/env python3
"""Command-line entry point for the Phase 1 data pipeline.

Usage (from the trading-bot/ folder):

    python fetch_data.py              # download/update everything in config.yaml
    python fetch_data.py --verify     # only check the stored data for gaps
    python fetch_data.py --summary    # show what's currently in the database

The first run downloads full history (a few minutes); every later run only
fetches what's new (seconds). Interrupting with Ctrl+C is always safe —
progress is saved batch by batch, so just run it again.
"""

from __future__ import annotations

import argparse
import logging
import sys

from bot.config import load_config
from bot.data.pipeline import update_market_data, verify_data
from bot.data.storage import MarketDataStore


def print_summary(cfg) -> None:
    """Show a small table of what's stored locally."""
    with MarketDataStore(cfg.db_path) as store:
        print(f"\nDatabase: {cfg.db_path}")
        print(f"{'symbol':<10} {'timeframe':<10} {'candles':>8}   first → last (UTC)")
        print("-" * 72)
        for symbol in cfg.symbols:
            for tf in cfg.timeframes:
                df = store.load_candles(symbol, tf)
                if df.empty:
                    print(f"{symbol:<10} {tf:<10} {0:>8}   (no data yet)")
                else:
                    first = df.index[0].strftime("%Y-%m-%d %H:%M")
                    last = df.index[-1].strftime("%Y-%m-%d %H:%M")
                    print(f"{symbol:<10} {tf:<10} {len(df):>8}   {first} → {last}")
            funding = store.load_funding_rates(symbol)
            print(f"{symbol:<10} {'funding':<10} {len(funding):>8}")
        print()


def main() -> int:
    parser = argparse.ArgumentParser(description="Download/update local market data.")
    parser.add_argument("--config", default="config.yaml", help="path to config file")
    parser.add_argument("--verify", action="store_true",
                        help="only run the gap check, don't download")
    parser.add_argument("--summary", action="store_true",
                        help="only print what's stored, don't download")
    args = parser.parse_args()

    # Show INFO-level progress messages on screen with timestamps.
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    cfg = load_config(args.config)

    if args.summary:
        print_summary(cfg)
        return 0

    if args.verify:
        return 0 if verify_data(cfg) else 1

    # Normal mode: download, then immediately verify what we stored.
    update_market_data(cfg)
    clean = verify_data(cfg)
    print_summary(cfg)
    if not clean:
        print("WARNING: gaps were found — see messages above. "
              "Usually re-running this command fixes them.")
        return 1
    return 0


if __name__ == "__main__":
    # sys.exit passes our return code to the shell: 0 = success, 1 = problem.
    # Scripts that report failure honestly are easier to automate later.
    sys.exit(main())
