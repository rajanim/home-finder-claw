"""Shared helpers for ingestion scripts.

Reads `.env.local` from the repo root. Provides cached OpenAI and OpenSearch
clients, a small NYC ZIP centroid table, a subway station lookup, and the
haversine distance helper used to compute nearest_subway and subway_distance_m
at ingest time.

Importing this module does not perform any network calls; clients are
constructed lazily on first use.
"""

from __future__ import annotations

import json
import logging
import math
import os
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

from dotenv import load_dotenv

# Repo root = two levels above this file (scripts/ingest/_common.py).
REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_RAW = REPO_ROOT / "data" / "raw"
DATA_PROCESSED = REPO_ROOT / "data" / "processed"

# Load .env.local if present. Scripts and the Next app share the same file.
load_dotenv(REPO_ROOT / ".env.local")

# OpenSearch index names. Mirrored in lib/opensearch.ts on the Next side.
INDEX_LISTINGS = "listings-v1"
INDEX_NEIGHBORHOODS = "neighborhoods-v1"
INDEX_ZHVI = "zhvi-v1"
INDEX_TRACES = "traces-v1"

# NVIDIA NIM embedding model. Mirrored in lib/llm.ts.
# We use the OpenAI SDK with NVIDIA's OpenAI-compatible endpoint
# (integrate.api.nvidia.com/v1). Voice in Phase 5 is the only feature that
# still uses OpenAI directly.
NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"
EMBED_MODEL = "nvidia/nv-embedqa-e5-v5"
EMBED_DIM = 1024


# --------------------------------------------------------------------------
# Logging
# --------------------------------------------------------------------------

def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
        )
        logger.addHandler(handler)
    logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))
    return logger


# --------------------------------------------------------------------------
# Env access
# --------------------------------------------------------------------------

def require_env(*keys: str) -> dict[str, str]:
    missing: list[str] = []
    out: dict[str, str] = {}
    for k in keys:
        v = os.environ.get(k)
        if not v:
            missing.append(k)
        else:
            out[k] = v
    if missing:
        raise SystemExit(
            f"Missing required env vars: {', '.join(missing)}. "
            f"Set them in .env.local at the repo root."
        )
    return out


# --------------------------------------------------------------------------
# OpenSearch client (cached)
# --------------------------------------------------------------------------

@lru_cache(maxsize=1)
def get_opensearch():
    from opensearchpy import OpenSearch
    env = require_env("OPENSEARCH_URL", "OPENSEARCH_USERNAME", "OPENSEARCH_PASSWORD")
    return OpenSearch(
        hosts=[env["OPENSEARCH_URL"]],
        http_auth=(env["OPENSEARCH_USERNAME"], env["OPENSEARCH_PASSWORD"]),
        verify_certs=True,
        timeout=60,
    )


# --------------------------------------------------------------------------
# LLM clients (cached)
#
# We follow CLAUDE.md constraint #2: only the `openai` SDK is used. NVIDIA
# NIM exposes an OpenAI-compatible endpoint, so we keep the same SDK with a
# different baseURL and key. Use get_nvidia() for everything except voice.
# --------------------------------------------------------------------------

@lru_cache(maxsize=1)
def get_nvidia():
    """OpenAI SDK client pointing at NVIDIA NIM. Use for embeddings + chat."""
    from openai import OpenAI
    env = require_env("NVIDIA_API_KEY")
    return OpenAI(api_key=env["NVIDIA_API_KEY"], base_url=NVIDIA_BASE_URL)


@lru_cache(maxsize=1)
def get_openai():
    """OpenAI SDK client pointing at OpenAI direct. Phase 5 voice only."""
    from openai import OpenAI
    env = require_env("OPENAI_API_KEY")
    return OpenAI(api_key=env["OPENAI_API_KEY"])


# --------------------------------------------------------------------------
# Geo helpers
# --------------------------------------------------------------------------

