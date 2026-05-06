"""02_clean_listings.py

Read the raw Kaggle CSV, filter to NYC, drop rows with missing critical
fields, sample down to a fixed size with a fixed seed, and emit one JSONL
row per listing in the shape expected by `listings-v1`.

The output file goes to `data/processed/listings.cleaned.jsonl`. Each
subsequent script reads this and writes a new file (`listings.with_photos`,
`listings.embedded`) so any step can be re-run in isolation.

Run from the repo root:
    python scripts/ingest/02_clean_listings.py
"""

from __future__ import annotations

import hashlib
import math
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from _common import (
    DATA_PROCESSED,
    DATA_RAW,
    borough_for_zip,
    centroid_for_zip,
    get_logger,
    nearest_subway,
    write_jsonl,
)

log = get_logger("02_clean_listings")

SAMPLE_SIZE = 5_000
SAMPLE_SEED = 42
JITTER_DEG = 0.005  # ~500 meters; deterministic per listing
NYC_CITIES = {
    "Brooklyn",
    "Manhattan",
    "Queens",
    "Bronx",
    "Staten Island",
    "New York",
    "New York City",
}

OUTPUT = DATA_PROCESSED / "listings.cleaned.jsonl"


def find_csv(directory: Path) -> Path | None:
    csvs = sorted(directory.glob("*.csv"))
    return csvs[0] if csvs else None


def deterministic_jitter(seed_str: str) -> tuple[float, float]:
    """Two-axis jitter in [-JITTER_DEG, +JITTER_DEG], deterministic from a string."""
    h = hashlib.sha1(seed_str.encode()).digest()
    # use first 8 bytes for two floats in [-1, 1]
    rx = (int.from_bytes(h[0:4], "big") / 2**32) * 2 - 1
    ry = (int.from_bytes(h[4:8], "big") / 2**32) * 2 - 1
    return rx * JITTER_DEG, ry * JITTER_DEG


def infer_property_type(beds: int, baths: float, house_size_sqft: int | None, lot_size_acre: float | None) -> str:
    if lot_size_acre is not None and lot_size_acre > 0.05:
        return "house"
    if house_size_sqft is not None and house_size_sqft > 2_500:
        return "townhouse"
    if beds == 0:
        return "studio"
    return "condo"


def synthesize_description(row: dict) -> str:
    parts: list[str] = []
    bed_label = "studio" if row["beds"] == 0 else f"{row['beds']}-bedroom"
    parts.append(f"{bed_label} {row['property_type']} in {row['borough']}")
    if row.get("house_size_sqft"):
        parts.append(f"{row['house_size_sqft']} square feet")
    parts.append(f"{row['baths']} bath")
    if row.get("lot_size_acre"):
        parts.append(f"{row['lot_size_acre']} acre lot")
    parts.append(
        f"close to {row['nearest_subway']} ({row['subway_distance_m']} meters)"
    )
    return ". ".join(parts) + "."


def build_title(row: dict) -> str:
    bed_label = "Studio" if row["beds"] == 0 else f"{row['beds']} Bed"
    return f"{bed_label}, {row['baths']} Bath in {row['borough']}"


def make_listing_id(row: dict) -> str:
    seed = f"{row.get('street','')}|{row.get('city','')}|{row.get('zip_code','')}|{row.get('price','')}|{row.get('beds','')}"
    return "lst_" + hashlib.sha1(seed.encode()).hexdigest()[:16]


