// OpenSearch client. Constructed lazily. Auth credentials live in separate env
// vars so the password does not leak into URL logs.

import { Client } from "@opensearch-project/opensearch";
import { requireEnv } from "./env";

let cached: Client | null = null;

export function getOpenSearch(): Client {
  if (cached) return cached;
  const { OPENSEARCH_URL, OPENSEARCH_USERNAME, OPENSEARCH_PASSWORD } = requireEnv([
    "OPENSEARCH_URL",
    "OPENSEARCH_USERNAME",
    "OPENSEARCH_PASSWORD",
  ]);
  cached = new Client({
    node: OPENSEARCH_URL,
    auth: { username: OPENSEARCH_USERNAME, password: OPENSEARCH_PASSWORD },
  });
  return cached;
}

export const Indexes = {
  listings: "listings-v1",
  neighborhoods: "neighborhoods-v1",
  zhvi: "zhvi-v1",
  traces: "traces-v1",
} as const;
