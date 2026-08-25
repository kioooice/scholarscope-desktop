import { invoke, isTauri } from "@tauri-apps/api/core";

type ScholarlyHeader = {
  name: string;
  value: string;
};

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 2;

function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  return new Error("Provider request failed");
}

function directFetch(url: string, headers?: ScholarlyHeader[]): Promise<string> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(url, {
    headers: headers?.length ? Object.fromEntries(headers.map((header) => [header.name, header.value])) : undefined,
    signal: controller.signal,
  }).then(async (response) => {
    if (!response.ok) {
      const detail = (await response.text()).replace(/\s+/g, " ").trim().slice(0, 240);
      throw new Error(`Provider request failed: ${response.status}${detail ? `; ${detail}` : ""}`);
    }
    return response.text();
  }).finally(() => globalThis.clearTimeout(timer));
}

function retryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /429|500|502|503|504|network|fetch|abort|timeout/i.test(error.message);
}

export async function fetchScholarlyText(url: string, headers?: ScholarlyHeader[]): Promise<string> {
  let lastError = new Error("Provider request failed");
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return isTauri()
        ? await invoke<string>("agent_fetch_scholarly_text", { url, headers })
        : await directFetch(url, headers);
    } catch (error) {
      lastError = asError(error);
      if (!retryable(lastError) || attempt === MAX_ATTEMPTS - 1) throw lastError;
      await new Promise((resolve) => globalThis.setTimeout(resolve, 1_000 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function fetchScholarlyJson<T>(url: string, headers?: ScholarlyHeader[]): Promise<T> {
  return JSON.parse(await fetchScholarlyText(url, headers)) as T;
}
