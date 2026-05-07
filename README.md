# Home Finder Claw

Multi-agent, voice-enabled real estate search for New York City. Six agents under a supervisor pattern, hybrid OpenSearch retrieval (BM25 + 1024-dim kNN + geo + filters), Fair Housing guardrails, streaming neighborhood briefs, and a live trace and eval dashboard. Built primarily on **NVIDIA NIM** (Llama 3.3 70B and Llama 3.1 405B) with **OpenAI Realtime** for voice. Deployed on Vercel.

**Live demo:** https://home-finder-claw.vercel.app
**Eval dashboard:** https://home-finder-claw.vercel.app/eval

## What it does

- **Search.** Type or speak a query like "two bed near the F train under 1.2M with good light." A FairHousingGuard checks the input. An IntentDecomposer parses it into structured filters and a semantic query. A HybridRetriever embeds the semantic query and runs a single OpenSearch hybrid query (BM25 over description + kNN over text embeddings + numeric and geo filters). Results render on a Mapbox map with cards alongside.
- **Research.** Click the Research button on any listing. A planner picks data sources from a fixed list, four fetchers run in parallel against `neighborhoods-v1` and `zhvi-v1`, and a synthesizer streams a 5-bullet brief back via Server-Sent Events. Numbers cited come straight from the fetcher outputs (no fabrication).
- **Compare.** Select 2 to 4 listings. The Comparator agent (Llama 3.3 70B) returns a feature table plus a tradeoffs paragraph in JSON.
- **Voice.** Tap the mic. WebRTC connects directly to the OpenAI Realtime API using a server-minted ephemeral token. Tool calls (`search_listings`, `get_neighborhood_brief`) round-trip through the same Next.js API routes. Spoken results plus visual cards.
- **Fair Housing guard.** Runs on every user input and every assistant output. Refuses or rewrites content that implies preferences based on protected classes.
- **Tracing and eval.** Every LLM call and every tool call writes a span to OpenSearch `traces-v1`. The `/eval` page shows per-agent p50 / p95 latency, total spans, recent traces with waterfall timelines, and a runnable 30-query labeled eval set across five categories (filter accuracy, semantic match, geo, guard, researcher quality).

## Architecture

```
                          Browser
                            │
                            │  HTTP / WebRTC
                            ▼
                  Next.js App Router on Vercel
                            │
        ┌───────────────────┼─────────────────────────┐
        │                   │                         │
   /api/search          /api/research            /api/voice/session
   /api/compare         /api/research/quick      (mints ephemeral key
   /api/eval/stats                                for OpenAI Realtime)
   /api/trace/[id]
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│  Supervisor                                                   │
│   ├─ FairHousingGuard (pre)   nvidia/llama-3.3-70b           │
│   ├─ IntentDecomposer          nvidia/llama-3.3-70b           │
│   ├─ HybridRetriever           nvidia/nv-embedqa-e5-v5 1024d  │
│   │   └─ OpenSearch (BM25 + kNN + filters + geo + aggs)       │
│   ├─ NeighborhoodResearcher                                   │
│   │   ├─ Planner               nvidia/llama-3.3-70b           │
│   │   ├─ Fetchers (parallel)   getZhvi getComplaints          │
│   │   │                        getSchools getTransit          │
│   │   └─ Synthesizer           nvidia/llama-3.1-405b stream   │
│   ├─ Comparator                nvidia/llama-3.3-70b           │
│   └─ FairHousingGuard (post)   nvidia/llama-3.3-70b           │
│                                                               │
│  VoiceAgent  openai/gpt-4o-realtime-preview (Realtime, WebRTC)│
│                                                               │
│  Tracing  -> OpenSearch traces-v1 (every span, every call)    │
└──────────────────────────────────────────────────────────────┘

OpenSearch indexes (Bonsai.io Sandbox in the demo, ~15 MB):
  listings-v1        500 NYC listings, text embeddings, photos, geo points
  neighborhoods-v1   104 NYC ZIPs with 311 complaint counts and median price
  zhvi-v1            31,701 monthly Zillow Home Value points
  traces-v1          one document per agent span
```

## Why NVIDIA NIM as the primary provider

The CLAUDE.md constraint is **OpenAI SDK only**, not OpenAI as the provider. NVIDIA NIM exposes an OpenAI-compatible REST API at `https://integrate.api.nvidia.com/v1`, so we use the same `openai` npm package with a `baseURL` override for embeddings and chat. OpenAI direct is used only for the Realtime voice API, which has no NVIDIA equivalent today.

