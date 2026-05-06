// Shared types used by API routes, agents, and UI components.
//
// The shapes here mirror BUILD_SPEC.md sections 5 (OpenSearch schemas) and
// 7 (agent specifications). Keep them in sync.

export type Borough =
  | "Manhattan"
  | "Brooklyn"
  | "Queens"
  | "Bronx"
  | "Staten Island";

export type Listing = {
  listing_id: string;
  title: string;
  description: string;
  price: number;
  beds: number;
  baths: number;
  house_size_sqft: number | null;
  lot_size_acre: number | null;
  year_built: number | null;
  property_type: string;
  status: string;
  address: string | null;
  city: string;
  borough: Borough;
  zip: string;
  location: { lat: number; lon: number };
  nearest_subway: string;
  subway_distance_m: number;
  school_zone: string | null;
  photos: string[];
  ingested_at: string;
};

export type IntentFilters = {
  price_max?: number;
  price_min?: number;
  beds_min?: number;
  baths_min?: number;
  borough?: Borough;
  property_type?: string;
};

export type IntentGeo = {
  landmark_or_subway: string;
  radius_m: number;
};

export type Intent = {
  semantic_query: string;
  filters: IntentFilters;
  geo: IntentGeo | null;
  must_have: string[];
  nice_to_have: string[];
  flagged_phrases: string[];
};

export type AggBucket = { key: string | number; doc_count: number };

export type SearchAggregations = {
  by_neighborhood: AggBucket[];
  price_histogram: AggBucket[];
};

export type GuardResult = {
  ok: boolean;
  reason?: string;
  redacted?: string;
};

export type SearchResponse = {
  trace_id: string;
  intent: Intent;
  guard_pre: GuardResult;
  guard_post: GuardResult;
  listings: Listing[];
  aggregations: SearchAggregations;
};
