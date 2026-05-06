// Dual-provider LLM client.
//
// We follow CLAUDE.md constraint #2: the only SDK is the `openai` npm package.
// NVIDIA NIM exposes an OpenAI-compatible REST API at integrate.api.nvidia.com,
// so we use the same SDK with a different baseURL and API key.
//
// Provider routing:
//   - getNvidia()  - default for embeddings and chat (Intent, Retrieval helper,
//                    Researcher, Comparator, FairHousingGuard)
//   - getOpenAI()  - only for the Realtime voice API in Phase 5
//
// Both clients are constructed lazily so a route that only needs one provider
// does not crash because the other key is missing.

import OpenAI from "openai";
import { requireEnv } from "./env";

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

let nvidiaCached: OpenAI | null = null;
let openaiCached: OpenAI | null = null;

export function getNvidia(): OpenAI {
  if (nvidiaCached) return nvidiaCached;
  const { NVIDIA_API_KEY } = requireEnv(["NVIDIA_API_KEY"]);
  nvidiaCached = new OpenAI({
    apiKey: NVIDIA_API_KEY,
    baseURL: NVIDIA_BASE_URL,
  });
  return nvidiaCached;
}

export function getOpenAI(): OpenAI {
  if (openaiCached) return openaiCached;
  const { OPENAI_API_KEY } = requireEnv(["OPENAI_API_KEY"]);
  openaiCached = new OpenAI({ apiKey: OPENAI_API_KEY });
  return openaiCached;
}

// Model identifiers, grouped by which client serves them.
export const Models = {
  // NVIDIA NIM (call via getNvidia())
  default: "meta/llama-3.3-70b-instruct",
  researcher_planner: "meta/llama-3.3-70b-instruct",
  researcher_synth: "meta/llama-3.1-405b-instruct",
  comparator: "meta/llama-3.3-70b-instruct",
  intent: "meta/llama-3.3-70b-instruct",
  guard: "meta/llama-3.3-70b-instruct",
  embed: "nvidia/nv-embedqa-e5-v5",

  // OpenAI direct (call via getOpenAI()) - voice only
  voice: "gpt-4o-realtime-preview",
} as const;

// Embedding dimension matches the chosen NVIDIA model and the OpenSearch
// listings-v1 schema in BUILD_SPEC.md section 5.1.
export const EMBED_DIM = 1024;
