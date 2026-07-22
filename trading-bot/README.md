# Binance Futures Swing-Trading Bot

A rule-based swing-trading bot for Binance USDT-M perpetual futures, built as
a learning project in careful phases. **Everything targets the Binance
Futures Testnet (fake money) until a separate, explicit step much later.**

> **Honesty note, up front:** no bot is guaranteed to profit. A good backtest
> is evidence, not a promise — markets change, and strategies that worked can
> stop working. The goal of this project is a bot that does *exactly* what it
> is designed to do, that you understand line by line, and that can never
> risk more than you explicitly told it to.

## Project status

| Phase | What | Status |
|---|---|---|
| 1 | Data pipeline (download & store historical candles) | ✅ built |
| 2 | Strategy / signal logic (EMA, RSI, ATR rules) | ⏳ not started |
| 3 | Backtesting engine (fees, funding, slippage, walk-forward) | ⏳ not started |
| 4 | Risk-management module (the 7 safety rules) | ⏳ not started |
| 5 | Paper trading on Binance Futures **Testnet** | ⏳ not started |
| 6 | Small-capital live trading (only after 1–5 reviewed) | ⏳ not started |

See `SESSION_LOG.md` for a running changelog.

## Non-negotiable safety rules (to be enforced *in code*)

1. **Testnet by default** — live trading requires flipping a separate,
   clearly-labeled flag.
2. **Leverage cap** — the bot refuses to exceed a configured ceiling
   (default 2–3x).
3. **Risk per trade** — position sizing itself limits risk to 1–2% of
   equity per trade.
4. **Mandatory stop-loss** — no position opens without a stop attached.
5. **Daily loss circuit breaker** — too much lost in a day → no new trades.
6. **API key scope** — trading permission only, withdrawals OFF, keys in
   `.env` (never in git).
7. **Kill switch** — one command flattens everything and halts the bot.

These arrive as tested code in Phase 4; they're listed here from day one so
they shape every design decision before then.

## Setup

Requires Python 3.10+.

```bash
cd trading-bot

# (Recommended) create an isolated Python environment for this project:
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

pip install -r requirements.txt
```

No API keys are needed yet — Phase 1 uses only public market data. (When
keys become relevant in Phase 5: `cp .env.example .env` and fill in
**testnet** keys there. `.env` is git-ignored.)

## Phase 1: downloading market data

What to download is controlled by `config.yaml` (symbols, timeframes, how
far back). Then:

```bash
python fetch_data.py             # download everything / update to latest
python fetch_data.py --summary   # show what's stored locally
python fetch_data.py --verify    # check the stored data for gaps
```

* The first run downloads full history (a few minutes, ~13k candles for the
  default config). Every later run is *incremental* — it only fetches
  candles newer than what you already have, so it takes seconds.
* Interrupting with Ctrl+C is safe. Progress is saved batch-by-batch; just
  run the command again.
* Data lands in a single SQLite file at `data/market_data.db` (git-ignored).
* After every download the script automatically checks for gaps (missing
  candles) and warns loudly if it finds any — bad data in means garbage
  backtests out.

### What exactly gets stored

* **Candles (OHLCV)** — for each 4-hour / 1-day period: the Open, High,
  Low and Close price plus traded Volume. This is the raw material for
  every indicator and backtest.
* **Funding rates** — perpetual futures charge a small fee between longs
  and shorts every 8 hours to keep the contract price near the spot price.
  Small per payment, but it adds up over a multi-day swing trade, so honest
  backtesting (Phase 3) needs this history.

## Running the tests

```bash
python -m pytest tests/ -v
```

The tests use canned (fake) API responses, so they run instantly, offline,
and deterministically. They cover config validation, the storage layer's
no-duplicates guarantee, API pagination, the still-forming-candle filter
(lookahead-bias protection), incremental updates, and gap detection.

## Repository layout

```
trading-bot/
├── config.yaml            # what to download / (later) how to trade
├── fetch_data.py          # Phase 1 command-line entry point
├── bot/
│   ├── config.py          # loads & validates config.yaml
│   └── data/
│       ├── binance_client.py  # talks to Binance's public API (retries, paging)
│       ├── storage.py         # SQLite read/write layer
│       └── pipeline.py        # orchestration + gap checking
├── tests/                 # pytest suite (offline, uses fakes)
├── .env.example           # template for secrets — real keys go in .env only
└── SESSION_LOG.md         # running changelog across build sessions
```

## How paper trading / live trading will work

Documented here in advance so the shape is clear; **neither exists yet**:

* **Paper trading (Phase 5):** the full bot loop runs against the Binance
  Futures *Testnet* — real API, fake money — logging every decision it
  makes, not just executed trades.
* **Live trading (Phase 6):** the *same* code path, gated behind an
  explicit, hard-to-trigger-by-accident confirmation. Before this step:
  only money you can fully afford to lose, and confirm Binance Futures and
  API trading are permitted where you live.
