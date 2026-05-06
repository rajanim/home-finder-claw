"""06_index_opensearch.py

Create the `listings-v1` index with the schema from BUILD_SPEC section 5.1
and bulk-load the embedded listings into it.

By default this script drops and recreates the index. Pass `--no-reset`
to skip the drop step and rely on idempotent updates.

Reads:  data/processed/listings.embedded.jsonl
Writes: OpenSearch index `listings-v1`

Run from the repo root:
    python scripts/ingest/06_index_opensearch.py [--no-reset]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from opensearchpy.helpers import bulk
from tqdm import tqdm

from _common import (
    DATA_PROCESSED,
    EMBED_DIM,
    INDEX_LISTINGS,
    get_logger,
    get_opensearch,
    read_jsonl,
)

log = get_logger("06_index_opensearch")

INPUT = DATA_PROCESSED / "listings.embedded.jsonl"

LISTINGS_MAPPING: dict = {
    "settings": {
        "index": {
            "number_of_shards": 1,
            "number_of_replicas": 0,
            "knn": True,
        }
    },
    "mappings": {
        "properties": {
            "listing_id": {"type": "keyword"},
            "title": {"type": "text"},
            "description": {"type": "text"},
            "price": {"type": "integer"},
            "beds": {"type": "integer"},
            "baths": {"type": "float"},
            "house_size_sqft": {"type": "integer"},
            "lot_size_acre": {"type": "float"},
            "year_built": {"type": "integer"},
            "property_type": {"type": "keyword"},
            "status": {"type": "keyword"},
            "address": {"type": "text"},
            "city": {"type": "keyword"},
            "borough": {"type": "keyword"},
            "zip": {"type": "keyword"},
            "location": {"type": "geo_point"},
            "nearest_subway": {"type": "keyword"},
            "subway_distance_m": {"type": "integer"},
            "school_zone": {"type": "keyword"},
            "photos": {"type": "keyword"},
            "text_embedding": {
                "type": "knn_vector",
                "dimension": EMBED_DIM,
                "method": {
                    "name": "hnsw",
                    "space_type": "cosinesimil",
                    "engine": "lucene",
                },
            },
            "image_embedding": {
                "type": "knn_vector",
                "dimension": 512,
                "method": {
                    "name": "hnsw",
                    "space_type": "cosinesimil",
                    "engine": "lucene",
                },
            },
            "ingested_at": {"type": "date"},
        }
    },
}

BULK_BATCH = 500


def listing_to_doc(listing: dict) -> dict:
    """Strip null knn vectors so OpenSearch does not reject the document."""
    doc = dict(listing)
    if doc.get("image_embedding") is None:
        doc.pop("image_embedding", None)
    if doc.get("text_embedding") is None:
        doc.pop("text_embedding", None)
    return doc


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--no-reset",
        action="store_true",
        help="Do not drop and recreate the index before loading.",
    )
    args = parser.parse_args()

    if not INPUT.exists():
        log.error("Missing %s. Run 04_embed_text.py first.", INPUT)
        return 1

    client = get_opensearch()

    if not args.no_reset:
        if client.indices.exists(index=INDEX_LISTINGS):
            log.info("Dropping existing index %s", INDEX_LISTINGS)
            client.indices.delete(index=INDEX_LISTINGS)
        log.info("Creating index %s", INDEX_LISTINGS)
        client.indices.create(index=INDEX_LISTINGS, body=LISTINGS_MAPPING)
    else:
        if not client.indices.exists(index=INDEX_LISTINGS):
            log.info("Creating index %s (does not exist)", INDEX_LISTINGS)
            client.indices.create(index=INDEX_LISTINGS, body=LISTINGS_MAPPING)

    listings = read_jsonl(INPUT)
    log.info("Bulk loading %d listings into %s", len(listings), INDEX_LISTINGS)

    def actions():
        for l in listings:
            yield {
                "_index": INDEX_LISTINGS,
                "_id": l["listing_id"],
                "_source": listing_to_doc(l),
            }

    success, errors = bulk(
        client,
        actions(),
        chunk_size=BULK_BATCH,
        request_timeout=120,
        raise_on_error=False,
    )
    log.info("Bulk indexed: %d, errors: %d", success, len(errors) if isinstance(errors, list) else errors)
    if isinstance(errors, list) and errors:
        for err in errors[:3]:
            log.error("  example error: %s", err)

    client.indices.refresh(index=INDEX_LISTINGS)
    count = client.count(index=INDEX_LISTINGS)["count"]
    log.info("Index %s now contains %d documents", INDEX_LISTINGS, count)
    return 0 if count == len(listings) else 1


if __name__ == "__main__":
    sys.exit(main())
