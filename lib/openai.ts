// OpenAI client. Constructed lazily so module-load does not crash routes
// that do not actually use the client.
//
// Direct openai SDK only. No LangChain, no LlamaIndex, no AI SDK wrapper.

import OpenAI from "openai";
import { requireEnv } from "./env";

let cached: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (cached) return cached;
  const { OPENAI_API_KEY } = requireEnv(["OPENAI_API_KEY"]);
  cached = new OpenAI({ apiKey: OPENAI_API_KEY });
  return cached;
}

export const Models = {
  default: "gpt-4o-mini",
  researcher: "gpt-4o",
  voice: "gpt-4o-realtime-preview",
  embed: "text-embedding-3-small",
} as const;
