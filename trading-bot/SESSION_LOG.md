# Session log / changelog

Newest entry first. The point of this file: any future session (yours or
Claude's) can read the latest entry and know exactly where the project
stands without re-reading everything.

---

## 2026-07-22 — Session 8c: drill #3 → Binance Algo Order migration (-4120)

Drill #3: entry filled cleanly (qty 0.1064 — Decimal fix works), stop
rejected with -4120 "use the Algo Order API endpoints". Cause: Binance
migrated USDT-M conditional orders (STOP_MARKET etc.) off /fapi/v1/order
to an Algo service effective 2025-12-09 (after this client was written).
Rule-#4 escape hatch closed the position correctly again.

**Fixed (researched via web: Binance change log, freqtrade #12610/#12681,
tiagosiebler/binance client source):**
- place_stop_loss → POST /fapi/v1/algoOrder with algoType=CONDITIONAL,
  type=STOP_MARKET, triggerPrice (renamed from stopPrice), closePosition.
- cancel_all_orders → clears BOTH books (/fapi/v1/allOpenOrders +
  /fapi/v1/algoOpenOrders).
- get_open_orders merges /fapi/v1/openOrders + /fapi/v1/openAlgoOrders.
- flatten_everything sweeps symbols with positions OR any open/algo order
  (orphaned stops on flat symbols get cancelled by the kill switch).
- 3 new wire-format regression tests via a RecordingExchange (124 total).

User to re-run the drill (attempt #4).

---

## 2026-07-22 — Session 8b: first-drill bug found & fixed (-1111 precision)

Fire drill run #1 on the real testnet: entry FILLED (~7,020 USDT of BTC,
1%-risk sizing correct), stop placement REJECTED, engine correctly closed
the position within 1 second (rule #4 escape hatch — observed working in
production). Drill #2 surfaced the root cause once error logging was
added: Binance -1111 "Precision is over the maximum defined for this
asset" — float grid-rounding (106*0.001 = 0.10600000000000001) leaked
into order params.

**Fixed:** exchange rounding now uses exact Decimal math on the
exchange's own filter strings; orders send fixed-point wire strings via
format_quantity/format_price (never raw floats, never scientific
notation). Engine abort paths now log the exchange's verbatim error.
Regression test added (121 total, all passing). User to re-run the drill.

---

## 2026-07-22 — Session 8: fire drill + Option 1 (more markets)

User wanted a guaranteed trade within the hour to watch the machinery,
then to move to Option 1. A hair-trigger strategy can't guarantee timing,
so built the honest version:

**Fire drill:** `python run_paper.py --config config_demo_playground.yaml
--drill BTCUSDT` — forces ONE long through the REAL code path (risk gate
can veto, 1% sizing, mandatory stop attached or the entry is undone),
loudly logged as `drill`/not-a-signal, then the normal loop manages it
(trail ratchets, stop-out, cooldown all observable). HARD testnet-only
guard: raises if exchange.is_testnet is false. 6 new tests (120 total).

**Option 1:** added SOLUSDT, BNBUSDT, XRPUSDT to config_variant_ab.yaml
with a written discipline note: the backtest over new symbols is a
data-quality sanity check, NOT an audition — no cherry-picking profitable
symbols (selection bias). User to run:
  python fetch_data.py --config config_variant_ab.yaml   (fetch history)
  python run_backtest.py --config config_variant_ab.yaml (sanity check)

---

## 2026-07-22 — Session 7: demo playground (Option 3)

User wanted more trades/day; talked through why frequency multiplies costs
not edge, offered three options (more symbols / pre-registered 1h backtest
/ testnet-only plumbing demo). User chose the demo, deferring the others.

**Built:**
- `config_demo_playground.yaml` — 1h candles, fast params (EMA 20/60,
  10-candle breakout, 2×ATR trail), 2h cooldown, loudly labeled NOT A
  STRATEGY (expected to lose fake money to fees — that's part of the
  demo). live_trading pinned false. Separate DB path.
- `engine:` config section support in run_paper (state_file,
  decision_log_dir, candle_history) so demo and variant runs keep fully
  separate state and logs — verified by test.
- 4 new tests (114 total).

**Next:** user runs the demo loop, watches entries/stops/ratchets/
cooldowns in logs_demo/. Later: decide Option 1 (more symbols) and/or
Option 2 (pre-registered 1h backtest of A+B).

---

## 2026-07-22 — Session 6b: first testnet contact VERIFIED

User created demo/testnet keys (demo.binance.com, "System generated" HMAC
type), installed python-dotenv, and ran
`python run_paper.py --config config_variant_ab.yaml --once`.
Result: authenticated to testnet, fetched live candles (BTC 65,813 / ETH
1,913), computed signals, logged `no_signal` for both symbols to console
and logs/decisions-*.jsonl. No API-shape surprises. Phases 1-5 are now all
verified against the real (test) world. Bot to run as an ongoing systems
test; Phase 6 remains locked (no strategy has demonstrated an edge).

---

## 2026-07-22 — Session 6: Phase 5 (testnet paper-trading engine)

**Variant A+B verdict on real data (user's machine, partial output seen —
ETH 1d section):** still no reliable edge. Full period −4.49%, PF 0.64,
win rate 23.8% (trailing exits shifted the win/loss shape as designed:
avg win 2× avg loss, but the win rate can't carry it). OOS +3.23% /
PF 1.78 on only 8 trades — a green shoot, statistically meaningless.
Verdict accepted per the pre-registration discipline. Phase 5 proceeds AS
A SYSTEMS TEST with the variant config; no strategy has earned real money.

**Built:**
- `bot/exchange.py` — signed REST client for USDT-M futures (HMAC-SHA256,
  ~200 lines, no exchange SDK dependency). RULE #1 GATE: live requires
  risk.live_trading:true AND env CONFIRM_LIVE_TRADING to equal an exact
  long phrase; either alone → testnet; a WRONG phrase → refuses to start.
  Balance/positions/orders, STOP_MARKET closePosition server-side stops,
  exchangeInfo-based qty/price rounding (always down), min-notional check,
  flatten_everything() for the kill switch.
- `bot/engine.py` — per-candle tick: halt checks (KILL file) → fetch
  candles from the SAME venue orders go to → same generate_signals code as
  backtests → reconcile vs exchange truth (stop-hit-while-away → estimated
  pnl + cooldown; unmanaged/manual positions left alone, loudly) → manage
  (trailing ratchet via cancel+replace of the server-side stop; failure to
  replace → emergency close; trend-flip exit) → enter (risk gate, sizing
  via bot.risk, stop attached immediately or the entry is undone — rule
  #4) → JSONL decision log incl. every "did nothing because...".
  State (positions + RiskManager via new to_dict/restore) persists in
  data/engine_state.json across restarts.
- `run_paper.py` — loop aligned to candle closes (+30s buffer) or --once;
  loud TESTNET/LIVE banner. `kill_switch.py` — writes KILL file FIRST,
  then cancels all orders and closes all positions; no arguments.
- requirements: + python-dotenv. 21 new tests (110 total): testnet-gate
  matrix, HMAC reference vector, round-down rules, engine behaviors
  (enter+stop, abort-on-stop-failure, kill file, cooldown after remote
  stop-hit, trail ratchet, unmanaged position untouched, state restart,
  risk state round-trip).

**Not run here:** sandbox has no Binance network access — the engine has
never talked to the real testnet. First real testnet session must be
watched: known first-run risks are exchangeInfo filter parsing and order
param details (documented assumptions: one-way position mode, USDT
balance, MIN_NOTIONAL filter shape).

**Next:** user creates testnet keys, runs `python run_paper.py --once`
with the variant config, we review the decision log together. Phase 6
(live) remains locked: no strategy has demonstrated an edge.

---

## 2026-07-22 — Session 5: strategy variant A+B (breakout + trailing)

**User chose** variant "A+B together" from the three pre-registered options.

**Built (config-selectable; v1 code path byte-identical, verified):**
- `StrategyParams` gains `entry_mode` (rsi_cross|breakout), `exit_mode`
  (fixed_target|trailing), `breakout_lookback` (20), `trail_atr_mult` (3.0).
  Min reward-to-risk check applies only in fixed_target mode (trailing has
  uncapped reward — no ratio exists at signal time). Initial 2×ATR stop
  (rule #4) unchanged in every mode.
- Breakout entries: close beyond the prior `breakout_lookback` candles'
  extreme close (shift(1) — today can't be in its own channel), trend
  filter still outranks the trigger.
- Trailing exits in the backtester (`run_backtest(trail_atr_mult=...)`):
  chandelier stop ratchets from each candle's CLOSE (tightened stop only
  hittable from the next candle — no same-candle hindsight), never
  loosens; NaN target never "hits". explain_row/show_signals updated.
- `config_variant_ab.yaml` — one-command, one-shot variant test;
  config.yaml stays v1.
- 12 new tests (89 total, all passing): mode validation, breakout
  fires/holds, trailing ratchet up/short-mirror/never-loosens, winning
  stop-outs, atr-column requirement, v1-unchanged guard.

**Next:** user runs `python run_backtest.py --config config_variant_ab.yaml`
ONCE on real data; verdict accepted either way. Then Phase 5 (paper
trading engine on testnet) with whichever strategy the verdict favors.

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
