# CLAUDE.md - Home Finder Claw Operating Rules

You are helping Rajani Maski build **Home Finder Claw**, a multi-agent, AI-powered, voice-enabled real estate search application that demonstrates Principal-level Agentic AI engineering for a Zillow interview.

Read this file before every action. Read `BUILD_SPEC.md` for the full architecture and task breakdown.

## Identity

- Repo name: `home-finder-claw`
- Owner: Rajani Maski (GitHub: rajanim)
- Goal: A live demo URL on Vercel that the Zillow hiring team can click and use within five minutes.

## Hard Constraints (non-negotiable)

1. **Frontend**: Next.js (App Router, currently 16.x) with TypeScript and React 19. Tailwind CSS v4 (CSS-based config in `app/globals.css`, no `tailwind.config.ts`). shadcn/ui for components. (Note: this overrides the standing Streamlit preference because the deployment target is Vercel and Streamlit does not host on Vercel.)
2. **LLM access**: OpenAI SDK only. No LangChain, no LlamaIndex, no Vercel AI SDK abstractions over the OpenAI client. Direct `openai` npm package calls only.
3. **Vector store and search**: OpenSearch. No Pinecone, no Chroma, no pgvector substitution. Use AWS OpenSearch Serverless or Bonsai.io. Hybrid queries (BM25 + kNN + filters + aggregations) all go through one OpenSearch cluster.
4. **Voice**: OpenAI Realtime API via WebRTC, ephemeral key minted server-side.
5. **Data ingestion**: Python 3.11 scripts in `scripts/ingest/`. Read CSV, generate embeddings, push to OpenSearch. One-time job, not part of the Vercel runtime.
6. **No fabricated metrics.** Do not write phrases like "10x faster" or "99.9% accuracy" anywhere. If a metric is not measured, do not write it.
7. **Writing style for all UI copy, README, comments, and docs**:
   - Do not use apostrophes in contractions. Write "do not", "we will", "it is".
   - Do not use em dashes or en dashes in prose. Use commas, periods, or parentheses.
   - Plain, direct sentences.

## What This App Is

A real estate search app for New York City that lets a user type or speak a natural-language query like "two bed near the F train under 1.2M with good light" and returns ranked listings, a neighborhood deep-research brief, and a comparison view. Six named agents collaborate behind a supervisor pattern. Every agent call is traced. A Fair Housing guardrail wraps every response.

## Six-Agent Layout

1. **IntentDecomposer** - parses user query into structured filters and a semantic query
2. **HybridRetriever** - issues OpenSearch hybrid query (BM25 + kNN + geo + numeric)
3. **NeighborhoodResearcher** - planner-fetcher-synthesizer over 311, schools, transit, ZHVI
4. **Comparator** - side-by-side tradeoffs across top N results
5. **VoiceAgent** - Realtime API session manager, routes intents to the supervisor
6. **FairHousingGuard** - pre-and-post-check on every user input and assistant output

A `Supervisor` orchestrates them. See `BUILD_SPEC.md` Section 8 for prompts and tool definitions.

## Working Style

- **Plan, then build.** Before writing code for a new module, write a 5-line plan in chat. Get approval. Then write the code.
- **Small commits.** One feature per commit. Commit messages explain why.
- **Test what you ship.** Every API route gets a happy-path curl example in its file header. Every agent gets a fixture-based unit test.
- **Trace everything.** Every LLM call and every tool call gets logged to an OpenSearch index `traces-v1` with: trace_id, agent_name, parent_span_id, latency_ms, tokens_in, tokens_out, input, output. The eval dashboard reads from this index.
- **Fail loud, fail safe.** If the OpenAI key is missing or OpenSearch is unreachable, return a clear error to the UI. Never fabricate listings.

## What "Done" Means

- A user can visit `home-finder-claw.vercel.app`, type a query, see ranked listings on a map, click one, and see a neighborhood brief generated live.
- Voice mode works in Chrome and Safari.
- The eval page at `/eval` shows trace counts, p50/p95 latency per agent, and a 30-query labeled eval pass rate.
- The Fair Housing guard catches at least the five test queries listed in the eval set.
- README has a one-click Deploy-to-Vercel button and a 90-second demo GIF.

## What Is Out of Scope

- User authentication. The demo is anonymous.
- Saved searches, favorites, user profiles.
- Real-time MLS feed. The data is a static snapshot.
- Mobile app. Responsive web only.
- Payments, mortgages, agent matching.

## Stack Reference Card

| Concern | Choice |
|---|---|
| Framework | Next.js 16 App Router (React 19) |
| Language | TypeScript (app), Python 3.11 (ingestion) |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Map | Mapbox GL JS |
| LLM | OpenAI gpt-4o-mini (default), gpt-4o (Researcher), gpt-4o-realtime-preview (voice) |
| Embeddings (text) | OpenAI text-embedding-3-small (1536 dim) |
| Embeddings (images) | Replicate CLIP ViT-B/32 (512 dim) via REST |
| Vector + search | OpenSearch (Bonsai.io or AWS OpenSearch Serverless) |
| Tracing | Custom OpenSearch index `traces-v1` |
| Hosting | Vercel |
| Photos | Unsplash API (curated real estate photos) |

## Project Structure

```
home-finder-claw/
├── CLAUDE.md                  # This file
├── BUILD_SPEC.md              # Full spec
├── README.md                  # Public-facing
├── .env.example
├── package.json
├── tsconfig.json
├── postcss.config.mjs        # Tailwind 4 plugin
├── next.config.ts
├── app/                       # Next.js App Router
│   ├── layout.tsx
│   ├── page.tsx               # Home / search
│   ├── listing/[id]/page.tsx
│   ├── eval/page.tsx
│   └── api/
│       ├── search/route.ts
│       ├── research/route.ts
│       ├── compare/route.ts
│       ├── voice/session/route.ts
│       └── trace/route.ts
├── lib/
│   ├── openai.ts              # OpenAI client
│   ├── opensearch.ts          # OpenSearch client
│   ├── tracing.ts             # span helpers
│   ├── guard.ts               # Fair Housing guard
│   └── agents/
│       ├── supervisor.ts
│       ├── intent.ts
│       ├── retrieval.ts
│       ├── researcher.ts
│       ├── comparator.ts
│       └── voice.ts
├── components/
│   ├── SearchBar.tsx
│   ├── ListingCard.tsx
│   ├── ListingMap.tsx
│   ├── VoiceButton.tsx
│   ├── ResearchPanel.tsx
│   ├── CompareDrawer.tsx
│   └── TraceTimeline.tsx
├── scripts/
│   └── ingest/
│       ├── 01_fetch_data.py
│       ├── 02_clean_listings.py
│       ├── 03_attach_photos.py
│       ├── 04_embed_text.py
│       ├── 05_embed_images.py
│       ├── 06_index_opensearch.py
│       └── 07_load_neighborhood_data.py
├── data/                      # gitignored
│   ├── raw/
│   └── processed/
└── tests/
    ├── eval-set.json          # 30 labeled queries
    └── agents/
```

## When You Are Stuck

If a step is ambiguous, do not guess. Stop and ask one specific question. Better to pause for ten seconds than to write the wrong thing for an hour.