EARTH_RADIUS_M = 6_371_000.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in meters."""
    p = math.pi / 180.0
    a = (
        0.5
        - math.cos((lat2 - lat1) * p) / 2
        + math.cos(lat1 * p) * math.cos(lat2 * p) * (1 - math.cos((lon2 - lon1) * p)) / 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


# --------------------------------------------------------------------------
# NYC ZIP -> borough + centroid (approx)
#
# Curated subset covering the most populated NYC ZIPs. Centroids are
# approximate (good enough for filter-by-borough and rough geo distance).
# Listings without a known ZIP are dropped during cleaning.
# --------------------------------------------------------------------------

# (zip, borough, lat, lon)
NYC_ZIPS: list[tuple[str, str, float, float]] = [
    # Manhattan
    ("10001", "Manhattan", 40.7506, -73.9971),
    ("10002", "Manhattan", 40.7156, -73.9866),
    ("10003", "Manhattan", 40.7322, -73.9892),
    ("10004", "Manhattan", 40.6991, -74.0410),
    ("10005", "Manhattan", 40.7062, -74.0086),
    ("10009", "Manhattan", 40.7264, -73.9785),
    ("10010", "Manhattan", 40.7390, -73.9826),
    ("10011", "Manhattan", 40.7423, -74.0007),
    ("10012", "Manhattan", 40.7256, -73.9982),
    ("10013", "Manhattan", 40.7202, -74.0049),
    ("10014", "Manhattan", 40.7339, -74.0061),
    ("10016", "Manhattan", 40.7457, -73.9783),
    ("10017", "Manhattan", 40.7522, -73.9711),
    ("10019", "Manhattan", 40.7651, -73.9857),
    ("10021", "Manhattan", 40.7690, -73.9588),
    ("10023", "Manhattan", 40.7762, -73.9826),
    ("10024", "Manhattan", 40.7872, -73.9754),
    ("10025", "Manhattan", 40.7989, -73.9682),
    ("10027", "Manhattan", 40.8112, -73.9534),
    ("10028", "Manhattan", 40.7766, -73.9536),
    ("10029", "Manhattan", 40.7920, -73.9444),
    ("10031", "Manhattan", 40.8253, -73.9483),
    ("10036", "Manhattan", 40.7595, -73.9897),
    ("10128", "Manhattan", 40.7818, -73.9509),
    # Brooklyn
    ("11201", "Brooklyn", 40.6936, -73.9911),
    ("11203", "Brooklyn", 40.6494, -73.9356),
    ("11205", "Brooklyn", 40.6948, -73.9663),
    ("11206", "Brooklyn", 40.7019, -73.9430),
    ("11207", "Brooklyn", 40.6700, -73.8946),
    ("11208", "Brooklyn", 40.6713, -73.8758),
    ("11209", "Brooklyn", 40.6225, -74.0303),
    ("11210", "Brooklyn", 40.6275, -73.9476),
    ("11211", "Brooklyn", 40.7128, -73.9534),
    ("11212", "Brooklyn", 40.6634, -73.9135),
    ("11213", "Brooklyn", 40.6700, -73.9352),
    ("11215", "Brooklyn", 40.6691, -73.9836),
    ("11217", "Brooklyn", 40.6822, -73.9778),
    ("11218", "Brooklyn", 40.6437, -73.9764),
    ("11220", "Brooklyn", 40.6411, -74.0150),
    ("11221", "Brooklyn", 40.6913, -73.9276),
    ("11222", "Brooklyn", 40.7282, -73.9492),
    ("11223", "Brooklyn", 40.5987, -73.9743),
    ("11225", "Brooklyn", 40.6630, -73.9560),
    ("11226", "Brooklyn", 40.6469, -73.9560),
    ("11229", "Brooklyn", 40.6010, -73.9436),
    ("11231", "Brooklyn", 40.6783, -74.0014),
    ("11232", "Brooklyn", 40.6549, -74.0028),
    ("11233", "Brooklyn", 40.6765, -73.9216),
    ("11234", "Brooklyn", 40.6177, -73.9249),
    ("11235", "Brooklyn", 40.5867, -73.9526),
    ("11237", "Brooklyn", 40.7030, -73.9213),
    ("11238", "Brooklyn", 40.6800, -73.9637),
    # Queens
    ("11101", "Queens", 40.7459, -73.9374),
    ("11102", "Queens", 40.7717, -73.9244),
    ("11103", "Queens", 40.7615, -73.9128),
    ("11104", "Queens", 40.7449, -73.9197),
    ("11105", "Queens", 40.7794, -73.9075),
    ("11106", "Queens", 40.7613, -73.9326),
    ("11354", "Queens", 40.7691, -73.8254),
    ("11355", "Queens", 40.7506, -73.8226),
    ("11357", "Queens", 40.7858, -73.8146),
    ("11365", "Queens", 40.7383, -73.7956),
    ("11367", "Queens", 40.7331, -73.8245),
    ("11368", "Queens", 40.7494, -73.8624),
    ("11370", "Queens", 40.7634, -73.8898),
    ("11372", "Queens", 40.7517, -73.8839),
    ("11373", "Queens", 40.7400, -73.8784),
    ("11375", "Queens", 40.7224, -73.8462),
    ("11377", "Queens", 40.7437, -73.9039),
    ("11385", "Queens", 40.7019, -73.8848),
    ("11432", "Queens", 40.7137, -73.7937),
    ("11691", "Queens", 40.5996, -73.7611),
    # Bronx
    ("10451", "Bronx", 40.8204, -73.9226),
    ("10452", "Bronx", 40.8378, -73.9213),
    ("10453", "Bronx", 40.8528, -73.9123),
    ("10454", "Bronx", 40.8059, -73.9183),
    ("10455", "Bronx", 40.8147, -73.9067),
    ("10456", "Bronx", 40.8307, -73.9075),
    ("10457", "Bronx", 40.8462, -73.8983),
    ("10458", "Bronx", 40.8634, -73.8889),
    ("10459", "Bronx", 40.8255, -73.8920),
    ("10460", "Bronx", 40.8413, -73.8779),
    ("10461", "Bronx", 40.8470, -73.8400),
    ("10462", "Bronx", 40.8413, -73.8590),
    ("10463", "Bronx", 40.8810, -73.9059),
    ("10465", "Bronx", 40.8243, -73.8232),
    ("10467", "Bronx", 40.8744, -73.8669),
    ("10468", "Bronx", 40.8689, -73.8985),
    ("10469", "Bronx", 40.8693, -73.8482),
    ("10470", "Bronx", 40.8978, -73.8675),
    ("10471", "Bronx", 40.8983, -73.9024),
    ("10472", "Bronx", 40.8295, -73.8688),
    ("10473", "Bronx", 40.8181, -73.8574),
    ("10475", "Bronx", 40.8732, -73.8261),
    # Staten Island
    ("10301", "Staten Island", 40.6342, -74.0944),
    ("10302", "Staten Island", 40.6306, -74.1372),
    ("10304", "Staten Island", 40.6090, -74.0860),
    ("10305", "Staten Island", 40.5953, -74.0739),
    ("10306", "Staten Island", 40.5712, -74.1226),
    ("10308", "Staten Island", 40.5511, -74.1505),
    ("10309", "Staten Island", 40.5314, -74.2173),
    ("10310", "Staten Island", 40.6324, -74.1156),
    ("10312", "Staten Island", 40.5440, -74.1786),
    ("10314", "Staten Island", 40.5953, -74.1502),
]

ZIP_TO_BOROUGH: dict[str, str] = {z: b for z, b, _, _ in NYC_ZIPS}
ZIP_TO_LATLON: dict[str, tuple[float, float]] = {z: (lat, lon) for z, _, lat, lon in NYC_ZIPS}


def borough_for_zip(zip_code: str | None) -> str | None:
    if not zip_code:
        return None
    return ZIP_TO_BOROUGH.get(str(zip_code).strip().split("-")[0])


def centroid_for_zip(zip_code: str | None) -> tuple[float, float] | None:
    if not zip_code:
        return None
    return ZIP_TO_LATLON.get(str(zip_code).strip().split("-")[0])


# --------------------------------------------------------------------------
# Subway stations (curated subset, lat/lng)
#
# Used to compute nearest_subway + subway_distance_m for each listing.
# Covers the major lines and all 5 boroughs. ~40 stations is enough to
# produce a meaningful "near the F train" type query for the demo.
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class SubwayStation:
    name: str
    lines: tuple[str, ...]
    lat: float
    lon: float


SUBWAY_STATIONS: list[SubwayStation] = [
    # Manhattan
    SubwayStation("Times Sq-42 St", ("1", "2", "3", "7", "N", "Q", "R", "W", "S"), 40.7560, -73.9870),
    SubwayStation("Grand Central-42 St", ("4", "5", "6", "7", "S"), 40.7527, -73.9772),
    SubwayStation("Union Sq-14 St", ("4", "5", "6", "L", "N", "Q", "R", "W"), 40.7349, -73.9903),
    SubwayStation("14 St-6 Av", ("F", "M", "1", "2", "3"), 40.7382, -73.9966),
    SubwayStation("W 4 St-Wash Sq", ("A", "C", "E", "B", "D", "F", "M"), 40.7323, -74.0007),
    SubwayStation("Canal St", ("J", "N", "Q", "R", "W", "Z", "6"), 40.7184, -74.0021),
    SubwayStation("Fulton St", ("A", "C", "J", "Z", "2", "3", "4", "5"), 40.7102, -74.0094),
    SubwayStation("59 St-Columbus Circle", ("A", "B", "C", "D", "1"), 40.7681, -73.9819),
    SubwayStation("86 St", ("4", "5", "6"), 40.7793, -73.9555),
    SubwayStation("96 St", ("1", "2", "3"), 40.7940, -73.9720),
    SubwayStation("125 St", ("4", "5", "6"), 40.8045, -73.9374),
    SubwayStation("Harlem-148 St", ("3",), 40.8280, -73.9398),
    # Brooklyn
    SubwayStation("Atlantic Av-Barclays Ctr", ("B", "D", "N", "Q", "R", "2", "3", "4", "5"), 40.6840, -73.9776),
    SubwayStation("Jay St-MetroTech", ("A", "C", "F", "R"), 40.6926, -73.9874),
    SubwayStation("Borough Hall", ("4", "5", "2", "3", "R"), 40.6929, -73.9903),
    SubwayStation("Bedford Av", ("L",), 40.7173, -73.9568),
    SubwayStation("Lorimer St", ("L", "G"), 40.7140, -73.9505),
    SubwayStation("Bedford-Nostrand Avs", ("G",), 40.6898, -73.9532),
    SubwayStation("DeKalb Av", ("B", "D", "N", "Q", "R"), 40.6904, -73.9818),
    SubwayStation("7 Av (F)", ("F", "G"), 40.6661, -73.9803),
    SubwayStation("Prospect Park", ("B", "Q", "S"), 40.6618, -73.9620),
    SubwayStation("Coney Island-Stillwell Av", ("D", "F", "N", "Q"), 40.5774, -73.9813),
    SubwayStation("Broadway Junction", ("A", "C", "J", "Z", "L"), 40.6788, -73.9050),
    SubwayStation("High St", ("A", "C"), 40.6993, -73.9905),
    # Queens
    SubwayStation("Long Island City-Court Sq", ("E", "M", "7", "G"), 40.7470, -73.9457),
    SubwayStation("Queensboro Plaza", ("7", "N", "W"), 40.7508, -73.9402),
    SubwayStation("Astoria Blvd", ("N", "W"), 40.7700, -73.9176),
    SubwayStation("Forest Hills-71 Av", ("E", "F", "M", "R"), 40.7215, -73.8444),
    SubwayStation("Flushing-Main St", ("7",), 40.7596, -73.8301),
    SubwayStation("Jamaica Center-Parsons/Archer", ("E", "J", "Z"), 40.7022, -73.8009),
    # Bronx
    SubwayStation("Yankee Stadium-161 St", ("4", "B", "D"), 40.8276, -73.9259),
    SubwayStation("Fordham Rd", ("4",), 40.8617, -73.9009),
    SubwayStation("Pelham Bay Park", ("6",), 40.8527, -73.8281),
    SubwayStation("Tremont Av", ("B", "D"), 40.8504, -73.9050),
    SubwayStation("Kingsbridge Rd", ("4", "B", "D"), 40.8636, -73.9020),
    # Staten Island (not subway proper, but the SI Railway station hub)
    SubwayStation("St George (SIR)", ("SIR",), 40.6437, -74.0731),
]


def nearest_subway(lat: float, lon: float) -> tuple[SubwayStation, float]:
    """Return (station, distance_meters)."""
    best: tuple[SubwayStation, float] | None = None
    for s in SUBWAY_STATIONS:
        d = haversine_m(lat, lon, s.lat, s.lon)
        if best is None or d < best[1]:
            best = (s, d)
    assert best is not None
    return best


# --------------------------------------------------------------------------
# JSONL helpers
# --------------------------------------------------------------------------

def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with path.open("w") as f:
        for row in rows:
            f.write(json.dumps(row, separators=(",", ":")) + "\n")
            n += 1
    return n


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open() as f:
        return [json.loads(line) for line in f if line.strip()]
