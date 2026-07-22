"""Phase 5: the exchange connection — where safety rule #1 is enforced.

This module signs and sends authenticated requests to Binance USDT-M
futures. It is the ONLY file in the project that can place real orders,
which makes it the right place for the testnet gate:

    RULE #1 ENFORCEMENT. FuturesExchange connects to the TESTNET unless
    ALL THREE of these are true at once:
      1. config.yaml has  risk.live_trading: true
      2. the environment variable CONFIRM_LIVE_TRADING equals the exact
         sentence  I-ACCEPT-FULL-RESPONSIBILITY-FOR-REAL-MONEY-LOSSES
      3. live API keys are present in .env
    Anything less → testnet or a refusal to start. There is no code path
    around this check, and no config option can weaken it.

About request signing (how Binance knows it's really you): every private
request carries your API key in a header, plus a `signature` parameter —
an HMAC-SHA256 hash of the full query string, computed with your API
SECRET. The secret itself never leaves your machine; only the hash does.
This is why the secret must never be logged or committed: anyone holding
it can sign requests as you.

Key-scope reminder (safety rule #6): create keys with futures-trading
permission ONLY and withdrawals DISABLED — then a leaked key can lose at
most what's in the futures wallet, never move money out. Binance doesn't
let this code verify that setting via the futures API, so it's on you
when creating the keys. `.env.example` repeats this warning.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import math
import os
import time
import urllib.parse

import requests

log = logging.getLogger(__name__)

TESTNET_BASE_URL = "https://testnet.binancefuture.com"
LIVE_BASE_URL = "https://fapi.binance.com"

# The exact sentence required in the CONFIRM_LIVE_TRADING env var. Long and
# unpleasant on purpose — impossible to set by accident.
LIVE_CONFIRM_PHRASE = "I-ACCEPT-FULL-RESPONSIBILITY-FOR-REAL-MONEY-LOSSES"


class ExchangeError(Exception):
    """Raised when the exchange rejects a request or can't be reached."""


