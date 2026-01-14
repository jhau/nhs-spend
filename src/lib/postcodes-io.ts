export type PostcodesIoResult = {
  postcode: string;
  quality?: number;
  longitude: number | null;
  latitude: number | null;
  country: string | null;
  region: string | null;
};

type BulkLookupResponse = {
  status: number;
  result: Array<{
    query: string;
    result: {
      postcode: string;
      quality?: number;
      longitude: number | null;
      latitude: number | null;
      country: string | null;
      region?: string | null;
    } | null;
  }>;
};

export type PostcodesIoBulkLookupOptions = {
  /**
   * postcodes.io supports up to 100 postcodes per request.
   */
  batchDelayMs?: number;
  /**
   * Retries on 429 and transient 5xx.
   */
  maxRetries?: number;
  /**
   * Base delay for backoff (ms).
   */
  backoffBaseMs?: number;
  /**
   * Optional AbortSignal for cancellation.
   */
  signal?: AbortSignal;
};

export const POSTCODES_IO_BULK_LIMIT = 100;

export function normalizeUkPostcode(input: string): string {
  return input.toUpperCase().replace(/\s+/g, " ").trim();
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (!signal) return;
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("Aborted"));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function envNumber(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function getPostcodesIoDefaults(): Required<
  Pick<PostcodesIoBulkLookupOptions, "batchDelayMs" | "maxRetries" | "backoffBaseMs">
> {
  return {
    batchDelayMs: envNumber("POSTCODES_IO_BATCH_DELAY_MS", 300),
    maxRetries: envNumber("POSTCODES_IO_MAX_RETRIES", 3),
    backoffBaseMs: envNumber("POSTCODES_IO_BACKOFF_BASE_MS", 500),
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: Required<Pick<PostcodesIoBulkLookupOptions, "maxRetries" | "backoffBaseMs">> & {
    signal?: AbortSignal;
  }
): Promise<Response> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt++;
    let resp;
    try {
      resp = await fetch(url, { ...init, signal: opts.signal });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (attempt > opts.maxRetries) {
        throw new Error(`Fetch failed for URL ${url} after ${attempt} attempts: ${error.message}`);
      }
      const backoffMs = opts.backoffBaseMs * Math.pow(2, attempt - 1);
      await sleep(backoffMs, opts.signal);
      continue;
    }

    if (resp.ok) return resp;

    if (!isRetryableStatus(resp.status) || attempt > opts.maxRetries) {
      return resp;
    }

    const retryAfterHeader = resp.headers.get("retry-after");
    const retryAfterMs =
      retryAfterHeader && /^\d+$/.test(retryAfterHeader)
        ? Number(retryAfterHeader) * 1000
        : null;
    const backoffMs =
      retryAfterMs ??
      Math.min(30_000, opts.backoffBaseMs * Math.pow(2, attempt - 1));

    await sleep(backoffMs, opts.signal);
  }
}

export async function bulkLookupPostcodes(
  postcodes: string[],
  options: PostcodesIoBulkLookupOptions = {}
): Promise<Map<string, PostcodesIoResult>> {
  const normalized = postcodes
    .map(normalizeUkPostcode)
    .filter((p) => p.length > 0);

  const unique = Array.from(new Set(normalized));
  if (unique.length > POSTCODES_IO_BULK_LIMIT) {
    throw new Error(
      `postcodes.io bulk lookup supports max ${POSTCODES_IO_BULK_LIMIT} postcodes per request (got ${unique.length})`
    );
  }

  const defaults = getPostcodesIoDefaults();
  const maxRetries = options.maxRetries ?? defaults.maxRetries;
  const backoffBaseMs = options.backoffBaseMs ?? defaults.backoffBaseMs;

  const resp = await fetchWithRetry(
    "https://api.postcodes.io/postcodes",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postcodes: unique }),
    },
    { maxRetries, backoffBaseMs, signal: options.signal }
  );

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(
      `postcodes.io bulk lookup failed: ${resp.status} ${resp.statusText}${
        body ? ` - ${body.substring(0, 300)}` : ""
      }`
    );
  }

  const data = (await resp.json()) as BulkLookupResponse;
  const out = new Map<string, PostcodesIoResult>();
  for (const item of data.result) {
    const key = normalizeUkPostcode(item.query);
    const r = item.result;
    if (!r) continue;
    out.set(key, {
      postcode: normalizeUkPostcode(r.postcode),
      quality: r.quality,
      longitude: r.longitude ?? null,
      latitude: r.latitude ?? null,
      country: r.country ?? null,
      region: (r.region ?? null) as string | null,
    });
  }

  const delayMs = options.batchDelayMs ?? defaults.batchDelayMs;
  if (delayMs > 0) {
    await sleep(delayMs, options.signal);
  }

  return out;
}


