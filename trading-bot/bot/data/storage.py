"""Stores market data in a local SQLite database.

Why store locally at all? Two reasons:
    1. Speed — a backtest may read the same 3 years of candles hundreds of
       times while we tweak the strategy. Reading from a local file takes
       milliseconds; re-downloading takes minutes.
    2. Reproducibility — a backtest run against a frozen local dataset gives
       the same answer every time, which matters when comparing strategies.

Why SQLite? It's a real database that lives in one ordinary file, needs no
server, and ships inside Python itself (`import sqlite3` — nothing to
install). For the few hundred thousand rows a swing bot needs, it's plenty.

The one clever bit in this file is the PRIMARY KEY on
(symbol, timeframe, open_time) plus `INSERT OR REPLACE`:
    * a primary key means the database physically cannot hold two rows for
      the same candle — duplicates are impossible by construction, and
    * "OR REPLACE" means re-downloading an overlapping range simply
      overwrites identical rows instead of crashing.
    Together they make the pipeline "idempotent": run it 1 time or 10 times,
    you end up with exactly the same clean dataset.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pandas as pd


class MarketDataStore:
    """All reading and writing of the local market-data database."""

    def __init__(self, db_path: str | Path) -> None:
        self.db_path = Path(db_path)
        # Create the parent folder (e.g. data/) if it doesn't exist yet.
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.db_path)
        self._create_tables()

    def _create_tables(self) -> None:
        """Create our two tables on first run (no-op afterwards)."""
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS candles (
                symbol       TEXT    NOT NULL,   -- e.g. 'BTCUSDT'
                timeframe    TEXT    NOT NULL,   -- e.g. '4h'
                open_time    INTEGER NOT NULL,   -- candle start, ms since 1970 UTC
                open         REAL    NOT NULL,
                high         REAL    NOT NULL,
                low          REAL    NOT NULL,
                close        REAL    NOT NULL,
                volume       REAL    NOT NULL,
                close_time   INTEGER NOT NULL,
                quote_volume REAL    NOT NULL,
                trade_count  INTEGER NOT NULL,
                PRIMARY KEY (symbol, timeframe, open_time)
            );

            CREATE TABLE IF NOT EXISTS funding_rates (
                symbol       TEXT    NOT NULL,
                funding_time INTEGER NOT NULL,   -- when the payment happened (ms UTC)
                funding_rate REAL    NOT NULL,   -- e.g. 0.0001 = 0.01% per 8 hours
                PRIMARY KEY (symbol, funding_time)
            );
            """
        )
        self.conn.commit()

    # ------------------------------------------------------------------ #
    # Writing
    # ------------------------------------------------------------------ #
    def save_candles(self, candles: list[dict]) -> int:
        """Insert a batch of candles; overwrite any that already exist.

        Returns how many rows were written (useful for progress messages).
        """
        if not candles:
            return 0
        self.conn.executemany(
            """
            INSERT OR REPLACE INTO candles
                (symbol, timeframe, open_time, open, high, low, close,
                 volume, close_time, quote_volume, trade_count)
            VALUES
                (:symbol, :timeframe, :open_time, :open, :high, :low, :close,
                 :volume, :close_time, :quote_volume, :trade_count)
            """,
            candles,
        )
        self.conn.commit()
        return len(candles)

    def save_funding_rates(self, rates: list[dict]) -> int:
        """Insert a batch of funding-rate rows; overwrite duplicates."""
        if not rates:
            return 0
        self.conn.executemany(
            """
            INSERT OR REPLACE INTO funding_rates (symbol, funding_time, funding_rate)
            VALUES (:symbol, :funding_time, :funding_rate)
            """,
            rates,
        )
        self.conn.commit()
        return len(rates)

    # ------------------------------------------------------------------ #
    # Reading
    # ------------------------------------------------------------------ #
    def latest_candle_time(self, symbol: str, timeframe: str) -> int | None:
        """Newest stored open_time for a symbol/timeframe, or None if empty.

        This powers incremental updates: the pipeline asks "what do I
        already have?" and only downloads candles newer than that, instead
        of re-fetching 3 years of history on every run.
        """
        row = self.conn.execute(
            "SELECT MAX(open_time) FROM candles WHERE symbol = ? AND timeframe = ?",
            (symbol, timeframe),
        ).fetchone()
        return row[0] if row and row[0] is not None else None

    def latest_funding_time(self, symbol: str) -> int | None:
        """Newest stored funding_time for a symbol, or None if empty."""
        row = self.conn.execute(
            "SELECT MAX(funding_time) FROM funding_rates WHERE symbol = ?",
            (symbol,),
        ).fetchone()
        return row[0] if row and row[0] is not None else None

    def load_candles(self, symbol: str, timeframe: str) -> pd.DataFrame:
        """Load all candles for a symbol/timeframe as a pandas DataFrame.

        This is the hand-off point to every later phase: indicators (Phase 2)
        and the backtester (Phase 3) both start from this DataFrame.
        The index is the candle open time as real UTC datetimes, which makes
        pandas time-slicing work naturally (df["2023-01":"2023-06"]).
        """
        df = pd.read_sql_query(
            """
            SELECT open_time, open, high, low, close, volume,
                   close_time, quote_volume, trade_count
            FROM candles
            WHERE symbol = ? AND timeframe = ?
            ORDER BY open_time ASC
            """,
            self.conn,
            params=(symbol, timeframe),
        )
        if df.empty:
            return df
        df["open_time"] = pd.to_datetime(df["open_time"], unit="ms", utc=True)
        return df.set_index("open_time")

    def load_funding_rates(self, symbol: str) -> pd.DataFrame:
        """Load all funding-rate history for a symbol as a DataFrame."""
        df = pd.read_sql_query(
            """
            SELECT funding_time, funding_rate
            FROM funding_rates
            WHERE symbol = ?
            ORDER BY funding_time ASC
            """,
            self.conn,
            params=(symbol,),
        )
        if df.empty:
            return df
        df["funding_time"] = pd.to_datetime(df["funding_time"], unit="ms", utc=True)
        return df.set_index("funding_time")

    def candle_open_times(self, symbol: str, timeframe: str) -> list[int]:
        """All stored open_times (raw milliseconds) in ascending order.

        Used by the gap checker, which needs exact integer arithmetic —
        going through datetime conversions and back invites off-by-a-unit
        bugs (and caused one during development, caught by the tests).
        """
        rows = self.conn.execute(
            "SELECT open_time FROM candles WHERE symbol = ? AND timeframe = ? "
            "ORDER BY open_time ASC",
            (symbol, timeframe),
        ).fetchall()
        return [r[0] for r in rows]

    def candle_count(self, symbol: str, timeframe: str) -> int:
        """How many candles are stored for a symbol/timeframe."""
        row = self.conn.execute(
            "SELECT COUNT(*) FROM candles WHERE symbol = ? AND timeframe = ?",
            (symbol, timeframe),
        ).fetchone()
        return int(row[0])

    def close(self) -> None:
        """Close the database file handle when we're done."""
        self.conn.close()

    # Support `with MarketDataStore(...) as store:` so the file always gets
    # closed properly, even if an error happens mid-way.
    def __enter__(self) -> "MarketDataStore":
        return self

    def __exit__(self, *exc_info) -> None:
        self.close()
