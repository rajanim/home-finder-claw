"""07_load_neighborhood_data.py

Build per-ZIP neighborhood records and per-ZIP price trend records, then
load them into `neighborhoods-v1` and `zhvi-v1`.

Sources:
  - NYC 311 Socrata public API for noise and rodent complaint counts
    (last 12 months)
  - Zillow ZHVI all-homes CSV (downloaded if not already on disk)
  - Listings JSONL (already produced in step 02-04) for median_price
  - In-repo subway station table for nearby subway lines and a
    walkability proxy

Schools are intentionally left empty for now; a follow-up pass can fill
them once a clean DOE feed is wired in. The Researcher synthesizer is
instructed to omit topics with no data, so empty schools degrades
gracefully.

Reads:  data/processed/listings.embedded.jsonl (or listings.cleaned.jsonl as fallback)
Writes: OpenSearch indexes `neighborhoods-v1` and `zhvi-v1`

Run from the repo root:
    python scripts/ingest/07_load_neighborhood_data.py [--no-reset]
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import statistics
import sys
import time
from pathlib import Path

import requests
from opensearchpy.helpers import bulk

from _common import (
    DATA_PROCESSED,
    DATA_RAW,
    INDEX_NEIGHBORHOODS,
    INDEX_ZHVI,
    NYC_ZIPS,
    SUBWAY_STATIONS,
    centroid_for_zip,
    get_logger,
    get_opensearch,
    haversine_m,
    read_jsonl,
)

log = get_logger("07_load_neighborhood_data")

NYC_311_URL = "https://data.cityofnewyork.us/resource/erm2-nwe9.json"
ZHVI_URL = (
    "https://files.zillowstatic.com/research/public_csvs/zhvi/"
    "Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"
)
ZHVI_LOCAL = DATA_RAW / "zhvi.csv"

NEIGHBORHOODS_MAPPING: dict = {
    "settings": {"index": {"number_of_shards": 1, "number_of_replicas": 0}},
    "mappings": {
        "properties": {
            "zip": {"type": "keyword"},
            "borough": {"type": "keyword"},
            "median_price": {"type": "integer"},
            "noise_complaints_12m": {"type": "integer"},
            "rodent_complaints_12m": {"type": "integer"},
            "schools": {
                "type": "nested",
                "properties": {
                    "name": {"type": "text"},
                    "rating": {"type": "float"},
                    "level": {"type": "keyword"},
                },
            },
            "subway_lines": {"type": "keyword"},
            "walkability_proxy": {"type": "float"},
            "summary_text": {"type": "text"},
        }
    },
}

ZHVI_MAPPING: dict = {
    "settings": {"index": {"number_of_shards": 1, "number_of_replicas": 0}},
    "mappings": {
        "properties": {
            "zip": {"type": "keyword"},
            "month": {"type": "date"},
            "zhvi_value": {"type": "float"},
            "yoy_change": {"type": "float"},
        }
    },
}


# --------------------------------------------------------------------------
# 311 complaints
# --------------------------------------------------------------------------

def fetch_complaint_count(zip_code: str, complaint_type: str, since_iso: str) -> int:
    """Query Socrata for count(*) of complaints matching the filter."""
    where = (
        f"incident_zip='{zip_code}' AND "
        f"complaint_type='{complaint_type}' AND "
        f"created_date>'{since_iso}'"
    )
    params = {"$select": "count(*) AS c", "$where": where}
    try:
        resp = requests.get(NYC_311_URL, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        log.warning("311 query failed for zip=%s type=%s: %s", zip_code, complaint_type, e)
        return 0
    if not data:
        return 0
    try:
        return int(data[0].get("c", 0))
    except (ValueError, KeyError):
        return 0


def gather_complaints(zips: list[str]) -> dict[str, dict[str, int]]:
    one_year_ago = (dt.datetime.utcnow() - dt.timedelta(days=365)).date().isoformat()
    out: dict[str, dict[str, int]] = {}
    log.info("Fetching 311 complaint counts since %s for %d zips", one_year_ago, len(zips))
    for zip_code in zips:
        out[zip_code] = {
            "noise": fetch_complaint_count(zip_code, "Noise", one_year_ago),
            "rodent": fetch_complaint_count(zip_code, "Rodent", one_year_ago),
        }
        time.sleep(0.05)  # be polite to Socrata
    return out


# --------------------------------------------------------------------------
# ZHVI
# --------------------------------------------------------------------------

def download_zhvi() -> Path | None:
    if ZHVI_LOCAL.exists():
        log.info("ZHVI already at %s", ZHVI_LOCAL)
        return ZHVI_LOCAL
    log.info("Downloading ZHVI from %s", ZHVI_URL)
    try:
        resp = requests.get(ZHVI_URL, timeout=120)
        resp.raise_for_status()
    except Exception as e:
        log.warning("ZHVI download failed: %s. Skipping zhvi-v1 load.", e)
        return None
    ZHVI_LOCAL.parent.mkdir(parents=True, exist_ok=True)
    ZHVI_LOCAL.write_bytes(resp.content)
    return ZHVI_LOCAL


def parse_zhvi(path: Path, zips: set[str]) -> list[dict]:
    """Yield zhvi rows (zip, month, value, yoy_change) for NYC zips only."""
    with path.open(newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
        # Find columns: RegionName is the ZIP, all trailing date columns are months
        try:
            zip_idx = header.index("RegionName")
        except ValueError:
            log.error("ZHVI CSV missing RegionName column")
            return []
        date_cols: list[tuple[int, str]] = []
        for i, col in enumerate(header):
            try:
                # Months are formatted like 2024-01-31
                dt.date.fromisoformat(col)
                date_cols.append((i, col))
            except ValueError:
                continue
        log.info("ZHVI date columns: %d", len(date_cols))
        rows_out: list[dict] = []
        for row in reader:
            zip_code = str(row[zip_idx]).zfill(5)
            if zip_code not in zips:
                continue
            # Extract series; allow gaps
            series: list[tuple[str, float]] = []
            for i, col in date_cols:
                v = row[i] if i < len(row) else ""
                if not v:
                    continue
                try:
                    series.append((col, float(v)))
                except ValueError:
                    continue
            # Compute YoY for each month using a 12-row lookback
            by_month = {m: v for m, v in series}
            for m, v in series:
                d = dt.date.fromisoformat(m)
                prev = (d - dt.timedelta(days=365)).isoformat()
                # Find the closest prior month value (exact match if present)
                prev_v = by_month.get(prev)
                if prev_v is None:
                    yoy = None
                elif prev_v == 0:
                    yoy = None
                else:
                    yoy = (v - prev_v) / prev_v
                doc = {
                    "zip": zip_code,
                    "month": m,
                    "zhvi_value": v,
                    "yoy_change": yoy,
                }
                rows_out.append(doc)
        log.info("Built %d zhvi rows for %d NYC zips", len(rows_out), len(zips))
        return rows_out


# --------------------------------------------------------------------------
# Subway proximity helpers
# --------------------------------------------------------------------------

def lines_near(lat: float, lon: float, radius_m: float = 1000.0) -> list[str]:
    out: set[str] = set()
    for s in SUBWAY_STATIONS:
        if haversine_m(lat, lon, s.lat, s.lon) <= radius_m:
            out.update(s.lines)
    return sorted(out)


def walkability_proxy(lat: float, lon: float) -> float:
    """0..1: count of stations within 800m, capped at 5."""
    n = sum(1 for s in SUBWAY_STATIONS if haversine_m(lat, lon, s.lat, s.lon) <= 800)
    return round(min(n, 5) / 5.0, 2)


# --------------------------------------------------------------------------
# Build neighborhood docs
# --------------------------------------------------------------------------

def median_prices_by_zip(listings: list[dict]) -> dict[str, int]:
    by: dict[str, list[int]] = {}
    for l in listings:
        z = l.get("zip")
        p = l.get("price")
        if z and isinstance(p, (int, float)) and p > 0:
            by.setdefault(z, []).append(int(p))
    return {z: int(round(statistics.median(v))) for z, v in by.items() if v}


def build_neighborhood_docs(
    listings: list[dict],
    complaints: dict[str, dict[str, int]],
) -> list[dict]:
    medians = median_prices_by_zip(listings)
    docs: list[dict] = []
    for zip_code, borough, lat, lon in NYC_ZIPS:
        c = complaints.get(zip_code, {"noise": 0, "rodent": 0})
        lines = lines_near(lat, lon)
        walk = walkability_proxy(lat, lon)
        median_price = medians.get(zip_code)
        summary = (
            f"{borough} ZIP {zip_code}. "
            f"Median listing price: ${median_price:,}. " if median_price else f"{borough} ZIP {zip_code}. "
        )
        if lines:
            summary += f"Subway lines within 1 km: {', '.join(lines)}. "
        summary += f"Noise complaints (12 months): {c['noise']}. Rodent complaints (12 months): {c['rodent']}."
        docs.append(
            {
                "zip": zip_code,
                "borough": borough,
                "median_price": median_price,
                "noise_complaints_12m": c["noise"],
                "rodent_complaints_12m": c["rodent"],
                "schools": [],  # filled in a later pass
                "subway_lines": lines,
                "walkability_proxy": walk,
                "summary_text": summary.strip(),
            }
        )
    return docs


# --------------------------------------------------------------------------
# Loaders
# --------------------------------------------------------------------------

def load_index(client, name: str, mapping: dict, docs: list[dict], id_key, reset: bool) -> int:
    if reset and client.indices.exists(index=name):
        log.info("Dropping existing index %s", name)
        client.indices.delete(index=name)
    if not client.indices.exists(index=name):
        log.info("Creating index %s", name)
        client.indices.create(index=name, body=mapping)

    def actions():
        for d in docs:
            yield {
                "_index": name,
                "_id": id_key(d),
                "_source": d,
            }

    success, errors = bulk(client, actions(), chunk_size=500, request_timeout=120, raise_on_error=False)
    log.info("Index %s loaded: %d docs, errors: %d", name, success, len(errors) if isinstance(errors, list) else errors)
    if isinstance(errors, list) and errors:
        for err in errors[:3]:
            log.error("  example error: %s", err)
    client.indices.refresh(index=name)
    return success


def find_listings_file() -> Path | None:
    for name in ("listings.embedded.jsonl", "listings.with_photos.jsonl", "listings.cleaned.jsonl"):
        p = DATA_PROCESSED / name
        if p.exists():
            return p
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-reset", action="store_true")
    args = parser.parse_args()
    reset = not args.no_reset

    listings_file = find_listings_file()
    if listings_file is None:
        log.error("No processed listings file found in %s. Run 02_clean_listings.py first.", DATA_PROCESSED)
        return 1
    log.info("Using listings: %s", listings_file)
    listings = read_jsonl(listings_file)

    zips = sorted({z for z, *_ in NYC_ZIPS})
    complaints = gather_complaints(zips)
    neighborhood_docs = build_neighborhood_docs(listings, complaints)

    client = get_opensearch()
    load_index(
        client,
        INDEX_NEIGHBORHOODS,
        NEIGHBORHOODS_MAPPING,
        neighborhood_docs,
        id_key=lambda d: d["zip"],
        reset=reset,
    )

    zhvi_path = download_zhvi()
    if zhvi_path is not None:
        zhvi_docs = parse_zhvi(zhvi_path, set(zips))
        if zhvi_docs:
            load_index(
                client,
                INDEX_ZHVI,
                ZHVI_MAPPING,
                zhvi_docs,
                id_key=lambda d: f"{d['zip']}|{d['month']}",
                reset=reset,
            )
    else:
        log.warning("ZHVI not loaded; %s index may be empty until you provide a CSV at %s", INDEX_ZHVI, ZHVI_LOCAL)

    return 0


if __name__ == "__main__":
    sys.exit(main())
