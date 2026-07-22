# Session log / changelog

Newest entry first. The point of this file: any future session (yours or
Claude's) can read the latest entry and know exactly where the project
stands without re-reading everything.

---

## 2026-07-22 — Session 4: Phase 4 (risk-management module)

**Backtest verdict on real data (user's machine):** the v1 strategy LOSES
across both markets — BTC 4h profit factor 0.87 (52 trades), ETH 1d 0.63
(29 trades); win rates 31–38% vs ~42% breakeven need; negative in nearly
every year; max drawdown ~10-12%; longest losing streak 8. NOT an
overfitting signature (in-sample equally weak — the strategy was never
fitted); it simply has no edge as configured. Risk machinery performed as
designed (losses small and uniform). User chose to proceed on both tracks:
build Phase 4 now, revisit strategy with pre-registered variants after.

**Built:**
- `bot/risk.py` — the seven safety rules as standalone code:
  RiskConfig (validated; HARD ceilings compiled in: risk ≤2%, leverage ≤3×,
  loud warning >2×; live_trading defaults False), validate_protective_stop
  (rule #4: no stop / wrong-side stop → refuse), position_size (rule #3
  fixed-fractional + rule #2 leverage cap; explicit `side` argument so a
  wrong-side stop can't be silently reinterpreted), RiskManager (rule #5
  daily circuit breaker keyed to UTC day-start equity; rule #7 kill-switch
  state, one-way per process; max concurrent positions; per-symbol
  post-stop cooldown). All time injected via `now` params for testability.
- Backtester refactored to size positions through bot.risk.position_size —
  one sizing implementation shared by simulation and (Phase 5) live code.
- `risk:` section in config.yaml.
- 18 new tests (77 total, all passing) — each rule tested for both "blocks
  what it should" and "allows what it should".

**Deferred to Phase 5 (need the exchange client):** testnet/live connection
gating (rule #1's enforcement point), API key loading/scope docs (rule #6),
kill switch's flatten-all-positions half (rule #7).

**Track 2 pending:** user to pick from 3 pre-registered strategy variants
(proposed in chat): A) trailing exit instead of fixed take-profit,
B) breakout entries instead of RSI cross, C) long-only + trend-strength
filter. Test once, accept the verdict.

---

## 2026-07-22 — Session 3: Phase 3 (backtesting engine)

**User confirmations:** Phase 2 reviewed — user ran show_signals.py on real
data and verified the ETH-daily short cluster against a TradingView chart
(2026 downtrend: trend filter correct, March–May counter-rally would have
stopped out several shorts, late-April/May shorts caught the June leg down).

**Built:**
- `bot/backtest.py` — event-driven simulator. Honesty rules: next-open
  fills only; taker fee (0.05%) on every fill; adverse slippage (0.03%) on
  market-style fills; real historical funding applied by side; stop wins
  any stop/target tie (worst case); positions sized to risk 1% of equity
  with a hard 2× leverage cap (BacktestParams REFUSES risk >2% or leverage
  >3× — safety rules #2/#3 now live in code); one position per market;
  open positions force-closed at end of data. Metrics: return, CAGR,
  Sharpe, Sortino, max drawdown, win rate, profit factor, avg win/loss,
  longest losing streak, fees, funding.
- `run_backtest.py` — CLI report: full period + in-sample vs out-of-sample
  (config `backtest.oos_start`, default 2025-07-01) + per-year breakdown +
  explicit overfitting warning when IS profits vanish OOS. `--trades`
  lists every simulated trade.
- `backtest:` section in config.yaml.
- 14 new tests (59 total, all passing): hand-computed P&L for target/stop/
  tie-break/short mechanics, fee & slippage & funding arithmetic, leverage
  cap, signal-ignored-while-open, end-of-data close, metrics math,
  safety-rail refusals.

**Environment note:** sandbox still has no Binance access; CLI smoke-tested
end-to-end on seeded synthetic data (trades, IS/OOS split, per-year table
all exercised). Real-data numbers must come from the user's machine.

**Known simplifications (documented in backtest.py docstring):** stop/target
not re-anchored to fill price; funding booked at trade close; no minimum
order size.

**Next up (Phase 4, after user reviews their real backtest numbers):** risk
management module — extract sizing/leverage into standalone risk.py, add
daily loss circuit breaker, max concurrent positions, post-stop cooldown,
testnet-by-default flag, kill switch; all unit-tested.

---

## 2026-07-22 — Session 2: Phase 2 (indicators + strategy rules)

**User confirmations:** Phase 1 verified working on the user's Mac
(Python 3.9 — code kept 3.9-compatible): 8,894×4h + 1,482×1d candles per
symbol, no gaps. Defaults confirmed: symbols BTCUSDT+ETHUSDT, history from
2022-07-01.

**Built:**
- `bot/indicators.py` — EMA, SMA, RSI (Wilder), ATR (Wilder) implemented
  by hand (~100 lines) instead of pulling in pandas-ta: readable math, no
  library ambiguity, and unit tests pin each one to hand-computed values.
- `bot/strategy.py` — trend-following pullback rules: long = EMA50>EMA200
  AND RSI14 crosses up through 50; short = mirror. Every signal carries a
  mandatory stop (2×ATR) and target (3×ATR) → 1.5:1 reward-to-risk,
  enforced as a validated minimum in StrategyParams. Trend flip = exit
  signal. Pure function: candles in → signals out; no sizing/account logic
  (that's Phase 4). `explain_row()` renders any signal as plain English.
- `strategy:` section added to config.yaml (unknown keys rejected as typos).
- `show_signals.py` — read-only CLI to print historical signals with
  reasons over the user's stored data.
- 21 new tests (45 total, all passing), including hand-computed RSI/ATR/EMA
  values and an explicit no-lookahead-bias test (truncate the future,
  recompute, assert identical signals).

**Environment note:** sandbox DB is empty (no network to Binance), so
`show_signals.py` was smoke-tested against synthetic data only; entries are
exercised by unit tests. User should run it on their real data.

**Next up (Phase 3, after user review):** backtesting engine — next-open
fills, taker fees, slippage, funding costs; walk-forward / out-of-sample
split; report return, Sharpe/Sortino, max drawdown, win rate, profit
factor, avg win/loss, trade count.

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
