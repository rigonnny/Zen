"""Talks to Binance's PUBLIC market-data API for USDT-M futures.

Key facts to understand this file:

*   Historical candles and funding rates are public data — no account, no
    API key, no permissions needed. Authentication only enters the picture
    in Phase 5 when we actually place (testnet) orders.

*   A "kline" is Binance's word for a candle: one row summarizing a time
    window of trading as Open, High, Low, Close prices plus Volume (OHLCV).

*   Binance returns at most 1500 candles per request, so downloading 3 years
    of 4h candles (≈6,500 candles) takes several requests. The `iter_klines`
    method handles that pagination loop for us.

*   APIs fail sometimes (network hiccup, brief rate limit). We retry a few
    times with increasing pauses, and we deliberately go SLOWER than
    Binance's rate limits allow. A data download that takes 30 seconds
    instead of 10 is fine; getting our IP temporarily banned is not.
"""

from __future__ import annotations

import logging
import time
from typing import Iterator

import requests

log = logging.getLogger(__name__)

# Base URL for Binance USDT-M futures market data ("fapi" = futures API).
FUTURES_BASE_URL = "https://fapi.binance.com"

# Binance's hard maximum candles per klines request.
MAX_KLINES_PER_REQUEST = 1500
# Binance's hard maximum rows per funding-rate request.
MAX_FUNDING_PER_REQUEST = 1000

# How each timeframe string translates to milliseconds. Needed to step the
# pagination window forward and to detect still-open candles.
TIMEFRAME_MS = {
    "1h": 3_600_000,
    "2h": 7_200_000,
    "4h": 14_400_000,
    "6h": 21_600_000,
    "8h": 28_800_000,
    "12h": 43_200_000,
    "1d": 86_400_000,
    "3d": 259_200_000,
    "1w": 604_800_000,
}


class BinanceDataError(Exception):
    """Raised when Binance keeps failing after all our retries.

    Having our own exception type means callers can say `except
    BinanceDataError` and know exactly what went wrong, instead of catching
    every possible error under the sun.
    """


