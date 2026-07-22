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
| 1 | Data pipeline (download & store historical candles) | ✅ built & verified on real data |
| 2 | Strategy / signal logic (EMA, RSI, ATR rules) | ✅ built |
| 3 | Backtesting engine (fees, funding, slippage, out-of-sample) | ✅ built |
| 4 | Risk-management module (the 7 safety rules) | ✅ built |
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

These live in `bot/risk.py` (its docstring maps every rule to its
enforcement point) with settings under `risk:` in `config.yaml`. The 2%
risk and 3× leverage ceilings are compiled into the code — config can pick
values *below* them, never above. Rules #1 (testnet default), #6 (key
scope) and the flatten-positions half of #7 complete in Phase 5, where the
exchange connection is built.

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

## Phase 2: the strategy

The rules live in `bot/strategy.py` (full plain-English write-up at the top
of that file). In one breath: **trade only in the direction of the trend
(EMA 50 vs EMA 200), enter when momentum turns back that way (RSI 14
crossing 50), and attach a stop-loss at 2×ATR and a take-profit at 3×ATR to
every signal — giving every trade a 1.5:1 reward-to-risk ratio.** Shorts
are the mirror image. If the trend flips, any open position exits.

The indicator math is hand-implemented in `bot/indicators.py` — about 100
readable lines — and unit-tested against values computed by hand on paper.
All tunables sit in the `strategy:` section of `config.yaml`.

To see what the strategy would have signaled on your downloaded data:

```bash
python show_signals.py            # recent signals, with plain-English reasons
python show_signals.py --all      # the full history
```

Expect sparse output — a swing strategy on 4h/1d candles signals a few
times a month per market, and long quiet stretches are by design. Whether
these signals *made money* after fees, funding and slippage is Phase 3's
question, not Phase 2's; resist judging the strategy from this list alone.

## Phase 3: running a backtest

```bash
python run_backtest.py
```

Add `--trades` to also list every simulated trade. Settings live in the
`backtest:` section of `config.yaml`.

The simulator is deliberately pessimistic (full details at the top of
`bot/backtest.py`): orders fill at the *next* candle's open, never at the
signal price; every fill pays taker fees and slippage; positions pay/receive
the real historical funding rates; if one candle touches both the stop and
the target we assume the stop hit first; and position sizing risks a fixed
1% of equity per trade under a hard 2× leverage cap — the same safety rules
the live bot will use.

Each market is reported three ways: the **full period**, the **in-sample**
development period, and the **out-of-sample** period after
`backtest.oos_start` — data treated as a sealed exam. **The out-of-sample
numbers are the ones to trust.** If in-sample profits vanish out-of-sample,
the report prints an overfitting warning, and the honest response is to not
trade the strategy — not to tweak parameters until the warning goes away
(that just turns the exam into more homework).

### Strategy variant A+B (pre-registered)

The honest v1 backtest verdict on real data: **v1 loses** (profit factor
0.87 BTC-4h / 0.63 ETH-1d — win rate below what its 1.5:1 reward-to-risk
needs). One variant was then pre-registered on principle, not fitted:
**breakout entries** (enter on a close beyond the last 20 candles' extreme —
momentum confirmed, no knife-catching) plus **trailing exits** (no fixed
take-profit; a stop trails 3×ATR behind the best close since entry and only
ever tightens — rare big winners stay winners). The initial 2×ATR stop at
entry is unchanged in every mode.

```bash
python run_backtest.py --config config_variant_ab.yaml
```

`config.yaml` stays v1 for comparison. Discipline rule: the variant gets
tested against history ONCE and the verdict stands — repeated
tweak-and-retest against the same data quietly turns the out-of-sample
exam into memorized homework.

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
├── fetch_data.py          # Phase 1 CLI: download/update market data
├── show_signals.py        # Phase 2 CLI: print historical signals + reasons
├── run_backtest.py        # Phase 3 CLI: simulate + report performance
├── bot/
│   ├── config.py          # loads & validates config.yaml
│   ├── indicators.py      # EMA / RSI / ATR math, hand-implemented & tested
│   ├── strategy.py        # the entry/exit rules (read its top docstring!)
│   ├── backtest.py        # the simulator (read its honesty rules!)
│   ├── risk.py            # the 7 safety rules as code (sizing, breaker, kill switch)
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
