export type FetchFn = typeof fetch;

export interface RetryOptions {
  maxAttempts?: number;
  baseMs?: number;
  retryStatuses?: number[];
  timeoutMs?: number;
}

const DEFAULT_RETRY = [429, 529];

export class FetchTimeoutError extends Error {
  constructor(message = "Request timed out") {
    super(message);
  }
}

export async function fetchWithRetry(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  opts: RetryOptions = {},
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const baseMs = opts.baseMs ?? 500;
  const retryStatuses = opts.retryStatuses ?? DEFAULT_RETRY;
  const timeoutMs = opts.timeoutMs;
  let lastRes: Response | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = timeoutMs ? new AbortController() : undefined;
    const timer =
      controller &&
      setTimeout(() => {
        controller.abort();
      }, timeoutMs);

    try {
      const res = await fetchFn(url, {
        ...init,
        signal: controller?.signal,
      });
      if (timer) clearTimeout(timer);
      if (!retryStatuses.includes(res.status) || attempt === maxAttempts - 1) {
        return res;
      }
      lastRes = res;
      const retryAfter = res.headers.get("retry-after");
      let delayMs = baseMs * Math.pow(2, attempt);
      if (retryAfter) {
        const sec = Number(retryAfter);
        if (!Number.isNaN(sec)) delayMs = Math.max(delayMs, sec * 1000);
      }
      await new Promise((r) => setTimeout(r, delayMs));
    } catch (e) {
      if (timer) clearTimeout(timer);
      if (e instanceof Error && e.name === "AbortError") {
        throw new FetchTimeoutError();
      }
      throw e;
    }
  }
  return lastRes!;
}
