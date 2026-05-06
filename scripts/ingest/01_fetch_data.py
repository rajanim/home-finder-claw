"""01_fetch_data.py

Download the Kaggle dataset `ahmedshahriarsakib/usa-real-estate-dataset` to
`data/raw/`. Idempotent: if the CSV already exists locally, the download is
skipped.

Requires: ~/.kaggle/kaggle.json with valid API credentials.

Run from the repo root:
    python scripts/ingest/01_fetch_data.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from _common import DATA_RAW, get_logger

log = get_logger("01_fetch_data")

KAGGLE_DATASET = "ahmedshahriarsakib/usa-real-estate-dataset"
# The dataset ships with a single CSV. Filename has been stable but we still
# detect it dynamically after extraction.


def find_csv(directory: Path) -> Path | None:
    candidates = sorted(directory.glob("*.csv"))
    return candidates[0] if candidates else None


def main() -> int:
    DATA_RAW.mkdir(parents=True, exist_ok=True)

    existing = find_csv(DATA_RAW)
    if existing is not None:
        log.info("CSV already present at %s, skipping download", existing)
        return 0

    log.info("Downloading %s to %s", KAGGLE_DATASET, DATA_RAW)
    try:
        from kaggle.api.kaggle_api_extended import KaggleApi
    except Exception as e:
        log.error("Failed to import kaggle: %s", e)
        log.error("Install with `pip install kaggle` and ensure ~/.kaggle/kaggle.json exists.")
        return 1

    api = KaggleApi()
    api.authenticate()
    api.dataset_download_files(KAGGLE_DATASET, path=str(DATA_RAW), unzip=True, quiet=False)

    csv = find_csv(DATA_RAW)
    if csv is None:
        log.error("Download finished but no CSV was found in %s", DATA_RAW)
        return 1
    log.info("Saved CSV: %s (%.1f MB)", csv, csv.stat().st_size / 1e6)
    return 0


if __name__ == "__main__":
    sys.exit(main())
