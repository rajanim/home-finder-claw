// HybridRetriever. Builds and executes the OpenSearch hybrid query from an
// Intent object. Combines BM25 over description, kNN over text_embedding,
// numeric filters, and an optional geo_distance filter.
//
// Embedding model is NVIDIA NIM nv-embedqa-e5-v5 (1024 dim) called via the
// OpenAI SDK with input_type="query" for asymmetric retrieval.
//
// The landmark/subway lookup table is intentionally small. We only need
// enough coverage for the demo example queries; expanding it is a Phase 7
// task.

import { getNvidia, Models, EMBED_DIM } from "../llm";
import { getOpenSearch, Indexes } from "../opensearch";
import { endSpan, startSpan } from "../tracing";
import type {
  AggBucket,
  Intent,
  Listing,
  SearchAggregations,
} from "../types";

// Lat/lon for the most likely landmark and subway references in demo
// queries. Keys are normalized lowercase tokens. Adding more entries
// improves geo filtering coverage without changing the agent logic.
const LANDMARKS: Record<string, { lat: number; lon: number; label: string }> = {
  "f train": { lat: 40.6661, lon: -73.9803, label: "F train" },
  "l train": { lat: 40.7173, lon: -73.9568, label: "L train" },
  "g train": { lat: 40.6898, lon: -73.9532, label: "G train" },
  "prospect park": { lat: 40.6602, lon: -73.969, label: "Prospect Park" },
  "central park": { lat: 40.7829, lon: -73.9654, label: "Central Park" },
  "washington square park": {
    lat: 40.7308,
    lon: -73.9973,
    label: "Washington Square Park",
  },
  "atlantic terminal": { lat: 40.684, lon: -73.9776, label: "Atlantic Terminal" },
  "atlantic-barclays": { lat: 40.684, lon: -73.9776, label: "Atlantic-Barclays" },
  "barclays center": { lat: 40.6826, lon: -73.9754, label: "Barclays Center" },
  "union square": { lat: 40.7349, lon: -73.9903, label: "Union Square" },
  "times square": { lat: 40.756, lon: -73.987, label: "Times Square" },
  dumbo: { lat: 40.7033, lon: -73.989, label: "DUMBO" },
  "park slope": { lat: 40.6691, lon: -73.9836, label: "Park Slope" },
  williamsburg: { lat: 40.7081, lon: -73.9571, label: "Williamsburg" },
  greenpoint: { lat: 40.7295, lon: -73.9543, label: "Greenpoint" },
  "long island city": { lat: 40.747, lon: -73.9457, label: "Long Island City" },
  astoria: { lat: 40.7644, lon: -73.9235, label: "Astoria" },
  flushing: { lat: 40.7677, lon: -73.833, label: "Flushing" },
};

function lookupGeo(label: string): { lat: number; lon: number } | null {
  if (!label) return null;
  const key = label.toLowerCase().trim();
  if (LANDMARKS[key]) return LANDMARKS[key];
  // Try suffix/prefix matches.
  for (const [k, v] of Object.entries(LANDMARKS)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}

async function embedQuery(
  text: string,
  trace: { traceId: string; parentSpanId: string | null },
): Promise<number[]> {
  const span = startSpan({
    traceId: trace.traceId,
    parentSpanId: trace.parentSpanId,
    agent: "HybridRetriever",
    kind: "llm.embed",
    model: Models.embed,
  });
  try {
    const client = getNvidia();
    const resp = await client.embeddings.create({
      model: Models.embed,
      input: [text],
      // NVIDIA-specific: at search time we are embedding a user query, not
      // a document, so use the "query" type for asymmetric retrieval.
      // Pass via plain extra_body to stay compatible with the OpenAI SDK.
      // @ts-expect-error -- input_type is a NVIDIA-specific extension.
      input_type: "query",
    });
    const vec = resp.data?.[0]?.embedding ?? [];
    if (vec.length !== EMBED_DIM) {
      throw new Error(
        `embedding dimension mismatch: got ${vec.length} expected ${EMBED_DIM}`,
      );
    }
    endSpan(span, {
      input: text,
      output: { dim: vec.length },
      tokens_in: resp.usage?.prompt_tokens,
      ok: true,
    });
    return vec;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    endSpan(span, { input: text, ok: false, error: message });
    throw e;
  }
}

export type RetrievalOutput = {
  listings: Listing[];
  aggregations: SearchAggregations;
};

export async function hybridRetrieve(
  intent: Intent,
  trace: { traceId: string; parentSpanId: string | null },
): Promise<RetrievalOutput> {
  const vec = await embedQuery(intent.semantic_query, trace);

  const filters: Record<string, unknown>[] = [];
  if (intent.filters.price_max !== undefined) {
    filters.push({ range: { price: { lte: intent.filters.price_max } } });
  }
  if (intent.filters.price_min !== undefined) {
    filters.push({ range: { price: { gte: intent.filters.price_min } } });
  }
  if (intent.filters.beds_min !== undefined) {
    filters.push({ range: { beds: { gte: intent.filters.beds_min } } });
  }
  if (intent.filters.baths_min !== undefined) {
    filters.push({ range: { baths: { gte: intent.filters.baths_min } } });
  }
  if (intent.filters.borough) {
    filters.push({ term: { borough: intent.filters.borough } });
  }
  if (intent.filters.property_type) {
    filters.push({ term: { property_type: intent.filters.property_type } });
  }

  if (intent.geo) {
    const point = lookupGeo(intent.geo.landmark_or_subway);
    if (point) {
      filters.push({
        geo_distance: {
          distance: `${intent.geo.radius_m}m`,
          location: { lat: point.lat, lon: point.lon },
        },
      });
    }
  }

  const body: Record<string, unknown> = {
    size: 30,
    query: {
      bool: {
        should: [
          { match: { description: { query: intent.semantic_query, boost: 1.0 } } },
          { knn: { text_embedding: { vector: vec, k: 50, boost: 2.0 } } },
        ],
        filter: filters,
      },
    },
    aggs: {
      by_neighborhood: { terms: { field: "zip", size: 10 } },
      price_histogram: { histogram: { field: "price", interval: 250000 } },
    },
  };

  const span = startSpan({
    traceId: trace.traceId,
    parentSpanId: trace.parentSpanId,
    agent: "HybridRetriever",
    kind: "tool.opensearch",
  });
  try {
    const client = getOpenSearch();
    const resp = await client.search({
      index: Indexes.listings,
      body,
    });
    // opensearch-js wraps responses differently across versions. Normalize.
    const respBody = (resp as unknown as { body?: unknown }).body ?? resp;
    const hits = ((respBody as Record<string, unknown>).hits as Record<string, unknown>) || {};
    const hitArr = (hits.hits as Array<{ _source: Listing; _score: number }>) || [];
    const aggs = ((respBody as Record<string, unknown>).aggregations as Record<
      string,
      { buckets: AggBucket[] }
    >) || {};
    const listings: Listing[] = hitArr.map((h) => h._source);
    const aggregations: SearchAggregations = {
      by_neighborhood: aggs.by_neighborhood?.buckets ?? [],
      price_histogram: aggs.price_histogram?.buckets ?? [],
    };
    endSpan(span, {
      input: { filter_count: filters.length, has_geo: !!intent.geo },
      output: {
        hit_count: listings.length,
        total: ((hits.total as Record<string, unknown> | undefined)?.value as
          | number
          | undefined) ?? listings.length,
      },
      ok: true,
    });
    return { listings, aggregations };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    endSpan(span, { input: body, ok: false, error: message });
    throw e;
  }
}
