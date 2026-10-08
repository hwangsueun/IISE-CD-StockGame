"""DataGuide workbook -> game-compatible, versioned done data and Qlib provider.

Run from any directory; original workbooks are never modified. Missing prices
stay missing. This is the game's supplied 117-stock universe, not a reconstructed
historical exchange universe. Observed coverage is not an official listing date.
"""
import argparse
import hashlib
import json
from datetime import datetime, date
from pathlib import Path

import numpy as np
import openpyxl
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
FIELDS = {"시가(원)": "open", "고가(원)": "high", "저가(원)": "low",
          "종가(원)": "close", "거래대금(원)": "amount", "거래량(주)": "volume"}


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def write_json(path, obj):
    # Serialize before opening destination: a failed audit cannot truncate it.
    text = json.dumps(obj, ensure_ascii=False, indent=2, allow_nan=False)
    path = Path(path)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(text + "\n")
    temp.replace(path)


def read_dataguide(path, sheets):
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    records = []
    for sheet in sheets:
        ws = book[sheet]
        rows = iter(ws.values)
        meta = {}
        for row in rows:
            if isinstance(row[0], (datetime, date)):
                raise ValueError(f"{sheet}: missing metadata")
            meta[row[0]] = row
            if row[0] == "집계주기":
                break
        columns = {}
        for i, code in enumerate(meta["코드"][1:], 1):
            if not code:
                continue
            code = str(code).removeprefix("A")
            if len(code) != 6 or not code.isdigit():
                raise ValueError(f"Invalid stock code: {code}")
            field = FIELDS.get(meta["아이템명"][i])
            if field:
                columns.setdefault(code, {"name": meta["코드명"][i]})[field] = i
        for row in rows:
            if not isinstance(row[0], (datetime, date)):
                continue
            day = row[0].strftime("%Y-%m-%d")
            for code, cols in columns.items():
                values = {field: row[i] for field, i in cols.items() if field != "name"}
                if all(v in (None, "") for v in values.values()):
                    continue
                records.append({"date": day, "code": code, "asset_id": f"STOCK_{code}",
                                "name": cols["name"], **values})
        print(f"Parsed {sheet}: {len(records):,} cumulative rows", flush=True)
    book.close()
    frame = pd.DataFrame(records)
    frame = frame.drop_duplicates()
    if frame.duplicated(["date", "code"]).any():
        raise ValueError("Conflicting duplicate date/stock keys")
    for field in FIELDS.values():
        if field in frame:
            frame[field] = pd.to_numeric(frame[field], errors="raise")
    return frame.sort_values(["date", "code"]).reset_index(drop=True)


def build_provider(frame, out):
    calendar = sorted(frame.date.unique())
    for folder in ["calendars", "instruments", "features"]:
        (out / folder).mkdir(parents=True, exist_ok=True)
    (out / "calendars/day.txt").write_text("\n".join(calendar) + "\n")
    instruments = []
    for code, group in frame.groupby("code", sort=True):
        full = group.set_index("date").reindex(calendar)
        symbol = f"stock_{code}"
        dest = out / "features" / symbol
        dest.mkdir(exist_ok=True)
        for field in ["open", "high", "low", "close", "volume", "vwap"]:
            values = full[field].to_numpy(dtype="float32")
            # Raw, unadjusted game price convention; factor must not claim adjustment.
            np.r_[np.float32(0), values].astype("<f4").tofile(dest / f"{field}.day.bin")
        instruments.append(f"STOCK_{code}\t{group.date.min()}\t{group.date.max()}")
    (out / "instruments/all.txt").write_text("\n".join(instruments) + "\n")