Practical implications:
- The whole search and research pipeline runs on NVIDIA-hosted Llama 3.3 70B and 1.0-billion-parameter retrieval embeddings, with NVIDIA's free credits covering the demo period
- One env-var change (`OPENAI_BASE_URL` or, in our code, swapping `getNvidia()` for `getOpenAI()`) flips any individual agent back to OpenAI direct if NVIDIA is unavailable
- Migration to a self-hosted NIM container is a one-line baseURL swap

See `lib/llm.ts` for the dual-client setup.

## Demo script (90 seconds)

1. Open https://home-finder-claw.vercel.app
2. Type **"two bed near the F train under 1.2M with good light"**. Point out:
   - The **Agent activity** panel: 5 steps in order (guard.input, intent, embed, opensearch, guard.output) with model, latency, token count per step
   - The intent chips: `Brooklyn`, `2+ bed`, `<= $1200k`, `near F train (800 m)`
   - The map with markers
3. Click **Research** on any card. The detail page streams a 5-bullet brief in ~3 seconds. The "Sources" disclosure shows what the fetchers returned (ZHVI trend, 311 complaints, transit).
4. Back to search. Pick 2 to 3 listings with the **Compare** toggle. Click the floating **Compare N listings** pill. The drawer slides in with a feature table, a tradeoffs paragraph (Llama 3.3 70B), and another agent activity timeline.
5. Click the mic. Say **"find me a two bed in Park Slope under 1.5M."** The model speaks the result count and tops; cards refresh on the page in parallel.
6. Type **"find me a neighborhood with mostly young white families."** The Fair Housing guard refuses with a plain-language reason. No listings returned.
7. Open `/eval`. Show per-agent p50 / p95 latency, the recent-traces waterfall view, and click **Run eval set** for the 30-query pass-rate proof.

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 App Router, React 19 |
| Styling | Tailwind CSS v4, shadcn/ui base-nova preset, Zillow-style royal blue theme |
| LLM (chat) | NVIDIA NIM `meta/llama-3.3-70b-instruct` (default), `meta/llama-3.1-405b-instruct` (Researcher synthesizer) |
| LLM (voice) | OpenAI `gpt-4o-realtime-preview` |
| Embeddings | NVIDIA NIM `nvidia/nv-embedqa-e5-v5` (1024 dim, retrieval-tuned) |
| Vector + search | OpenSearch 2.19 (Bonsai.io Sandbox) |
| Map | Mapbox GL JS |
| Photos | Unsplash API, attached at ingest time |
| Tracing | Custom OpenSearch index `traces-v1` |
| Hosting | Vercel |

## Quickstart for forks

```bash
git clone https://github.com/rajanim/home-finder-claw
cd home-finder-claw
npm install
cp .env.example .env.local
# fill in NVIDIA_API_KEY, OPENSEARCH_URL/USERNAME/PASSWORD,
# NEXT_PUBLIC_MAPBOX_TOKEN (pk.* not sk.*), UNSPLASH_ACCESS_KEY
# OPENAI_API_KEY is optional, only needed for voice mode

# verify your providers respond
node scripts/smoke/check-providers.mjs

# bring up Python venv for ingestion
cd scripts/ingest
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd ../..

# manually download the Kaggle CSV from
# https://www.kaggle.com/datasets/ahmedshahriarsakib/usa-real-estate-dataset
# and unzip into data/raw/

# run the pipeline (~6 minutes, mostly NYC 311 throttling in step 07)
python scripts/ingest/02_clean_listings.py
python scripts/ingest/03_attach_photos.py
python scripts/ingest/04_embed_text.py
python scripts/ingest/06_index_opensearch.py
python scripts/ingest/07_load_neighborhood_data.py

# run locally
npm run dev
```

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Frajanim%2Fhome-finder-claw&env=NVIDIA_API_KEY,OPENSEARCH_URL,OPENSEARCH_USERNAME,OPENSEARCH_PASSWORD,NEXT_PUBLIC_MAPBOX_TOKEN,UNSPLASH_ACCESS_KEY&envDescription=NVIDIA%20NIM%20handles%20chat%20and%20embeddings.%20OPENAI_API_KEY%20is%20optional%20and%20only%20needed%20for%20voice.%20Mapbox%20token%20must%20start%20with%20pk.&project-name=home-finder-claw&repository-name=home-finder-claw)