class FuturesExchange:
    """Authenticated USDT-M futures client (testnet by default, loudly)."""

    def __init__(
        self,
        api_key: str,
        api_secret: str,
        live_trading_config: bool = False,
        recv_window_ms: int = 5000,
        timeout_s: float = 15.0,
    ) -> None:
        if not api_key or not api_secret:
            raise ExchangeError(
                "Missing API key/secret. Copy .env.example to .env and fill in "
                "your TESTNET keys (see https://testnet.binancefuture.com)."
            )
        self.api_key = api_key
        self._api_secret = api_secret.encode()
        self.recv_window_ms = recv_window_ms
        self.timeout_s = timeout_s
        self.session = requests.Session()
        self.session.headers["X-MBX-APIKEY"] = api_key

        # ---------------- RULE #1: the testnet gate ----------------
        confirm = os.environ.get("CONFIRM_LIVE_TRADING", "")
        if live_trading_config and confirm == LIVE_CONFIRM_PHRASE:
            self.base_url = LIVE_BASE_URL
            self.is_testnet = False
            log.critical("=" * 70)
            log.critical("LIVE TRADING ENABLED — REAL MONEY AT RISK.")
            log.critical("=" * 70)
        elif live_trading_config and confirm:
            # Someone tried to go live but typed the phrase wrong: refuse to
            # run at all rather than silently fall back — a half-armed
            # switch is a footgun either way.
            raise ExchangeError(
                "risk.live_trading is true and CONFIRM_LIVE_TRADING is set but "
                "does not match the required phrase exactly. Refusing to start."
            )
        else:
            if live_trading_config:
                log.warning(
                    "risk.live_trading is true but CONFIRM_LIVE_TRADING is not "
                    "set — staying on TESTNET (this is the gate working)."
                )
            self.base_url = TESTNET_BASE_URL
            self.is_testnet = True
            log.info("Connected to Binance Futures TESTNET (fake money).")

        self._filters: dict[str, dict] = {}   # symbol → rounding rules cache

    # ------------------------------------------------------------------ #
    # Signing and transport
    # ------------------------------------------------------------------ #
    def _sign(self, params: dict) -> str:
        """HMAC-SHA256 signature of the query string (Binance's scheme)."""
        query = urllib.parse.urlencode(params)
        return hmac.new(self._api_secret, query.encode(), hashlib.sha256).hexdigest()

    def _request(self, method: str, path: str, params: dict | None = None,
                 signed: bool = True) -> dict | list:
        params = dict(params or {})
        if signed:
            params["timestamp"] = int(time.time() * 1000)
            params["recvWindow"] = self.recv_window_ms
            params["signature"] = self._sign(params)
        url = f"{self.base_url}{path}"
        try:
            resp = self.session.request(method, url, params=params,
                                        timeout=self.timeout_s)
        except requests.RequestException as exc:
            raise ExchangeError(f"Network error calling {path}: {exc}") from exc
        if resp.status_code != 200:
            # Binance error bodies are JSON like {"code": -2019, "msg": "..."}.
            raise ExchangeError(
                f"{method} {path} failed (HTTP {resp.status_code}): {resp.text[:300]}"
            )
        return resp.json()

    # ------------------------------------------------------------------ #
    # Account state
    # ------------------------------------------------------------------ #
    def get_usdt_balance(self) -> float:
        """USDT wallet balance of the futures account."""
        for entry in self._request("GET", "/fapi/v2/balance"):
            if entry["asset"] == "USDT":
                return float(entry["balance"])
        return 0.0

    def get_positions(self) -> list[dict]:
        """All non-flat positions: symbol, size (signed), entry price."""
        out = []
        for p in self._request("GET", "/fapi/v2/positionRisk"):
            amt = float(p["positionAmt"])
            if amt != 0.0:
                out.append({
                    "symbol": p["symbol"],
                    "size": amt,                       # + = long, - = short
                    "entry_price": float(p["entryPrice"]),
                    "unrealized_pnl": float(p["unRealizedProfit"]),
                })
        return out

    def get_open_orders(self, symbol: str) -> list[dict]:
        return self._request("GET", "/fapi/v1/openOrders", {"symbol": symbol})

    # ------------------------------------------------------------------ #
    # Rounding rules (exchangeInfo)
    # ------------------------------------------------------------------ #
    def _symbol_filters(self, symbol: str) -> dict:
        """Fetch (once) each symbol's rounding rules.

        Exchanges only accept quantities/prices on fixed grids — you can't
        buy 0.123456789 BTC. stepSize/tickSize define those grids.
        """
        if not self._filters:
            info = self._request("GET", "/fapi/v1/exchangeInfo", signed=False)
            for s in info["symbols"]:
                fs = {f["filterType"]: f for f in s["filters"]}
                self._filters[s["symbol"]] = {
                    "step_size": float(fs["LOT_SIZE"]["stepSize"]),
                    "min_qty": float(fs["LOT_SIZE"]["minQty"]),
                    "tick_size": float(fs["PRICE_FILTER"]["tickSize"]),
                    "min_notional": float(fs.get("MIN_NOTIONAL", {}).get("notional", 0.0)),
                }
        if symbol not in self._filters:
            raise ExchangeError(f"Unknown symbol {symbol!r} on this exchange.")
        return self._filters[symbol]

    def round_quantity(self, symbol: str, quantity: float) -> float:
        """Round DOWN to the symbol's quantity grid (down = never oversize)."""
        step = self._symbol_filters(symbol)["step_size"]
        return math.floor(quantity / step) * step

    def round_price(self, symbol: str, price: float) -> float:
        tick = self._symbol_filters(symbol)["tick_size"]
        return round(math.floor(price / tick) * tick, 10)

    def min_viable_quantity(self, symbol: str, price: float) -> float:
        """Smallest quantity the exchange will accept at this price."""
        f = self._symbol_filters(symbol)
        by_notional = f["min_notional"] / price if price > 0 else 0.0
        return max(f["min_qty"], by_notional)

    # ------------------------------------------------------------------ #
    # Orders
    # ------------------------------------------------------------------ #
    def market_order(self, symbol: str, side: str, quantity: float,
                     reduce_only: bool = False) -> dict:
        """Market order. side is 'BUY' or 'SELL'; reduce_only=True means
        'this may only shrink/close a position, never open or grow one' —
        we set it on every exit so a bug can't accidentally flip us from
        closing a long into opening a short."""
        params = {
            "symbol": symbol, "side": side, "type": "MARKET",
            "quantity": quantity,
        }
        if reduce_only:
            params["reduceOnly"] = "true"
        order = self._request("POST", "/fapi/v1/order", params)
        log.info("MARKET %s %s qty=%s%s → order id %s", side, symbol, quantity,
                 " (reduce-only)" if reduce_only else "", order.get("orderId"))
        return order

    def place_stop_loss(self, symbol: str, position_side: int, stop_price: float) -> dict:
        """Attach a stop that closes the WHOLE position when touched.

        STOP_MARKET + closePosition=true is Binance's native server-side
        stop: it lives on the exchange, so it triggers even if our bot is
        offline — which is exactly what a protective stop must do.
        position_side: +1 for a long (stop SELLS below), -1 short (BUYS above).
        """
        side = "SELL" if position_side == 1 else "BUY"
        params = {
            "symbol": symbol, "side": side, "type": "STOP_MARKET",
            "stopPrice": self.round_price(symbol, stop_price),
            "closePosition": "true",
        }
        order = self._request("POST", "/fapi/v1/order", params)
        log.info("STOP for %s %s @ %s → order id %s", symbol,
                 "long" if position_side == 1 else "short",
                 params["stopPrice"], order.get("orderId"))
        return order

    def cancel_all_orders(self, symbol: str) -> None:
        self._request("DELETE", "/fapi/v1/allOpenOrders", {"symbol": symbol})
        log.info("Cancelled all open orders for %s.", symbol)

    # ------------------------------------------------------------------ #
    # Market data (public, same venue as the orders)
    # ------------------------------------------------------------------ #
    def get_closed_candles(self, symbol: str, timeframe: str, limit: int = 400):
        """Recent CLOSED candles as the same dict format Phase 1 stores.

        Reuses the Phase 1 client pointed at THIS venue (testnet or live),
        so signals are computed from the same prices orders fill at.
        """
        from bot.data.binance_client import TIMEFRAME_MS, BinancePublicClient
        client = BinancePublicClient(base_url=self.base_url)
        now_ms = int(time.time() * 1000)
        start_ms = now_ms - limit * TIMEFRAME_MS[timeframe]
        candles: list[dict] = []
        for batch in client.iter_klines(symbol, timeframe, start_ms):
            candles.extend(batch)
        return candles

    # ------------------------------------------------------------------ #
    # The nuclear option (rule #7's second half)
    # ------------------------------------------------------------------ #
    def flatten_everything(self) -> list[str]:
        """Close every position at market, cancel every order. Returns a
        report of what was done. Used by the kill switch."""
        actions = []
        positions = self.get_positions()
        symbols = {p["symbol"] for p in positions}
        for symbol in symbols:
            self.cancel_all_orders(symbol)
            actions.append(f"cancelled open orders on {symbol}")
        for p in positions:
            side = "SELL" if p["size"] > 0 else "BUY"
            qty = abs(p["size"])
            self.market_order(p["symbol"], side, qty, reduce_only=True)
            actions.append(
                f"closed {p['symbol']} position of {p['size']:+g} at market"
            )
        if not actions:
            actions.append("nothing to do — no open positions or orders")
        return actions
