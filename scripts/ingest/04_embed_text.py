"""04_embed_text.py

Embed each listing's synthesized text card with `text-embedding-3-small`
and write the resulting 1536-dim vectors back to JSONL.

The card string mirrors the text used at query time so the cosine geometry
stays consistent. See spec section 5.1.

Reads:  data/processed/listings.with_photos.jsonl
Writes: data/processed/listings.embedded.jsonl

Run from the repo root:
    python scripts/ingest/04_embed_text.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from tqdm import tqdm

from _common import (
    DATA_PROCESSED,
    EMBED_DIM,
    EMBED_MODEL,
    get_logger,
    get_openai,
    read_jsonl,
    write_jsonl,
)

log = get_logger("04_embed_text")

INPUT = DATA_PROCESSED / "listings.with_photos.jsonl"
OUTPUT = DATA_PROCESSED / "listings.embedded.jsonl"

BATCH_SIZE = 100  # OpenAI accepts up to 2048 inputs per call; 100 keeps memory low


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

    client = get_openai()

    texts = [card_text(l) for l in listings]
    vectors: list[list[float]] = []

    for start in tqdm(range(0, len(texts), BATCH_SIZE), desc="embed"):
        batch = texts[start : start + BATCH_SIZE]
        resp = client.embeddings.create(model=EMBED_MODEL, input=batch)
        for item in resp.data:
            vectors.append(item.embedding)

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
