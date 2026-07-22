#!/usr/bin/env python3
"""Phase 3 entry point: backtest the strategy over your downloaded data.

Usage (from the trading-bot/ folder, after `python fetch_data.py`):

    python run_backtest.py
    python run_backtest.py --trades      (also list every simulated trade)

For each symbol × timeframe it reports three views:

  * FULL PERIOD  — the whole dataset, for the big picture,
  * IN-SAMPLE    — the development period (before `backtest.oos_start`),
  * OUT-OF-SAMPLE— the sealed-exam period after that date. Each view is an
    independent simulation starting from fresh equity.
  * plus a per-year breakdown, because a single 4-year average can hide
    two great years and two terrible ones.

How to read it honestly:
  * OUT-OF-SAMPLE is the number that matters. In-sample results always
    look better than reality — we (and every trader who ever tweaked a
    parameter) were looking at that data while building.
  * If in-sample is good and out-of-sample is bad, that's overfitting.
    The correct response is disappointment, not "let me tweak it until
    out-of-sample looks good too" — doing that quietly turns the exam
    into more homework, and the deception restarts.
  * Drawdown and losing streaks are not footnotes. Ask yourself: would I
    keep running a bot that's been underwater for this long?
"""

from __future__ import annotations

import argparse
from dataclasses import fields as dc_fields

import pandas as pd
import yaml

from bot.backtest import (
    PERIODS_PER_YEAR,
    BacktestParams,
    compute_metrics,
    run_backtest,
)
from bot.config import load_config
from bot.data.storage import MarketDataStore
from bot.strategy import StrategyParams, generate_signals


def load_backtest_settings(path: str) -> tuple:
    """Read the `backtest:` section → (BacktestParams, oos_start)."""
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    section = dict(raw.get("backtest") or {})
    oos_start = section.pop("oos_start", None)
    valid = {f.name for f in dc_fields(BacktestParams)}
    unknown = set(section) - valid
    if unknown:
        raise ValueError(f"Unknown backtest option(s): {sorted(unknown)}")
    return BacktestParams(**section), oos_start


FMT = {
    "final_equity": ("final equity", "{:,.2f} USDT"),
    "total_return_pct": ("total return", "{:+.2f}%"),
    "cagr_pct": ("CAGR (yearly avg growth)", "{:+.2f}%"),
    "sharpe": ("Sharpe ratio", "{:.2f}"),
    "sortino": ("Sortino ratio", "{:.2f}"),
    "max_drawdown_pct": ("max drawdown", "{:.2f}%"),
    "win_rate_pct": ("win rate", "{:.1f}%"),
    "profit_factor": ("profit factor", "{:.2f}"),
    "avg_win": ("average win", "{:+,.2f} USDT"),
    "avg_loss": ("average loss", "{:+,.2f} USDT"),
    "trade_count": ("trades", "{:d}"),
    "longest_loss_streak": ("longest losing streak", "{:d} trades"),
    "total_fees": ("fees paid", "{:,.2f} USDT"),
    "total_funding": ("net funding paid", "{:+,.2f} USDT"),
}


def print_metrics(title: str, m: dict) -> None:
    print(f"\n  --- {title} ---")
    if m.get("trade_count", 0) == 0:
        print("    no trades in this period")
        return
    for key, (label, fmt) in FMT.items():
        if key in m:
            print(f"    {label:<28}{fmt.format(m[key])}")


def backtest_slice(signals: pd.DataFrame, funding, params, timeframe: str) -> dict:
    result = run_backtest(signals, funding=funding, params=params)
    return compute_metrics(result, PERIODS_PER_YEAR[timeframe]), result


def main() -> None:
    parser = argparse.ArgumentParser(description="Backtest the strategy on stored data.")
    parser.add_argument("--config", default="config.yaml")
    parser.add_argument("--trades", action="store_true", help="print every trade")
    args = parser.parse_args()

    cfg = load_config(args.config)
    strat = StrategyParams.from_yaml(args.config)
    bt_params, oos_start = load_backtest_settings(args.config)

    print(f"Backtest settings: start equity {bt_params.initial_equity:,.0f} USDT, "
          f"fee {bt_params.fee_pct}%, slippage {bt_params.slippage_pct}%, "
          f"risk/trade {bt_params.risk_per_trade_pct}%, "
          f"max leverage {bt_params.max_leverage}x")
    if oos_start:
        print(f"Out-of-sample period starts: {oos_start}")

    with MarketDataStore(cfg.db_path) as store:
        for symbol in cfg.symbols:
            funding = store.load_funding_rates(symbol)
            for timeframe in cfg.timeframes:
                candles = store.load_candles(symbol, timeframe)
                if candles.empty:
                    print(f"\n== {symbol} {timeframe}: no data — run fetch_data.py first.")
                    continue

                # Signals over the FULL history once — indicators then have
                # proper warm-up even for the out-of-sample slice.
                signals = generate_signals(candles, strat)

                print(f"\n{'=' * 68}\n== {symbol} {timeframe}  "
                      f"({signals.index[0]:%Y-%m-%d} → {signals.index[-1]:%Y-%m-%d})")

                m, full_result = backtest_slice(signals, funding, bt_params, timeframe)
                print_metrics("FULL PERIOD", m)

                if oos_start:
                    is_part = signals.loc[: pd.Timestamp(oos_start, tz="UTC")]
                    oos_part = signals.loc[pd.Timestamp(oos_start, tz="UTC"):]
                    if len(is_part) and len(oos_part):
                        m_is, _ = backtest_slice(is_part, funding, bt_params, timeframe)
                        m_oos, _ = backtest_slice(oos_part, funding, bt_params, timeframe)
                        print_metrics(f"IN-SAMPLE (dev period, → {oos_start})", m_is)
                        print_metrics(f"OUT-OF-SAMPLE (sealed exam, {oos_start} →)", m_oos)

                        # The tripwire, stated out loud:
                        r_is = m_is.get("total_return_pct")
                        r_oos = m_oos.get("total_return_pct")
                        if r_is is not None and r_oos is not None:
                            if r_is > 0 and r_oos < 0:
                                print("\n  ⚠ OVERFITTING WARNING: profitable in-sample "
                                      "but LOSES out-of-sample. Do not trade this.")

                # Per-year honesty table.
                print("\n  --- per-year breakdown (each year starts fresh) ---")
                for year, chunk in signals.groupby(signals.index.year):
                    my, _ = backtest_slice(chunk, funding, bt_params, timeframe)
                    ret = my.get("total_return_pct")
                    dd = my.get("max_drawdown_pct")
                    n = my.get("trade_count", 0)
                    if ret is None:
                        print(f"    {year}: no trades")
                    else:
                        print(f"    {year}: return {ret:+7.2f}%   "
                              f"max drawdown {dd:7.2f}%   trades {n:3d}")

                if args.trades:
                    print("\n  --- every simulated trade ---")
                    for t in full_result.trades:
                        side = "LONG " if t.side == 1 else "SHORT"
                        print(f"    {t.entry_time:%Y-%m-%d %H:%M} {side} "
                              f"in {t.entry_price:10.2f} → out {t.exit_price:10.2f} "
                              f"({t.exit_reason:<10}) net {t.net_pnl:+10.2f} USDT")

    print(
        "\nReminder: a good backtest is evidence, not a promise. These numbers "
        "include fees, slippage and funding, and the out-of-sample split is a "
        "real safeguard — but markets change, and past performance does not "
        "guarantee future results."
    )


if __name__ == "__main__":
    main()
