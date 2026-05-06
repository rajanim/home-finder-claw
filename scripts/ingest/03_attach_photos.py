"""03_attach_photos.py

Attach 4 photos per listing (exterior, living, kitchen, bedroom) by querying
Unsplash for a small number of buckets and assigning photos deterministically
from the bucket pools.

Bucket = (borough, room_type). With 5 boroughs and 4 room types, the worst
case is 20 Unsplash queries, well under the developer cap of 50 per hour.
The bucket pool is cached at `data/processed/photo_pool.json` so re-runs
hit Unsplash only for missing buckets.

Reads:  data/processed/listings.cleaned.jsonl
Writes: data/processed/listings.with_photos.jsonl
        data/processed/photo_pool.json (cache)

Run from the repo root:
    python scripts/ingest/03_attach_photos.py
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import requests

from _common import DATA_PROCESSED, get_logger, read_jsonl, require_env, write_jsonl

log = get_logger("03_attach_photos")

INPUT = DATA_PROCESSED / "listings.cleaned.jsonl"
OUTPUT = DATA_PROCESSED / "listings.with_photos.jsonl"
CACHE = DATA_PROCESSED / "photo_pool.json"

ROOM_TYPES = ("exterior", "living", "kitchen", "bedroom")
BOROUGHS = ("Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island")
PHOTOS_PER_BUCKET = 10

UNSPLASH_SEARCH_URL = "https://api.unsplash.com/search/photos"


def query_for(borough: str, room_type: str) -> str:
    style = {
        "Manhattan": "manhattan apartment",
        "Brooklyn": "brooklyn brownstone",
        "Queens": "queens apartment",
        "Bronx": "bronx apartment",
        "Staten Island": "staten island house",
    }[borough]
    return f"{style} {room_type} interior" if room_type != "exterior" else f"{style} exterior building"


def fetch_bucket(access_key: str, query: str) -> list[dict]:
    log.info("Unsplash query: %r", query)
    resp = requests.get(
        UNSPLASH_SEARCH_URL,
        params={"query": query, "per_page": PHOTOS_PER_BUCKET, "orientation": "landscape"},
        headers={"Authorization": f"Client-ID {access_key}"},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    out: list[dict] = []
    for r in data.get("results", []):
        out.append(
            {
                "url": r["urls"]["regular"],
                "alt": r.get("alt_description") or query,
                "credit_name": r.get("user", {}).get("name"),
                "credit_url": r.get("user", {}).get("links", {}).get("html"),
                "unsplash_id": r.get("id"),
            }
        )
    return out


def load_cache() -> dict[str, list[dict]]:
    if CACHE.exists():
        with CACHE.open() as f:
            return json.load(f)
    return {}


def save_cache(pool: dict[str, list[dict]]) -> None:
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    with CACHE.open("w") as f:
        json.dump(pool, f, indent=2)


def bucket_key(borough: str, room_type: str) -> str:
    return f"{borough}|{room_type}"


def assign_index(listing_id: str, room_type: str, pool_size: int) -> int:
    h = hashlib.sha1(f"{listing_id}|{room_type}".encode()).digest()
    return int.from_bytes(h[:4], "big") % max(pool_size, 1)


def main() -> int:
    if not INPUT.exists():
        log.error("Missing %s. Run 02_clean_listings.py first.", INPUT)
        return 1
    env = require_env("UNSPLASH_ACCESS_KEY")
    access_key = env["UNSPLASH_ACCESS_KEY"]

    pool = load_cache()
    fetched = 0
    for borough in BOROUGHS:
        for room_type in ROOM_TYPES:
            key = bucket_key(borough, room_type)
            if key in pool and pool[key]:
                continue
            pool[key] = fetch_bucket(access_key, query_for(borough, room_type))
            fetched += 1
    if fetched:
        save_cache(pool)
        log.info("Cached photo pool to %s (%d new buckets)", CACHE, fetched)
    else:
        log.info("Photo pool fully cached, no Unsplash calls needed")

    listings = read_jsonl(INPUT)
    log.info("Loaded %d listings", len(listings))

    missing = 0
    for listing in listings:
        photos: list[str] = []
        for room_type in ROOM_TYPES:
            bucket = pool.get(bucket_key(listing["borough"], room_type), [])
            if not bucket:
                missing += 1
                continue
            idx = assign_index(listing["listing_id"], room_type, len(bucket))
            photos.append(bucket[idx]["url"])
        listing["photos"] = photos

    n = write_jsonl(OUTPUT, listings)
    log.info("Wrote %d listings to %s", n, OUTPUT)
    if missing:
        log.warning("Missing photos for %d (listing, room_type) pairs", missing)
    return 0


if __name__ == "__main__":
    sys.exit(main())
