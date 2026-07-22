# Session log / changelog

Newest entry first. The point of this file: any future session (yours or
Claude's) can read the latest entry and know exactly where the project
stands without re-reading everything.

---

## 2026-07-22 — Session 1: project scaffolding + Phase 1 (data pipeline)

**Built:**
- Project structure under `trading-bot/` (kept separate from the Next.js app
  that lives at this repo's root).
- `config.yaml` + `bot/config.py` — validated configuration (symbols,
  timeframes, start date, db path).
- `bot/data/binance_client.py` — public-API client for USDT-M futures:
  klines + funding-rate history, pagination, retries with exponential
  backoff, deliberate rate-limit politeness, and a filter that drops the
  still-forming candle (lookahead-bias protection).
- `bot/data/storage.py` — SQLite layer; primary keys make duplicate candles
  impossible, so re-running the pipeline is always safe (idempotent).
- `bot/data/pipeline.py` — incremental updates (only fetch what's missing)
  + gap detection as an automatic data-quality check.
- `fetch_data.py` — CLI: download/update, `--summary`, `--verify`.
- 24 unit tests (all passing), run offline against canned API responses.
- `requirements.txt`, `.env.example`, `.gitignore`, `README.md`.

**Notable bug caught by tests during development:** gap detection converted
datetimes back to milliseconds assuming nanosecond storage; pandas 2.x kept
millisecond resolution, so timestamps were divided twice. Fixed by reading
raw integer timestamps straight from SQLite (`candle_open_times`).

**Environment note:** the cloud sandbox this was built in cannot reach
binance.com (network policy), so `python fetch_data.py` was NOT run against
the live API here. All logic is covered by the offline test suite; the
first real download should happen on the user's machine.

**Decisions made:**
- Default data: BTCUSDT + ETHUSDT, 4h + 1d candles, from 2022-07-01.
- Funding-rate history is downloaded too (needed for honest backtests).
- Plain `requests` against Binance's public REST API for Phase 1 (simplest
  to read/learn); `python-binance` planned for authenticated testnet
  trading in Phase 5.

**Next up (Phase 2, after user review):** indicator module (EMA, RSI, ATR)
+ explicit entry/exit rules, with unit tests against hand-computed values.

**Open questions for the user:**
- Happy with BTCUSDT + ETHUSDT as the starting symbols?
- Happy with 2022-07-01 as the history start (~3 years, covers a bear
  market, a recovery, and chop)?
