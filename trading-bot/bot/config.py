"""Loads and validates config.yaml.

Why a separate module for this?
    If we read the YAML file directly wherever we need a setting, a typo in
    the config (say, a misspelled timeframe) would only blow up deep inside
    the code, with a confusing error. Instead we load the whole file ONCE,
    check every value, and fail immediately with a plain-English message.
    "Fail fast and loudly" is a theme you'll see across this whole project.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import yaml

# The only candle sizes the bot supports. These strings are exactly what
# Binance's API expects in its `interval` parameter.
VALID_TIMEFRAMES = {"1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w"}


@dataclass
class DataConfig:
    """Settings for the data pipeline (the `data:` section of config.yaml).

    A "dataclass" is a plain container for values. Using one (instead of
    passing a raw dictionary around) means your editor can autocomplete
    `config.symbols`, and a typo like `config.symbls` fails instantly
    instead of silently returning nothing.
    """

    symbols: list[str] = field(default_factory=lambda: ["BTCUSDT"])
    timeframes: list[str] = field(default_factory=lambda: ["4h", "1d"])
    start_date: str = "2022-07-01"
    db_path: str = "data/market_data.db"
    fetch_funding_rates: bool = True

    def start_ms(self) -> int:
        """The start date as a Unix timestamp in milliseconds.

        Binance's API doesn't speak dates like "2022-07-01"; it speaks
        "milliseconds since 1 January 1970 UTC" (a Unix timestamp). All
        timestamps in this project are UTC — mixing local time and UTC is
        a classic source of subtle trading bugs, so we simply never use
        local time anywhere.
        """
        dt = datetime.strptime(self.start_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)


def load_config(path: str | Path = "config.yaml") -> DataConfig:
    """Read config.yaml, validate it, and return a DataConfig.

    Raises ValueError with a human-readable message if anything looks wrong,
    so a broken config never makes it into the pipeline.
    """
    path = Path(path)
    if not path.exists():
        raise ValueError(
            f"Config file not found: {path}. "
            "Run commands from the trading-bot/ folder, or pass --config."
        )

    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}

    data_section = raw.get("data")
    if not isinstance(data_section, dict):
        raise ValueError("config.yaml must contain a `data:` section.")

    cfg = DataConfig(
        symbols=data_section.get("symbols", DataConfig().symbols),
        timeframes=data_section.get("timeframes", DataConfig().timeframes),
        start_date=str(data_section.get("start_date", DataConfig().start_date)),
        db_path=str(data_section.get("db_path", DataConfig().db_path)),
        fetch_funding_rates=bool(data_section.get("fetch_funding_rates", True)),
    )

    # --- Validation: catch mistakes here, not three modules deeper. ---
    if not cfg.symbols:
        raise ValueError("`data.symbols` is empty — list at least one symbol.")
    for sym in cfg.symbols:
        # Binance futures symbols are plain uppercase strings like BTCUSDT.
        if not (isinstance(sym, str) and sym.isupper() and sym.isalnum()):
            raise ValueError(f"Symbol {sym!r} doesn't look like a Binance symbol (e.g. BTCUSDT).")

    for tf in cfg.timeframes:
        if tf not in VALID_TIMEFRAMES:
            raise ValueError(
                f"Timeframe {tf!r} is not supported. Choose from: {sorted(VALID_TIMEFRAMES)}. "
                "(We deliberately exclude minute-level candles — this is a swing bot.)"
            )

    try:
        cfg.start_ms()
    except ValueError as exc:
        raise ValueError(
            f"`data.start_date` must look like YYYY-MM-DD, got {cfg.start_date!r}."
        ) from exc

    return cfg
