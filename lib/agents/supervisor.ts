// Supervisor. No LLM call of its own. Orchestrates Guard -> Intent ->
// Retrieval -> Guard for search, and a simpler flow for compare. Owns the
// trace_id, snapshots spans into agent_activity for the response, and
// flushes them to traces-v1 in the background.

import { compareListings } from "./comparator";
import { checkFairHousing } from "./guard";
import { decomposeIntent } from "./intent";
import { hybridRetrieve } from "./retrieval";
import { spansToActivity } from "../activity";
import { getOpenSearch, Indexes } from "../opensearch";
import {
  endSpan,
  flushTrace,
  getSpans,
  startSpan,
  startTrace,
} from "../tracing";
import type {
  CompareResponse,
  Listing,
  SearchResponse,
} from "../types";

const REFUSAL_RESPONSE: Pick<
  SearchResponse,
  "intent" | "listings" | "aggregations"
> = {
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

    const guardPre = await checkFairHousing(query, root, "input");
    if (!guardPre.ok) {
      endSpan(rootSpan, {
        input: query,
        output: { refused: true, reason: guardPre.reason },
        ok: true,
      });
      const activity = spansToActivity(getSpans(traceId));
      flushTrace(traceId).catch(() => {});
      return {
        trace_id: traceId,
        guard_pre: guardPre,
        guard_post: { ok: true },
        agent_activity: activity,
        ...REFUSAL_RESPONSE,
      };
    }

    const intent = await decomposeIntent(query, root);
    const { listings, aggregations } = await hybridRetrieve(intent, root);

    const summary = `Returned ${listings.length} listings filtered to ${
      intent.filters.borough ?? "any borough"
    } at price <= ${intent.filters.price_max ?? "any"}.`;
    const guardPost = await checkFairHousing(summary, root, "output");

    endSpan(rootSpan, {
      input: query,
      output: { hit_count: listings.length, refused: false },
      ok: true,
    });

    const activity = spansToActivity(getSpans(traceId));
    flushTrace(traceId).catch(() => {});

    return {
      trace_id: traceId,
      intent,
      guard_pre: guardPre,
      guard_post: guardPost,
      listings,
      aggregations,
      agent_activity: activity,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    endSpan(rootSpan, { input: query, ok: false, error: message });
    flushTrace(traceId).catch(() => {});
    throw e;
  }
}

async function fetchListings(ids: string[]): Promise<Listing[]> {
  const client = getOpenSearch();
  const out: Listing[] = [];
  // mget keeps order; if a doc is missing we skip it.
  const resp = await client.mget({
    index: Indexes.listings,
    body: { ids },
  });
  type MgetResp = { docs?: Array<{ found?: boolean; _source?: Listing }> };
  const body =
    ((resp as unknown as { body?: MgetResp }).body as MgetResp) ??
    (resp as unknown as MgetResp);
  for (const doc of body.docs ?? []) {
    if (doc.found && doc._source) out.push(doc._source);
  }
  return out;
}

export async function runCompare(
  listingIds: string[],
): Promise<CompareResponse> {
  const traceId = startTrace();
  const rootSpan = startSpan({
    traceId,
    agent: "Supervisor",
    kind: "supervisor.compare",
  });

  try {
    const fetchSpan = startSpan({
      traceId,
      parentSpanId: rootSpan.spanId,
      agent: "Comparator.Loader",
      kind: "tool.opensearch",
    });
    let listings: Listing[];
    try {
      listings = await fetchListings(listingIds);
      endSpan(fetchSpan, {
        input: { ids: listingIds.length },
        output: { found: listings.length },
        ok: true,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      endSpan(fetchSpan, { ok: false, error: message });
      throw e;
    }

    if (listings.length < 2) {
      throw new Error(
        `Need at least 2 valid listings to compare. Found ${listings.length}.`,
      );
    }

    const result = await compareListings(listings.slice(0, 4), {
      traceId,
      parentSpanId: rootSpan.spanId,
    });

    endSpan(rootSpan, {
      input: { ids: listingIds },
      output: { compared: listings.length, rows: result.rows.length },
      ok: true,
    });

    const activity = spansToActivity(getSpans(traceId));
    flushTrace(traceId).catch(() => {});

    return {
      trace_id: traceId,
      listings,
      result,
      agent_activity: activity,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    endSpan(rootSpan, { ok: false, error: message });
    flushTrace(traceId).catch(() => {});
    throw e;
  }
}
