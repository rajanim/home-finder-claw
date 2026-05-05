// Centralized env access. Every server module that needs a secret reads it
// through requireEnv so missing config fails loudly with a single, readable error.

export type EnvKey =
  | "OPENAI_API_KEY"
  | "OPENSEARCH_URL"
  | "OPENSEARCH_USERNAME"
  | "OPENSEARCH_PASSWORD"
  | "NEXT_PUBLIC_MAPBOX_TOKEN"
  | "REPLICATE_API_TOKEN"
  | "UNSPLASH_ACCESS_KEY"
  | "NEXT_PUBLIC_APP_URL";

export class MissingEnvError extends Error {
  constructor(public readonly keys: EnvKey[]) {
    super(
      `Missing required environment variables: ${keys.join(", ")}. ` +
        `Set them in .env.local for development or in the Vercel project settings for production.`,
    );
    this.name = "MissingEnvError";
  }
}

export function readEnv(key: EnvKey): string | undefined {
  const value = process.env[key];
  if (value === undefined || value === "") return undefined;
  return value;
}

export function requireEnv(keys: EnvKey[]): Record<EnvKey, string> {
  const missing: EnvKey[] = [];
  const out: Partial<Record<EnvKey, string>> = {};
  for (const key of keys) {
    const value = readEnv(key);
    if (value === undefined) {
      missing.push(key);
    } else {
      out[key] = value;
    }
  }
  if (missing.length > 0) throw new MissingEnvError(missing);
  return out as Record<EnvKey, string>;
}

export function envPresence(keys: EnvKey[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of keys) out[key] = readEnv(key) !== undefined;
  return out;
}