After the import, add the env vars in Vercel project settings. Production URL stays public; preview deploys are gated behind Vercel Authentication's Standard Protection by default (you can change that under Settings → Deployment Protection).

## Scaling up

Sample size is currently 500 listings to fit Bonsai's free Sandbox tier (125 MB). To scale up:

1. Upgrade Bonsai to **Standard Sprout** (~$10/mo, 1 GB)
2. Edit `SAMPLE_SIZE = 500` in `scripts/ingest/02_clean_listings.py` to 5000 or 20000
3. Re-run `02_clean_listings.py` → `03_attach_photos.py` → `04_embed_text.py` → `06_index_opensearch.py`. The script drops and recreates the index by default

NVIDIA embedding cost remains free at any of these sizes within the build.nvidia.com credit allowance.

## Costs (approximate, demo period)

- NVIDIA NIM (chat + embeddings): covered by free build.nvidia.com credits
- OpenAI Realtime (voice testing): a few dollars per hour of conversation
- OpenSearch on Bonsai Sandbox: free
- Mapbox, Unsplash, Vercel: free at demo volumes
- Total demo cost in NYC: under $20 if you keep voice testing short

## What is out of scope

- User authentication, saved searches, favorites, accounts (the demo is anonymous)
- Real-time MLS feed; data is a static Kaggle snapshot from 2022
- Mobile native app; responsive web only
- Image embeddings (Replicate CLIP); deferred. Search quality on text-only embeddings is sufficient for the demo
- Crime data; intentionally omitted to avoid demographic correlations

## Project layout

```
home-finder-claw/
├── CLAUDE.md                  # operating rules
├── BUILD_SPEC.md              # full build specification
├── README.md                  # this file
├── app/
│   ├── page.tsx               # search home with Map, Compare, Voice
│   ├── listing/[id]/page.tsx  # detail page with streaming brief
│   ├── eval/page.tsx          # eval dashboard
│   └── api/
│       ├── search/route.ts        # POST: agentic search
│       ├── compare/route.ts       # POST: comparator
│       ├── research/route.ts      # GET: SSE streaming brief
│       ├── research/quick/route.ts# POST: fast brief for voice
│       ├── voice/session/route.ts # POST: ephemeral Realtime key
│       ├── eval/stats/route.ts    # GET: per-agent latency aggs
│       ├── trace/[id]/route.ts    # GET: spans for one trace
│       └── health/route.ts        # GET: env presence
├── lib/
│   ├── env.ts                 # typed required-env helper
│   ├── llm.ts                 # getNvidia() and getOpenAI() factories
│   ├── opensearch.ts          # OpenSearch client + index names
│   ├── tracing.ts             # span helpers + traces-v1 flush
│   ├── activity.ts            # span -> AgentActivity translator
│   ├── types.ts               # shared types
│   ├── eval/scoring.ts        # per-category eval scorers
│   └── agents/
│       ├── supervisor.ts      # orchestrator
│       ├── intent.ts          # IntentDecomposer
│       ├── retrieval.ts       # HybridRetriever
│       ├── researcher.ts      # planner + fetchers + synthesizer
│       ├── comparator.ts      # Comparator
│       └── guard.ts           # FairHousingGuard
├── components/
│   ├── SearchBar.tsx
│   ├── ListingCard.tsx
│   ├── ListingMap.tsx
│   ├── PhotoCarousel.tsx
│   ├── ResearchPanel.tsx      # SSE EventSource subscriber
│   ├── CompareDrawer.tsx
│   ├── VoiceButton.tsx        # WebRTC + tool-call orchestration
│   ├── AgentActivity.tsx      # collapsible reasoning timeline
│   ├── TraceTimeline.tsx      # waterfall view of one trace
│   └── EvalRunner.tsx
├── scripts/
│   ├── smoke/check-providers.mjs  # NVIDIA + OpenAI connectivity test
│   └── ingest/                # Python 3.11 ingestion pipeline
└── tests/
    └── eval-set.json          # 30 labeled queries
```

## License

Demo project. Listings data from a public Kaggle snapshot. Neighborhood data from NYC Open Data and Zillow Research. Photos from Unsplash with attribution. Not for production real estate use.