def prepare(args):
    source = Path(args.source).resolve()
    game = Path(args.game_source).resolve()
    version = f"quant-v1-{digest(source)[:12]}"
    out = Path(args.output).resolve() / version
    if (out / "manifest.json").exists():
        manifest = json.loads((out / "manifest.json").read_text())
        if manifest["sources"]["game_prices"]["sha256"] != digest(game):
            raise ValueError("Existing version uses a different game workbook")
        print(f"Already prepared: {out}")
        return out
    out.mkdir(parents=True, exist_ok=True)
    raw = read_dataguide(source, ["13-17", "18-22", "23"])
    old = read_dataguide(game, ["13-17_price-volume", "18-22_price-volume", "23_price-volume"])
    joined = raw.merge(old[["date", "code", "close", "volume"]], on=["date", "code"],
                       how="left", suffixes=("", "_game"), validate="one_to_one", indicator=True)
    mismatches = joined[(joined._merge != "both") | ~np.isclose(joined.close, joined.close_game, equal_nan=True)
                        | ~np.isclose(joined.volume, joined.volume_game, equal_nan=True)]
    mismatches.to_csv(out / "game_alignment_mismatches.csv", index=False)
    if len(mismatches):
        raise ValueError(f"{len(mismatches)} close/volume mismatches; inspect {out}")
    valid_close = raw.close.notna() & (raw.close > 0)
    df = raw.loc[valid_close].copy()
    df["vwap"] = (df.amount / df.volume).where((df.volume > 0) & (df.amount > 0))
    df["tradable"] = ((df.volume > 0) & (df.amount > 0) & (df.open > 0)
                       & (df.high >= df.low) & (df.low > 0))
    # Suspensions have a carried close but zero OHLC/turnover; never fabricate bars.
    df.loc[~df.tradable, ["open", "high", "low", "vwap"]] = np.nan
    df[["date", "asset_id", "code", "open", "high", "low", "close", "volume", "amount", "vwap", "tradable"]].to_csv(
        out / "quant_daily.csv", index=False, float_format="%.12g")
    df[["asset_id", "date", "close"]].rename(columns={"date": "trade_date", "close": "close_price"}).to_csv(
        out / "asset_prices.csv", index=False)
    df[["asset_id", "date", "open", "high", "low", "close", "volume", "amount", "vwap"]].rename(
        columns={"date": "trade_date", "open": "open_price", "high": "high_price", "low": "low_price", "close": "close_price"}
    ).to_csv(out / "stock_price_detail.csv", index=False)
    coverage = df.groupby(["asset_id", "code"], as_index=False).agg(
        observed_from=("date", "min"), observed_to=("date", "max"), rows=("date", "size"))
    coverage.to_csv(out / "instruments.csv", index=False)
    build_provider(df, out / "qlib")
    jumps = df.sort_values(["code", "date"]).copy()
    jumps["raw_return"] = jumps.groupby("code").close.pct_change(fill_method=None)
    jumps = jumps[jumps.raw_return.abs() > .35]
    jumps[["date", "asset_id", "close", "raw_return"]].to_csv(out / "price_discontinuities.csv", index=False)
    manifest = {
        "version": version, "schema_version": 1, "status": "prepared",
        "sources": {"quant": {"path": str(source), "sha256": digest(source)},
                    "game_prices": {"path": str(game), "sha256": digest(game)}},
        "rows": len(df), "stocks": int(df.code.nunique()), "dates": int(df.date.nunique()),
        "from": df.date.min(), "to": df.date.max(), "game_alignment_mismatches": len(mismatches),
        "missing_or_nonpositive_close_rows": int((~valid_close).sum()),
        "nontradable_rows": int((~df.tradable).sum()), "price_discontinuities": len(jumps),
        "vwap": "amount_KRW / volume_shares; missing when either is nonpositive",
        "universe": "supplied game stocks; observed coverage only, historical survivorship not verified",
        "price_basis": "unadjusted, identical to game workbook; corporate actions and dividends not supplied",
        "files": {p.name: digest(p) for p in out.glob("*.csv")},
    }
    write_json(out / "manifest.json", manifest)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return out


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--source", default=ROOT / "quant_data.xlsx")
    p.add_argument("--game-source", default=ROOT / "data-pipeline/data/raw/stock/stock_price-volume_npq.xlsx")
    p.add_argument("--output", default=ROOT / "data-pipeline/data/done/quant")
    prepare(p.parse_args())
