/**
 * Thin HTTP client for the public PSX data portal (dps.psx.com.pk).
 *
 * There is no official public API, so this reads the same pages a browser
 * would. Keep concurrency low and cache aggressively — we are a guest on
 * someone else's server.
 */

export const PSX_BASE = "https://dps.psx.com.pk";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36";

type CacheEntry = { body: string; expiresAt: number };
const cache = new Map<string, CacheEntry>();

export class PsxError extends Error {
  constructor(
    message: string,
    readonly path: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PsxError";
  }
}

export interface FetchOptions {
  /** Cache lifetime in ms. 0 disables caching. */
  ttlMs?: number;
  timeoutMs?: number;
  retries?: number;
  /** Form-encoded body. Present => POST. */
  form?: Record<string, string>;
  /** Referer header; some PSX fragment endpoints expect one. */
  referer?: string;
}

/** GET a PSX path and return the raw body, with retry + in-memory caching. */
export async function psxFetch(
  path: string,
  {
    ttlMs = 60_000,
    timeoutMs = 20_000,
    retries = 2,
    form,
    referer,
  }: FetchOptions = {},
): Promise<string> {
  const url = path.startsWith("http") ? path : `${PSX_BASE}${path}`;
  const body = form ? new URLSearchParams(form).toString() : undefined;

  // The body is part of the identity of a POST, so key the cache on it too.
  const cacheKey = body ? `${url}|${body}` : url;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.body;

  let lastError: unknown;
  let lastStatus: number | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: body ? "POST" : "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/json,*/*",
          "Accept-Language": "en-US,en;q=0.9",
          ...(body
            ? {
                "Content-Type": "application/x-www-form-urlencoded",
                "X-Requested-With": "XMLHttpRequest",
              }
            : {}),
          ...(referer ? { Referer: referer } : {}),
        },
        body,
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) {
        throw new PsxError(`PSX returned ${res.status}`, path, res.status);
      }
      const text = await res.text();
      if (ttlMs > 0)
        cache.set(cacheKey, { body: text, expiresAt: Date.now() + ttlMs });
      return text;
    } catch (err) {
      lastError = err;
      if (err instanceof PsxError && err.status != null) lastStatus = err.status;

      // PSX returns a hard 500 for paths that simply do not exist (company
      // pages for ex-dividend and non-compliant counters). Retrying those
      // just triples the cost of a known-dead request.
      if (lastStatus === 500) break;

      // Exponential backoff; the portal rate-limits bursts.
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // Carry the HTTP status through the wrapper so callers can distinguish a
  // permanently missing page from a transient network failure.
  throw new PsxError(
    `Failed to fetch ${path}: ${String(lastError)}`,
    path,
    lastStatus,
  );
}

/** GET and parse JSON from a PSX endpoint. */
export async function psxFetchJson<T>(
  path: string,
  options?: FetchOptions,
): Promise<T> {
  const body = await psxFetch(path, options);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new PsxError("Response was not valid JSON", path);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run tasks with bounded concurrency. The portal is comfortable with a handful
 * of parallel requests but will start refusing under a 30-way fan-out.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

export function clearPsxCache() {
  cache.clear();
}
