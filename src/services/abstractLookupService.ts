import { isTauri } from "@tauri-apps/api/core";
import { fetchScholarlyJson } from "./scholarlyFetch";

type OpenAireValue = { $?: string } | string;

type OpenAireResponse = {
  response?: {
    results?: {
      result?: Array<{
        metadata?: {
          "oaf:entity"?: {
            "oaf:result"?: {
              description?: OpenAireValue | OpenAireValue[];
            };
          };
        };
      }>;
    };
  };
};

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

function cleanAbstract(value?: string): string | undefined {
  const cleaned = value
    ?.replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, String.fromCharCode(34))
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned || undefined;
}

function valueText(value?: OpenAireValue): string | undefined {
  return typeof value === "string" ? value : value?.$;
}

export function parseOpenAireAbstract(data: OpenAireResponse): string | undefined {
  const description = data.response?.results?.result?.[0]?.metadata?.["oaf:entity"]?.["oaf:result"]?.description;
  const values = Array.isArray(description) ? description : [description];
  return values.map(valueText).map(cleanAbstract).find(Boolean);
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
