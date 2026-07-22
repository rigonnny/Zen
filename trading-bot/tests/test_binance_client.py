"""Tests for the Binance client — WITHOUT touching the real internet.

Trick used here: we subclass BinancePublicClient and replace its `_get`
method with one that returns canned responses. Everything above `_get`
(pagination, parsing, filtering unfinished candles) runs for real and is
what we actually verify. Tests that need the network are fragile and slow;
tests against canned data are instant and deterministic.
"""

import time

from bot.data.binance_client import BinancePublicClient

TF_4H_MS = 14_400_000


def raw_kline(open_time: int, close_price: float = 100.0) -> list:
    """One candle in Binance's raw wire format (list of strings/numbers)."""
    return [
        open_time,            # 0: open time
        "99.0",               # 1: open  (Binance sends prices as strings)
        "101.0",              # 2: high
        "98.0",               # 3: low
        str(close_price),     # 4: close
        "1234.5",             # 5: volume
        open_time + TF_4H_MS - 1,  # 6: close time
        "123450.0",           # 7: quote volume
        678,                  # 8: trade count
        "600.0", "60000.0", "0",   # 9-11: fields we don't use
    ]


class FakeClient(BinancePublicClient):
    """Serves pre-programmed pages instead of calling the API."""

    def __init__(self, pages):
        super().__init__(request_pause_s=0)  # no polite pauses in tests
        self.pages = list(pages)
        self.requests_made = []

    def _get(self, path, params):
        self.requests_made.append((path, dict(params)))
        return self.pages.pop(0) if self.pages else []


def test_parse_kline_labels_fields_correctly():
    parsed = BinancePublicClient._parse_kline("BTCUSDT", "4h", raw_kline(0, 100.5))
    assert parsed["symbol"] == "BTCUSDT"
    assert parsed["timeframe"] == "4h"
    assert parsed["open_time"] == 0
    assert parsed["open"] == 99.0
    assert parsed["high"] == 101.0
    assert parsed["low"] == 98.0
    assert parsed["close"] == 100.5          # string "100.5" became float
    assert parsed["volume"] == 1234.5
    assert parsed["trade_count"] == 678


def test_iter_klines_paginates_until_short_page():
    """Two full-looking pages? Keep going. Short page? That's the end."""
    page1 = [raw_kline(i * TF_4H_MS) for i in range(1500)]      # full page
    page2 = [raw_kline((1500 + i) * TF_4H_MS) for i in range(3)]  # short page
    client = FakeClient([page1, page2])

    batches = list(client.iter_klines("BTCUSDT", "4h", start_ms=0, end_ms=10**18))

    assert len(batches) == 2
    assert len(batches[0]) == 1500
    assert len(batches[1]) == 3
    # Second request must start right AFTER the last candle of page 1 —
    # no overlap, no missed candle.
    assert client.requests_made[1][1]["startTime"] == 1500 * TF_4H_MS


def test_iter_klines_drops_unfinished_candle():
    """A candle whose period hasn't ended yet must never be yielded.

    We build one candle safely in the past and one whose close_time is an
    hour in the future (i.e. still forming), and check only the first
    survives. See iter_klines' docstring for why: lookahead bias.
    """
    now_ms = int(time.time() * 1000)
    finished = raw_kline(now_ms - 2 * TF_4H_MS)
    unfinished = raw_kline(now_ms - TF_4H_MS + 3_600_000)  # closes in ~1h
    client = FakeClient([[finished, unfinished]])

    batches = list(client.iter_klines("BTCUSDT", "4h", start_ms=0))

    assert len(batches) == 1
    assert len(batches[0]) == 1
    assert batches[0][0]["open_time"] == finished[0]


def test_iter_klines_empty_response_ends_cleanly():
    """Symbol with no data in range → no batches, no infinite loop."""
    client = FakeClient([[]])
    assert list(client.iter_klines("BTCUSDT", "4h", start_ms=0, end_ms=10**15)) == []


def test_iter_funding_rates_paginates():
    page1 = [{"fundingTime": i, "fundingRate": "0.0001"} for i in range(1000)]  # full
    page2 = [{"fundingTime": 1000, "fundingRate": "-0.0002"}]                   # short
    client = FakeClient([page1, page2])

    batches = list(client.iter_funding_rates("BTCUSDT", start_ms=0, end_ms=10**15))

    assert len(batches) == 2
    assert batches[1][0]["funding_rate"] == -0.0002
    # Next request starts strictly after the last funding_time we received.
    assert client.requests_made[1][1]["startTime"] == 1000
