#!/usr/bin/env python3
"""Phase 5 entry point: run the bot against Binance Futures TESTNET.

Setup (one time):
    1. Create testnet keys at https://testnet.binancefuture.com
       (log in with GitHub/Google — it's a sandbox with pretend money).
    2. cp .env.example .env   and fill in BINANCE_TESTNET_API_KEY/SECRET.

Run:
    python run_paper.py            # loop forever: acts once per closed candle
    python run_paper.py --once     # single tick, then exit (good for cron)

Stop:
    Ctrl+C stops the LOOP but leaves any open position protected by its
    server-side stop on the exchange.
    python kill_switch.py flattens everything and halts the bot.

The engine logs every decision to logs/decisions-YYYYMMDD.jsonl — including
every 'did nothing because ...'. That file is the answer to "what was the
bot thinking?".
"""

from __future__ import annotations

import argparse
import logging
import os
import time

from dotenv import load_dotenv

from bot.config import load_config
from bot.data.binance_client import TIMEFRAME_MS
from bot.engine import EngineSettings, TradingEngine
from bot.exchange import FuturesExchange
from bot.risk import RiskConfig
from bot.strategy import StrategyParams

log = logging.getLogger(__name__)


def build_engine(config_path: str) -> tuple:
    """Assemble all the pieces from config + .env."""
    load_dotenv()   # reads .env into environment variables

    cfg = load_config(config_path)
    strategy = StrategyParams.from_yaml(config_path)
    risk_cfg = RiskConfig.from_yaml(config_path)

    if risk_cfg.live_trading:
        key = os.environ.get("BINANCE_LIVE_API_KEY", "")
        secret = os.environ.get("BINANCE_LIVE_API_SECRET", "")
    else:
        key = os.environ.get("BINANCE_TESTNET_API_KEY", "")
        secret = os.environ.get("BINANCE_TESTNET_API_SECRET", "")

    exchange = FuturesExchange(key, secret, live_trading_config=risk_cfg.live_trading)

    settings = EngineSettings(trading_timeframe=cfg.timeframes[0])
    engine = TradingEngine(exchange, strategy, risk_cfg, cfg.symbols, settings)
    return engine, settings


def seconds_until_next_candle(timeframe: str) -> float:
    """How long until the current candle closes (plus a small buffer).

    Candle boundaries are aligned to the epoch in UTC, so this is just
    modular arithmetic — e.g. 4h candles close at 00:00, 04:00, 08:00...
    The 30s buffer lets the exchange finalize the candle before we fetch.
    """
    tf_s = TIMEFRAME_MS[timeframe] / 1000
    return tf_s - (time.time() % tf_s) + 30


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the bot on the testnet.")
    parser.add_argument("--config", default="config.yaml")
    parser.add_argument("--once", action="store_true", help="one tick, then exit")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")

    engine, settings = build_engine(args.config)

    mode = "TESTNET (fake money)" if engine.exchange.is_testnet else "!!! LIVE !!!"
    print("=" * 60)
    print(f"  Trading engine starting — {mode}")
    print(f"  symbols: {engine.symbols}   timeframe: {settings.trading_timeframe}")
    print(f"  strategy: entry={engine.strategy.entry_mode}, "
          f"exit={engine.strategy.exit_mode}")
    print("=" * 60)

    engine.run_once()   # act immediately on the most recent closed candle

    if args.once:
        return

    while True:
        wait = seconds_until_next_candle(settings.trading_timeframe)
        log.info("Sleeping %.0f minutes until the next %s candle closes.",
                 wait / 60, settings.trading_timeframe)
        time.sleep(wait)
        engine.run_once()


if __name__ == "__main__":
    main()
