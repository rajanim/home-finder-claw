// Supervisor. No LLM call of its own. Stitches FairHousingGuard (input) ->
// IntentDecomposer -> HybridRetriever -> FairHousingGuard (output).
// Collects spans into one trace_id and flushes them at the end.

import { checkFairHousing } from "./guard";
import { decomposeIntent } from "./intent";
import { hybridRetrieve } from "./retrieval";
import {
  endSpan,
  flushTrace,
  startSpan,
  startTrace,
} from "../tracing";
import type { SearchResponse } from "../types";

const REFUSAL_RESPONSE: Pick<SearchResponse, "intent" | "listings" | "aggregations"> = {
  intent: {
    semantic_query: "",
    filters: {},
    geo: null,
    must_have: [],
    nice_to_have: [],
    flagged_phrases: [],
  },
  listings: [],
  aggregations: { by_neighborhood: [], price_histogram: [] },
};

export async function runSearch(query: string): Promise<SearchResponse> {
  const traceId = startTrace();
  const rootSpan = startSpan({
    traceId,
    agent: "Supervisor",
    kind: "supervisor.search",
  });

  try {
    const root = { traceId, parentSpanId: rootSpan.spanId };

    // Pre-check the user input.
    const guardPre = await checkFairHousing(query, root, "input");
    if (!guardPre.ok) {
      endSpan(rootSpan, {
        input: query,
        output: { refused: true, reason: guardPre.reason },
        ok: true,
      });
      await flushTrace(traceId);
      return {
        trace_id: traceId,
        guard_pre: guardPre,
        guard_post: { ok: true },
        ...REFUSAL_RESPONSE,
      };
    }

    // Decompose intent and retrieve.
    const intent = await decomposeIntent(query, root);
    const { listings, aggregations } = await hybridRetrieve(intent, root);

    // Post-check the assistant output. We summarize what we are about to
    // return so the guard can sanity check it. For a search response the
    // surface area is limited so the post-check is mostly a safety net.
    const summary = `Returned ${listings.length} listings filtered to ${
      intent.filters.borough ?? "any borough"
    } at price <= ${intent.filters.price_max ?? "any"}.`;
    const guardPost = await checkFairHousing(summary, root, "output");

    endSpan(rootSpan, {
      input: query,
      output: { hit_count: listings.length, refused: false },
      ok: true,
    });
    await flushTrace(traceId);

    return {
      trace_id: traceId,
      intent,
      guard_pre: guardPre,
      guard_post: guardPost,
      listings,
      aggregations,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    endSpan(rootSpan, { input: query, ok: false, error: message });
    await flushTrace(traceId);
    throw e;
  }
}