def main() -> int:
    csv_path = find_csv(DATA_RAW)
    if csv_path is None:
        log.error("No CSV in %s. Run 01_fetch_data.py first.", DATA_RAW)
        return 1
    log.info("Reading %s", csv_path)
    df = pd.read_csv(csv_path, low_memory=False)
    log.info("Total rows: %d", len(df))

    # Filter: state + city + status
    df = df[df["state"].astype(str).str.strip().eq("New York")]
    df = df[df["city"].astype(str).str.strip().isin(NYC_CITIES)]
    if "status" in df.columns:
        df = df[df["status"].astype(str).str.lower().eq("for_sale")]
    log.info("After NY/NYC/for_sale filter: %d", len(df))

    # Coerce numerics
    for col in ("price", "bed", "bath", "house_size", "acre_lot"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Drop rows with missing critical fields
    df = df.dropna(subset=["price", "bed", "bath", "zip_code"])
    df = df[df["price"] > 0]
    log.info("After numeric / zip / price filter: %d", len(df))

    # Normalize zip and require it to be in our NYC ZIP table (gives us
    # borough + centroid and avoids out-of-bounds rows).
    df["zip_code"] = df["zip_code"].astype(int).astype(str).str.zfill(5)
    df = df[df["zip_code"].apply(borough_for_zip).notna()]
    log.info("After known-zip filter: %d", len(df))

    # Sample with fixed seed for reproducibility
    if len(df) > SAMPLE_SIZE:
        df = df.sample(n=SAMPLE_SIZE, random_state=SAMPLE_SEED).reset_index(drop=True)
    log.info("Sampled to %d rows", len(df))

    now = datetime.now(timezone.utc).isoformat()
    rows_out: list[dict] = []
    for raw in df.to_dict(orient="records"):
        zip_code = str(raw["zip_code"])
        borough = borough_for_zip(zip_code)
        centroid = centroid_for_zip(zip_code)
        if borough is None or centroid is None:
            continue
        clat, clon = centroid

        beds = int(raw["bed"])
        baths = float(raw["bath"])
        house_size_sqft = (
            int(raw["house_size"]) if not math.isnan(raw.get("house_size", float("nan"))) else None
        )
        lot_size_acre = (
            float(raw["acre_lot"]) if not math.isnan(raw.get("acre_lot", float("nan"))) else None
        )
        price = int(raw["price"])
        street = str(raw.get("street") or "").strip() or None
        city = str(raw.get("city") or "").strip() or borough

        property_type = infer_property_type(beds, baths, house_size_sqft, lot_size_acre)

        seed_str = f"{street}|{city}|{zip_code}|{price}"
        dlat, dlon = deterministic_jitter(seed_str)
        lat = clat + dlat
        lon = clon + dlon

        station, dist_m = nearest_subway(lat, lon)

        listing: dict = {
            "listing_id": "",  # set below
            "title": "",  # set below
            "description": "",  # set below
            "price": price,
            "beds": beds,
            "baths": baths,
            "house_size_sqft": house_size_sqft,
            "lot_size_acre": lot_size_acre,
            "year_built": None,
            "property_type": property_type,
            "status": "for_sale",
            "address": street,
            "city": city,
            "borough": borough,
            "zip": zip_code,
            "location": {"lat": round(lat, 6), "lon": round(lon, 6)},
            "nearest_subway": station.name,
            "subway_distance_m": int(round(dist_m)),
            "school_zone": None,
            "photos": [],
            "text_embedding": None,
            "image_embedding": None,
            "ingested_at": now,
            # raw fields kept for downstream id and synthesis
            "_raw_street": street,
            "_raw_zip_code": zip_code,
        }
        listing["listing_id"] = make_listing_id(
            {"street": street, "city": city, "zip_code": zip_code, "price": price, "beds": beds}
        )
        listing["title"] = build_title(listing)
        listing["description"] = synthesize_description(listing)
        # remove ephemeral seed fields so the JSONL is clean
        listing.pop("_raw_street", None)
        listing.pop("_raw_zip_code", None)
        rows_out.append(listing)

    n = write_jsonl(OUTPUT, rows_out)
    log.info("Wrote %d listings to %s", n, OUTPUT)

    # Per-borough sanity counts
    by_borough: dict[str, int] = {}
    for r in rows_out:
        by_borough[r["borough"]] = by_borough.get(r["borough"], 0) + 1
    for b, c in sorted(by_borough.items(), key=lambda kv: -kv[1]):
        log.info("  %-15s %d", b, c)

    return 0


if __name__ == "__main__":
    sys.exit(main())
