"""04_embed_text.py

Embed each listing's synthesized text card with NVIDIA NIM
`nvidia/nv-embedqa-e5-v5` (1024 dim) and write vectors back to JSONL.

The card string mirrors the text used at query time so the cosine geometry
stays consistent. See spec section 5.1.

NVIDIA's nv-embedqa-e5-v5 supports asymmetric retrieval via input_type:
  - "passage" for documents at index time (this script)
  - "query"   for user queries at runtime (used by the search API)

Reads:  data/processed/listings.with_photos.jsonl
Writes: data/processed/listings.embedded.jsonl

Run from the repo root:
    python scripts/ingest/04_embed_text.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

from tqdm import tqdm

from _common import (
    DATA_PROCESSED,
    EMBED_DIM,
    EMBED_MODEL,
    get_logger,
    get_nvidia,
    read_jsonl,
    write_jsonl,
)

log = get_logger("04_embed_text")

INPUT = DATA_PROCESSED / "listings.with_photos.jsonl"
OUTPUT = DATA_PROCESSED / "listings.embedded.jsonl"

# NVIDIA nv-embedqa-e5-v5 accepts up to 96 inputs per call. We use 64
# to leave headroom while still cutting API call count vs 32. At 20k
# listings that is ~313 calls instead of 625.
BATCH_SIZE = 64
# Retry settings for transient 429 / 502 / 503 from NVIDIA NIM.
MAX_RETRIES = 4
INITIAL_BACKOFF_S = 1.0


def embed_with_retry(client, batch: list[str]) -> list[list[float]]:
    backoff = INITIAL_BACKOFF_S
    for attempt in range(MAX_RETRIES + 1):
        try:
            resp = client.embeddings.create(
                model=EMBED_MODEL,
                input=batch,
                extra_body={"input_type": "passage"},
            )
            return [item.embedding for item in resp.data]
        except Exception as e:
            status = getattr(e, "status_code", None) or getattr(e, "status", None)
            msg = str(e)
            retryable = (
                status in (429, 502, 503)
                or "429" in msg
                or "502" in msg
                or "503" in msg
                or "timeout" in msg.lower()
            )
            if attempt >= MAX_RETRIES or not retryable:
                raise
            log.warning(
                "Embedding batch retry %d/%d after %.1fs: %s",
                attempt + 1,
                MAX_RETRIES,
                backoff,
                msg[:120],
            )
            time.sleep(backoff)
            backoff *= 2


def card_text(listing: dict) -> str:
    """Synthesize the listing card string for embedding.

    Format: "{beds} bed {baths} bath {property_type} in {borough}, near
    {nearest_subway}. {description}"
    """
    bed_label = "studio" if listing["beds"] == 0 else f"{listing['beds']} bed"
    return (
        f"{bed_label} {listing['baths']} bath {listing['property_type']} "
        f"in {listing['borough']}, near {listing['nearest_subway']}. "
        f"{listing['description']}"
    )


def main() -> int:
    if not INPUT.exists():
        log.error("Missing %s. Run 03_attach_photos.py first.", INPUT)
        return 1

    listings = read_jsonl(INPUT)
    log.info("Embedding %d listings with %s", len(listings), EMBED_MODEL)

    client = get_nvidia()

    texts = [card_text(l) for l in listings]
    vectors: list[list[float]] = []

    for start in tqdm(range(0, len(texts), BATCH_SIZE), desc="embed"):
        batch = texts[start : start + BATCH_SIZE]
        batch_vectors = embed_with_retry(client, batch)
        vectors.extend(batch_vectors)

    if len(vectors) != len(listings):
        log.error("Vector count %d != listing count %d", len(vectors), len(listings))
        return 1
    if vectors and len(vectors[0]) != EMBED_DIM:
        log.error("Unexpected embedding dimension: %d (want %d)", len(vectors[0]), EMBED_DIM)
        return 1

    for listing, vec in zip(listings, vectors):
        listing["text_embedding"] = vec

    n = write_jsonl(OUTPUT, listings)
    log.info("Wrote %d embedded listings to %s", n, OUTPUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