class BinancePublicClient:
    """Small, well-behaved HTTP client for Binance's public futures data."""

    def __init__(
        self,
        base_url: str = FUTURES_BASE_URL,
        request_pause_s: float = 0.35,
        max_retries: int = 5,
        timeout_s: float = 20.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        # Pause between successive requests. 0.35s ≈ 3 requests/second,
        # far below Binance's limits — polite on purpose.
        self.request_pause_s = request_pause_s
        self.max_retries = max_retries
        self.timeout_s = timeout_s
        # A Session reuses the underlying network connection between
        # requests, which is faster than reconnecting every time.
        self.session = requests.Session()

    # ------------------------------------------------------------------ #
    # Low-level request helper with retries
    # ------------------------------------------------------------------ #
    def _get(self, path: str, params: dict) -> list:
        """GET a URL, retrying with exponential backoff on failure.

        "Exponential backoff" = wait 1s, then 2s, then 4s... between
        retries. If the server is struggling, hammering it faster only
        makes things worse.
        """
        url = f"{self.base_url}{path}"
        last_error: Exception | None = None

        for attempt in range(self.max_retries):
            try:
                resp = self.session.get(url, params=params, timeout=self.timeout_s)

                # 429 = "you are sending requests too fast", 418 = Binance's
                # "you ignored 429 and are now temporarily banned". Both mean:
                # back off hard before trying again.
                if resp.status_code in (429, 418):
                    wait = max(float(resp.headers.get("Retry-After", 0)), 2 ** attempt * 5)
                    log.warning("Rate limited by Binance (HTTP %s). Waiting %.0fs.",
                                resp.status_code, wait)
                    time.sleep(wait)
                    continue

                resp.raise_for_status()  # raises on any other 4xx/5xx status
                return resp.json()

            except requests.RequestException as exc:
                last_error = exc
                wait = 2 ** attempt  # 1s, 2s, 4s, 8s, 16s
                log.warning("Request failed (%s). Retry %d/%d in %ds.",
                            exc, attempt + 1, self.max_retries, wait)
                time.sleep(wait)

        raise BinanceDataError(
            f"Giving up on {url} after {self.max_retries} attempts. "
            f"Last error: {last_error}"
        )

    # ------------------------------------------------------------------ #
    # Klines (candles)
    # ------------------------------------------------------------------ #
    def iter_klines(
        self,
        symbol: str,
        timeframe: str,
        start_ms: int,
        end_ms: int | None = None,
    ) -> Iterator[list[dict]]:
        """Yield batches of CLOSED candles from start_ms up to end_ms/now.

        Why "closed" matters: the newest candle on a chart is still being
        drawn — its close price changes every second until the period ends.
        Acting on an unfinished candle is a classic beginner bug called
        lookahead bias (the backtest sees information the live bot wouldn't
        have had). So we only ever store candles whose period has fully ended.

        Yields one list of candle-dicts per API request, so the caller can
        save each batch to the database as it arrives (progress isn't lost
        if the download dies halfway).
        """
        if timeframe not in TIMEFRAME_MS:
            raise ValueError(f"Unknown timeframe {timeframe!r}")
        tf_ms = TIMEFRAME_MS[timeframe]

        # If no end given, use "now". int(time.time()*1000) = current Unix
        # time in milliseconds, the unit Binance speaks.
        if end_ms is None:
            end_ms = int(time.time() * 1000)

        cursor = start_ms  # the open-time we want the next batch to start at
        while cursor < end_ms:
            raw = self._get(
                "/fapi/v1/klines",
                {
                    "symbol": symbol,
                    "interval": timeframe,
                    "startTime": cursor,
                    "endTime": end_ms,
                    "limit": MAX_KLINES_PER_REQUEST,
                },
            )
            if not raw:
                break  # no more data available (e.g. before the market existed)

            batch = [self._parse_kline(symbol, timeframe, row) for row in raw]

            # Drop the final candle if its period hasn't finished yet.
            now_ms = int(time.time() * 1000)
            batch = [c for c in batch if c["close_time"] <= now_ms]
            if batch:
                yield batch

            # Advance the cursor to just after the last candle we received.
            # (+tf_ms so we don't request the same candle twice.)
            last_open = raw[-1][0]
            next_cursor = last_open + tf_ms
            if next_cursor <= cursor:
                break  # safety: never loop forever if the API misbehaves
            cursor = next_cursor

            if len(raw) < MAX_KLINES_PER_REQUEST:
                break  # short page = we've reached the newest data

            time.sleep(self.request_pause_s)  # be polite between pages

    @staticmethod
    def _parse_kline(symbol: str, timeframe: str, row: list) -> dict:
        """Turn Binance's raw kline array into a labeled dictionary.

        Binance returns each candle as a bare list like:
            [open_time, open, high, low, close, volume, close_time,
             quote_volume, trade_count, ...]
        Bare positional lists are error-prone (was index 4 close or volume?),
        so we convert to named fields exactly once, right here, and the rest
        of the codebase never touches raw API rows.

        Note: prices arrive as STRINGS ("67123.50") because Binance avoids
        floating-point rounding on their side. We convert to float — fine
        for indicators and backtesting.
        """
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "open_time": int(row[0]),      # when this candle's period began (ms, UTC)
            "open": float(row[1]),         # first traded price of the period
            "high": float(row[2]),         # highest traded price
            "low": float(row[3]),          # lowest traded price
            "close": float(row[4]),        # last traded price
            "volume": float(row[5]),       # how much was traded (in BTC for BTCUSDT)
            "close_time": int(row[6]),     # when the period ended (ms, UTC)
            "quote_volume": float(row[7]), # volume in USDT terms
            "trade_count": int(row[8]),    # number of individual trades
        }

    # ------------------------------------------------------------------ #
    # Funding rates
    # ------------------------------------------------------------------ #
    def iter_funding_rates(
        self,
        symbol: str,
        start_ms: int,
        end_ms: int | None = None,
    ) -> Iterator[list[dict]]:
        """Yield batches of historical funding-rate payments for a symbol.

        Funding, in one paragraph: a perpetual future has no expiry date, so
        exchanges need another mechanism to keep its price tracking the real
        ("spot") price. Every 8 hours, if the perp trades above spot, people
        holding LONG positions pay a small fee to the shorts (and vice
        versa). Typical size is ~0.01% per 8h — tiny per payment, but a
        5-day swing trade sits through ~15 payments, so Phase 3's backtest
        must charge them to be honest.
        """
        if end_ms is None:
            end_ms = int(time.time() * 1000)

        cursor = start_ms
        while cursor < end_ms:
            raw = self._get(
                "/fapi/v1/fundingRate",
                {
                    "symbol": symbol,
                    "startTime": cursor,
                    "endTime": end_ms,
                    "limit": MAX_FUNDING_PER_REQUEST,
                },
            )
            if not raw:
                break

            batch = [
                {
                    "symbol": symbol,
                    "funding_time": int(r["fundingTime"]),
                    "funding_rate": float(r["fundingRate"]),
                }
                for r in raw
            ]
            yield batch

            next_cursor = batch[-1]["funding_time"] + 1
            if next_cursor <= cursor:
                break
            cursor = next_cursor

            if len(raw) < MAX_FUNDING_PER_REQUEST:
                break

            time.sleep(self.request_pause_s)
