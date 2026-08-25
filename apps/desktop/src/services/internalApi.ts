import { isTauri } from "@tauri-apps/api/core";

const DESKTOP_API_BASE = "http://127.0.0.1:5181";
const STARTUP_RETRY_WINDOW_MS = 12_000;
const STARTUP_RETRY_DELAY_MS = 300;

type StartupRetryOptions = {
  startupTimeoutMs?: number;
  retryDelayMs?: number;
};

export function internalApiUrl(path: string): string {
  return isTauri() ? `${DESKTOP_API_BASE}${path}` : path;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function abortedError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error("下载引擎请求已取消");
}

// The Tauri window can become interactive before the bundled Node process has
// bound its local port. Retry only that short desktop startup window.
export async function fetchInternalApi(
  path: string,
  init: RequestInit = {},
  options: StartupRetryOptions = {},
): Promise<Response> {
  const url = internalApiUrl(path);
  if (!isTauri()) return fetch(url, init);

  const startupTimeoutMs = options.startupTimeoutMs ?? STARTUP_RETRY_WINDOW_MS;
  const retryDelayMs = options.retryDelayMs ?? STARTUP_RETRY_DELAY_MS;
  const deadline = Date.now() + startupTimeoutMs;
  let unavailableResponse: Response | undefined;
  let lastError: unknown;

  while (true) {
    if (init.signal?.aborted) throw abortedError(init.signal);
    try {
      const response = await fetch(url, init);
      if (response.status !== 503) return response;
      unavailableResponse = response;
    } catch (error) {
      if (init.signal?.aborted) throw abortedError(init.signal);
      lastError = error;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      if (unavailableResponse) return unavailableResponse;
      throw lastError instanceof Error ? lastError : new Error("内部下载引擎未能启动");
    }
    await wait(Math.min(retryDelayMs, remainingMs));
  }
}
