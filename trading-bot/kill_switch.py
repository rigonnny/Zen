#!/usr/bin/env python3
"""Safety rule #7: the kill switch. ONE command → flat and halted.

    python kill_switch.py

Does three things, in order:
    1. writes a KILL file — the engine sees it and refuses to trade,
    2. cancels every open order on the exchange,
    3. closes every open position at market (reduce-only).

It asks zero questions and takes no arguments, because a panic button must
not have a menu. To let the bot trade again later: delete the KILL file
(that deliberate manual step is the un-arm).
"""

from __future__ import annotations

import logging
import os

from dotenv import load_dotenv

from bot.engine import KILL_FILE
from bot.exchange import FuturesExchange
from bot.risk import RiskConfig


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    load_dotenv()

    # Step 1 FIRST — even if the exchange calls below fail, the engine is
    # already fenced off.
    KILL_FILE.write_text("kill switch pressed\n")
    print(f"KILL file written ({KILL_FILE.resolve()}) — engine will not trade.")

    risk_cfg = RiskConfig.from_yaml("config.yaml")
    if risk_cfg.live_trading:
        key = os.environ.get("BINANCE_LIVE_API_KEY", "")
        secret = os.environ.get("BINANCE_LIVE_API_SECRET", "")
    else:
        key = os.environ.get("BINANCE_TESTNET_API_KEY", "")
        secret = os.environ.get("BINANCE_TESTNET_API_SECRET", "")

    exchange = FuturesExchange(key, secret, live_trading_config=risk_cfg.live_trading)
    for action in exchange.flatten_everything():
        print(f"  - {action}")
    print("Done. Delete the KILL file when you deliberately want to re-arm.")


if __name__ == "__main__":
    main()
