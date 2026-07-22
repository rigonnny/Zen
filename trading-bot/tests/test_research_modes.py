"""Tests for research candidates A (rsi_dip/reversion) and B (strength filter)."""

import numpy as np
import pytest

from bot.strategy import LONG, SHORT, StrategyParams, generate_signals
from tests.test_strategy import make_df

# Note the loosened dip thresholds (20/80 instead of the production 10/90):
# with the tiny 3/6-candle test EMAs, a dip violent enough to push RSI-2
# under 10 also flips the mini trend filter. The production 50/200 EMAs
# don't flinch at a two-candle dip, so real configs keep the strict 10/90.
# The LOGIC under test (dip triggers, trend gate, reversion exit) is the same.
DIP = StrategyParams(
    ema_fast=3, ema_slow=6, rsi_period=3, atr_period=3,
    rsi_dip_period=2,
    rsi_dip_buy_below=20.0, rsi_dip_sell_above=80.0,
    entry_mode="rsi_dip", exit_mode="reversion",
)


def test_new_modes_validated():
    with pytest.raises(ValueError, match="entry_mode"):
        StrategyParams(entry_mode="astrology")
    with pytest.raises(ValueError, match="rsi_dip_period"):
        StrategyParams(rsi_dip_period=1)
    with pytest.raises(ValueError, match="overlap"):
        StrategyParams(rsi_dip_buy_below=60.0)     # above the exit level
    with pytest.raises(ValueError, match="trend_strength_atr"):
        StrategyParams(trend_strength_atr=-1.0)


def test_dip_buy_fires_on_panic_in_uptrend():
    """Steady climb, then two hard down candles (RSI-2 collapses toward 0)
    while the slower EMAs still say uptrend → mean-reversion long, with a
    stop (rule #4) and no fixed target."""
    prices = [100 + 3 * i for i in range(12)] + [128, 122]   # sharp 2-candle dip
    result = generate_signals(make_df(prices), DIP)
    last = result.iloc[-1]
    assert last["uptrend"]
    assert last["rsi_fast"] < 20
    assert last["signal"] == LONG
    assert last["stop_price"] < last["close"]
    assert np.isnan(last["target_price"])


def test_dip_buy_silent_in_downtrend():
    """The same panic during a DOWNTREND must be ignored — catching knives
    is only allowed when the tide is rising."""
    prices = [200 - 3 * i for i in range(12)] + [160, 154]
    result = generate_signals(make_df(prices), DIP)
    assert (result[~result["uptrend"]]["signal"] != LONG).all()


def test_dip_short_fires_on_euphoria_in_downtrend():
    prices = [200 - 3 * i for i in range(12)] + [168, 174]   # sharp 2-candle pop
    result = generate_signals(make_df(prices), DIP)
    last = result.iloc[-1]
    assert last["rsi_fast"] > 80
    assert last["signal"] == SHORT


def test_reversion_exit_fires_after_snapback():
    """After the dip, price recovers → fast RSI back above 50 → exit_long."""
    prices = [100 + 3 * i for i in range(12)] + [128, 122] + [130, 136]
    result = generate_signals(make_df(prices), DIP)
    assert result.iloc[-1]["rsi_fast"] > 50
    assert bool(result.iloc[-1]["exit_long"])


def test_strength_filter_suppresses_entries():
    """Same breakout scenario, filter absurdly strict → zero entries.
    Verifies the wiring: the filter can only ever REMOVE trades."""
    prices = [100 + 2 * i for i in range(10)] + [118] * 4 + [125]
    base = dict(ema_fast=3, ema_slow=6, rsi_period=3, atr_period=3,
                entry_mode="breakout", breakout_lookback=4,
                exit_mode="trailing")
    open_filter = generate_signals(make_df(prices), StrategyParams(**base))
    strict = generate_signals(make_df(prices),
                              StrategyParams(**base, trend_strength_atr=100.0))
    assert (open_filter["signal"] != 0).any()      # entries exist unfiltered
    assert (strict["signal"] == 0).all()           # all removed by the filter
    # And the filter never ADDS a trade anywhere:
    unfiltered_entries = set(open_filter.index[open_filter["signal"] != 0])
    mild = generate_signals(make_df(prices),
                            StrategyParams(**base, trend_strength_atr=0.5))
    mild_entries = set(mild.index[mild["signal"] != 0])
    assert mild_entries.issubset(unfiltered_entries)
