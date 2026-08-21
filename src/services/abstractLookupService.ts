import { isTauri } from "@tauri-apps/api/core";
import { parseOpenAireAbstract, type OpenAireResponse } from "./openAireService";
import { fetchScholarlyJson } from "./scholarlyFetch";

export { parseOpenAireAbstract } from "./openAireService";

export type AbstractLookupResult = {
  status: "found" | "not-found";
  abstract?: string;
  source?: "OpenAIRE";
};

const lookupCache = new Map<string, Promise<AbstractLookupResult>>();

export function isPlaceholderAbstract(value?: string): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  return !normalized || normalized.startsWith("no abstract") || normalized.includes("abstract was provided");
}

function lookupUrl(doi: string): string {
  const path = `/search/publications?doi=${encodeURIComponent(doi)}&format=json`;
  return isTauri() ? `https://api.openaire.eu${path}` : `/api/openaire${path}`;
}

async function requestAbstract(doi: string): Promise<AbstractLookupResult> {
  const data = await fetchScholarlyJson<OpenAireResponse>(lookupUrl(doi));
  const abstract = parseOpenAireAbstract(data);
  return abstract
    ? { status: "found", abstract, source: "OpenAIRE" }
    : { status: "not-found" };
}

export const abstractLookupService = {
  findByDoi(doi: string): Promise<AbstractLookupResult> {
    const normalized = doi.trim().toLowerCase();
    if (!normalized) return Promise.resolve({ status: "not-found" });
    const cached = lookupCache.get(normalized);
    if (cached) return cached;

    const request = requestAbstract(normalized).catch((error) => {
      lookupCache.delete(normalized);
      throw error;
    });
    lookupCache.set(normalized, request);
    return request;
  },
};
