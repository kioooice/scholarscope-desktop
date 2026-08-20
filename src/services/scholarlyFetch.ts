import { invoke } from "@tauri-apps/api/core";

type ScholarlyHeader = {
  name: string;
  value: string;
};

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 2;

function directFetch(url: string, headers?: ScholarlyHeader[]): Promise<string> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(url, {
    headers: headers?.length ? Object.fromEntries(headers.map((header) => [header.name, header.value])) : undefined,
    signal: controller.signal,
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Provider request failed: ${response.status}`);
    return response.text();
  }).finally(() => window.clearTimeout(timer));
}

function retryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /429|500|502|503|504|network|fetch|abort|timeout/i.test(error.message);
}

export async function fetchScholarlyText(url: string, headers?: ScholarlyHeader[]): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await invoke<string>("agent_fetch_scholarly_text", { url, headers });
    } catch {
      try {
        return await directFetch(url, headers);
      } catch (error) {
        lastError = error;
        if (!retryable(error) || attempt === MAX_ATTEMPTS - 1) throw error;
        await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Provider request failed");
}

export async function fetchScholarlyJson<T>(url: string, headers?: ScholarlyHeader[]): Promise<T> {
  return JSON.parse(await fetchScholarlyText(url, headers)) as T;
}
