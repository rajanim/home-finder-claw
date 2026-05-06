# Ingestion pipeline

Python scripts that pull NYC real estate data, attach photos, generate
embeddings, and load OpenSearch. Run once, locally, before serving traffic.
Not part of the Vercel deployment.

## Prerequisites

- Python 3.11 or newer (3.12 and 3.13 are fine)
- An OpenSearch cluster reachable from your machine (Bonsai.io Sandbox is
  enough for the 500-listing demo; upgrade to Sprout for a larger sample)
- An NVIDIA API key from https://build.nvidia.com (free credits cover the demo)
- A Kaggle account with API token (`~/.kaggle/kaggle.json`), or download the
  CSV manually and skip script 01
- An Unsplash developer access key
- Roughly 500 MB of free disk for the raw CSV and processed JSONL

## One-time setup

From the repo root:

```bash
cd scripts/ingest
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Then make sure `.env.local` at the repo root contains:

```
NVIDIA_API_KEY=nvapi-...
OPENSEARCH_URL=https://your-cluster.us-east-1.bonsaisearch.net
OPENSEARCH_USERNAME=...
OPENSEARCH_PASSWORD=...
UNSPLASH_ACCESS_KEY=...
```

Kaggle credentials live in `~/.kaggle/kaggle.json`, not `.env.local`.
`OPENAI_API_KEY` is only required for Phase 5 voice and is not needed here.

## Run order

Each script is idempotent and can be re-run safely. They write to
`data/raw/` (downloaded inputs) and `data/processed/` (cleaned outputs),
both gitignored.

```bash
# from repo root, with venv activated
python scripts/ingest/01_fetch_data.py            # Kaggle download
python scripts/ingest/02_clean_listings.py        # filter + normalize, sample 500
python scripts/ingest/03_attach_photos.py         # Unsplash photos
python scripts/ingest/04_embed_text.py            # NVIDIA text embeddings (1024 dim)
python scripts/ingest/06_index_opensearch.py      # create index, bulk load
python scripts/ingest/07_load_neighborhood_data.py  # 311, ZHVI
```

`05_embed_images.py` is intentionally not in this set. Image embeddings
(Replicate CLIP, 512 dim) are deferred to Phase 2 or later. Search quality
on text-only embeddings is sufficient for the demo.

## Tuning

- Sample size: edit `SAMPLE_SIZE` at the top of `02_clean_listings.py`.
  Default 500 (Bonsai Sandbox-friendly). Bump to 5000 or 20000 after
  upgrading Bonsai to Standard Sprout. Embedding cost on NVIDIA is covered
  by free credits at any of these sizes.
- Random seed: `SAMPLE_SEED` is fixed so the same listings are picked on
  every run. Change it if you want a different sample.

## Verifying

After `06_index_opensearch.py` finishes:

```bash
# count
curl -u "$OPENSEARCH_USERNAME:$OPENSEARCH_PASSWORD" \
  "$OPENSEARCH_URL/listings-v1/_count"

# sample query
curl -u "$OPENSEARCH_USERNAME:$OPENSEARCH_PASSWORD" \
  -H 'Content-Type: application/json' \
  "$OPENSEARCH_URL/listings-v1/_search?pretty&size=3" \
  -d '{"query": {"bool": {"filter": [
    {"term": {"borough": "Brooklyn"}},
    {"range": {"price": {"lte": 1000000}}}
  ]}}}'
```

Expected: count near `SAMPLE_SIZE` (500 by default) with photo URLs that resolve to 200.

## Costs (rough, for a 500-listing Sandbox run)

- NVIDIA embeddings: covered by free credits at build.nvidia.com
- Unsplash: free, ~20 unique queries (well under the 50/hour developer cap)
- Bonsai Sandbox: free
- Kaggle: free
