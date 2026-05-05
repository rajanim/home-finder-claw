# Home Finder Claw

Multi-agent, voice-enabled real estate search demo for New York City. Built to showcase Principal-level Agentic AI engineering for the Zillow interview.

Six agents, OpenSearch hybrid retrieval, OpenAI Realtime voice, Fair Housing guardrail, full tracing and eval. Deployed on Vercel.

## How to Use These Docs

Drop both files into the root of your `home-finder-claw` repo, then point Cursor or Claude Code at them.

- `CLAUDE.md` is the operating rules file. Cursor reads this on every action. Claude Code reads it as project context.
- `BUILD_SPEC.md` is the full build specification. Sectioned, executable, top to bottom.

## How to Start in Cursor or Claude Code

1. Create the repo: `mkdir home-finder-claw && cd home-finder-claw && git init`
2. Drop `CLAUDE.md` and `BUILD_SPEC.md` into the root.
3. Open in VS Code with Cursor or Claude Code extension.
4. First prompt to the AI: 

   > Read CLAUDE.md and BUILD_SPEC.md fully. Confirm you understand the constraints and architecture. Then propose Phase 0 as a checklist of files you will create. Wait for my approval before writing any code.

5. After Phase 0 deploys to Vercel and works, prompt:

   > Proceed with Phase 1 data ingestion. Before writing code, list the exact CSV files you will download and the OpenSearch index commands you will run.

6. Continue phase by phase.

## What This Demo Proves to Zillow

| JD requirement | Where it shows up in this build |
|---|---|
| Multi-agent collaboration | Six named agents under a Supervisor pattern |
| Multimodal | Text + image embeddings, photo carousel, Mapbox map |
| Voice AI mode | OpenAI Realtime API with WebRTC, tool calls |
| Deep Research mode | Planner-fetcher-synthesizer Researcher agent |
| Evaluation frameworks | Eval set of 30 labeled queries, dashboard, pass rate |
| Tracing systems | Custom OpenSearch traces index, span timeline UI |
| Safety guardrails | Fair Housing pre-and-post check on every turn |
| Production deployment | Live Vercel URL anyone can use |

## Build Time Estimate

- Eight days at 2 to 4 hours per day
- Or one focused weekend for a smaller version (see BUILD_SPEC Section 17)

## Costs (approximate, for the demo period)

- OpenAI: budget 30 to 60 USD across all phases including ingestion embeddings, search and research calls, voice testing
- OpenSearch (Bonsai sandbox or AWS OpenSearch Serverless): 0 to 30 USD per month depending on provider
- Mapbox, Unsplash: free at demo volumes
- Vercel: free Hobby plan is sufficient
- Replicate (image embeddings, one-time): a few dollars

Total demo cost: under 100 USD if you are careful with the Researcher gpt-4o calls.

## License

Demo project. Data is from public Kaggle and NYC Open Data sources. Photos are from Unsplash with attribution. No production use.
