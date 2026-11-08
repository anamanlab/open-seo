import { isHostedAuthMode } from "@/lib/auth-mode";

let workersEnvPromise: Promise<Record<string, unknown> | null> | null = null;

// Per-isolate cache for resolved Secrets Store values. Successful values are
// cached for 5 minutes; failures are never cached so a transient Cloudflare
// error can recover on the next call.
const SECRET_CACHE_TTL_MS = 5 * 60 * 1000;
const secretCache = new Map<
  string,
  { value: string | undefined; expiresAt: number }
>();

/** Test helper: clear the per-isolate secret cache. */
export function _resetSecretCache(): void {
  secretCache.clear();
}

export async function getOptionalEnvValue(
  name: string,
): Promise<string | undefined> {
  const processValue =
    typeof process !== "undefined" ? process.env?.[name] : undefined;
  if (processValue) {
    return processValue;
  }

  const cached = secretCache.get(name);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const env = (await getWorkersEnv()) ?? {};
  const binding: unknown = Reflect.get(env, name);

  let resolved: string | undefined;
  let getFailed = false;
  if (typeof binding === "string") {
    resolved = binding !== "" ? binding : undefined;
  } else if (isSecretsStoreBinding(binding)) {
    try {
      const value = await binding.get();
      resolved = typeof value === "string" && value !== "" ? value : undefined;
    } catch {
      resolved = undefined;
      getFailed = true;
    }
  }

  // Cache only successful resolutions. A failed get() leaves the entry
  // absent so the next call retries.
  if (isSecretsStoreBinding(binding) && !getFailed) {
    secretCache.set(name, {
      value: resolved,
      expiresAt: Date.now() + SECRET_CACHE_TTL_MS,
    });
  }

  return resolved;
}

function isSecretsStoreBinding(
  value: unknown,
): value is { get: () => Promise<string> } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { get?: unknown }).get === "function"
  );
}

/**
 * Sync variant for callers that already hold an env record (e.g. a Durable
 * Object's `this.env`, needed because Think's `getModel()` hook is sync).
 * Same policy as the async form: process.env first (where local `.env.local`
 * secrets land in dev), skipping empty strings, then the given env.
 *
 * Note: sync callers cannot resolve a Secrets Store binding (its `get()` is
 * async). They receive `undefined` for such bindings; use the async form
 * whenever possible.
 */
export function getEnvValueSync(
  // `object` so interface-typed envs (e.g. Cloudflare.Env) are accepted
  // without a cast.
  env: object,
  name: string,
): string | undefined {
  const processValue =
    typeof process !== "undefined" ? process.env?.[name] : undefined;
  if (processValue) {
    return processValue;
  }
  const value: unknown = Reflect.get(env, name);
  if (typeof value === "string") {
    return value !== "" ? value : undefined;
  }
  // Secrets Store bindings are not resolvable synchronously.
  return undefined;
}

export async function getRequiredEnvValue(name: string): Promise<string> {
  const value = await getOptionalEnvValue(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function isHostedServerAuthMode(): Promise<boolean> {
  return isHostedAuthMode(await getOptionalEnvValue("AUTH_MODE"));
}

async function getWorkersEnv(): Promise<Record<string, unknown> | null> {
  if (!workersEnvPromise) {
    workersEnvPromise = loadWorkersEnv();
  }
  return workersEnvPromise;
}

async function loadWorkersEnv(): Promise<Record<string, unknown> | null> {
  try {
    const workersModule = await import("cloudflare:workers");
    return isRecord(workersModule.env) ? workersModule.env : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
