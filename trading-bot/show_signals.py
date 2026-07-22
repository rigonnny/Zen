#!/usr/bin/env python3
"""See what the strategy thinks of your real, downloaded data.

Usage (from the trading-bot/ folder, after `python fetch_data.py`):

    python show_signals.py               # recent signals for everything
    python show_signals.py --last 20     # show up to 20 most recent signals
    python show_signals.py --all         # every signal in the whole history

This is a READ-ONLY tool: it computes signals over stored candles and
prints them with a plain-English explanation. Nothing is traded, nothing
is sent anywhere. It exists so you can eyeball the strategy's behavior —
open a chart of BTCUSDT, find a few of the printed dates, and check the
story matches ("yes, that was an uptrend; yes, price had just dipped").

Expect the signal list to look SPARSE. A trend-following swing strategy on
4h/1d candles trades a handful of times per month per market, not per day.
Long quiet stretches are the strategy working as designed, not a bug.
"""

from __future__ import annotations

import argparse

from bot.config import load_config
from bot.data.storage import MarketDataStore
from bot.strategy import NONE, StrategyParams, explain_row, generate_signals


def main() -> None:
    parser = argparse.ArgumentParser(description="Print recent strategy signals.")
    parser.add_argument("--config", default="config.yaml")
    parser.add_argument("--last", type=int, default=10,
                        help="max signals to show per symbol/timeframe (default 10)")
    parser.add_argument("--all", action="store_true", help="show the full history")
    args = parser.parse_args()

    cfg = load_config(args.config)
    params = StrategyParams.from_yaml(args.config)

    with MarketDataStore(cfg.db_path) as store:
        for symbol in cfg.symbols:
            for timeframe in cfg.timeframes:
                candles = store.load_candles(symbol, timeframe)
                if candles.empty:
                    print(f"\n=== {symbol} {timeframe}: no data — "
                          "run `python fetch_data.py` first.")
                    continue

                result = generate_signals(candles, params)
                # Rows worth showing: entries, plus trend-flip exits.
                interesting = result[
                    (result["signal"] != NONE) | result["exit_long"] | result["exit_short"]
                ]
                shown = interesting if args.all else interesting.tail(args.last)

                print(f"\n=== {symbol} {timeframe} — {len(interesting)} events "
                      f"across {len(result)} candles "
                      f"({len(result) and len(interesting) / len(result) * 100:.1f}% of candles)")
                if shown.empty:
                    print("  (none)")
                for ts, row in shown.iterrows():
                    print(f"  {ts:%Y-%m-%d %H:%M} UTC  {explain_row(row, params)}")

    print(
        "\nReminder: these are historical signals, shown for understanding — "
        "whether following them would have MADE money (after fees, funding "
        "and slippage) is exactly what Phase 3's backtester will measure."
    )


if __name__ == "__main__":
    main()
