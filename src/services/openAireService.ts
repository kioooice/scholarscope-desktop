import { isTauri } from "@tauri-apps/api/core";
import type { Paper, SearchRequest } from "../types/athena";
import { fetchScholarlyJson } from "./scholarlyFetch";

type JsonRecord = Record<string, unknown>;
export type OpenAireValue = string | number | JsonRecord;

export type OpenAireWork = JsonRecord & {
  pid?: OpenAireValue;
  originalId?: OpenAireValue | OpenAireValue[];
  title?: OpenAireValue | OpenAireValue[];
  description?: OpenAireValue | OpenAireValue[];
  creator?: OpenAireValue | OpenAireValue[];
  relevantdate?: OpenAireValue | OpenAireValue[];
  dateofacceptance?: OpenAireValue | OpenAireValue[];
  publisher?: OpenAireValue | OpenAireValue[];
  journal?: OpenAireValue | OpenAireValue[];
  subject?: OpenAireValue | OpenAireValue[];
  measure?: OpenAireValue | OpenAireValue[];
  bestaccessright?: OpenAireValue;
  children?: JsonRecord;
};

export type OpenAireResult = {
  header?: JsonRecord;
  metadata?: {
    "oaf:entity"?: {
      "oaf:result"?: OpenAireWork;
    };
  };
};

export type OpenAireResponse = {
  response?: {
    results?: {
      result?: OpenAireResult | OpenAireResult[];
    };
  };
};

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function values(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function valueText(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") return String(value);
  const record = asRecord(value);
  const text = record?.["$"];
  return typeof text === "string" || typeof text === "number" ? String(text) : undefined;
}

function cleanText(value?: string): string | undefined {
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

function textValues(value: unknown): string[] {
  return values(value).map(valueText).map(cleanText).filter(Boolean) as string[];
}

export function openAireResults(data: OpenAireResponse): OpenAireResult[] {
  const result = data.response?.results?.result;
  return values(result) as OpenAireResult[];
}

function workFromResult(result: OpenAireResult): OpenAireWork | undefined {
  return result.metadata?.["oaf:entity"]?.["oaf:result"];
}

export function parseOpenAireAbstract(data: OpenAireResponse): string | undefined {
  for (const result of openAireResults(data)) {
    const description = textValues(workFromResult(result)?.description)[0];
    if (description) return description;
  }
  return undefined;
}

function cleanDoi(value: string): string {
  return value
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/[.,;]+$/g, "")
    .trim()
    .toLowerCase();
}

function findDoi(work: OpenAireWork): string | undefined {
  const candidates = [...textValues(work.pid), ...textValues(work.originalId)];
  const doi = candidates.find((value) => /^10\.\d{4,9}\/\S+$/i.test(value));
  return doi ? cleanDoi(doi) : undefined;
}

function findYear(work: OpenAireWork): number | undefined {
  const dates = [...textValues(work.relevantdate), ...textValues(work.dateofacceptance)];
  for (const date of dates) {
    const year = date.match(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/)?.[1];
    if (year) return Number(year);
  }
  return undefined;
}

function findCitationCount(work: OpenAireWork): number {
  for (const measure of values(work.measure)) {
    const record = asRecord(measure);
    if (!record || String(record["@id"] ?? "").toLowerCase() !== "citationcount") continue;
    const count = Number(valueText(record["$"]));
    if (Number.isFinite(count)) return count;
  }
  return 0;
}

function accessClass(work: OpenAireWork): string {
  const access = asRecord(work.bestaccessright);
  return String(access?.["@classid"] ?? access?.["@classname"] ?? "").toLowerCase();
}

function findUrl(value: unknown, depth = 0): string | undefined {
  if (depth > 8 || value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = findUrl(item, depth + 1);
      if (url) return url;
    }
    return undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of ["url", "URL"]) {
    const candidate = valueText(record[key]);
    if (candidate && /^https?:\/\//i.test(candidate)) return candidate;
  }
  for (const child of Object.values(record)) {
    const url = findUrl(child, depth + 1);
    if (url) return url;
  }
  return undefined;
}

function sourceUrl(doi?: string, url?: string): string | undefined {
  return url || (doi ? `https://doi.org/${doi}` : undefined);
}

function mapResult(result: OpenAireResult): Paper | undefined {
  const work = workFromResult(result);
  if (!work) return undefined;
  const title = textValues(work.title)[0];
  if (!title) return undefined;

  const doi = findDoi(work);
  const access = accessClass(work);
  const openAccess = /^(open|oa|gold|green|hybrid|diamond)/i.test(access);
  const openUrl = openAccess ? findUrl(work.children) : undefined;
  const abstract = textValues(work.description)[0] || "No abstract was provided by OpenAIRE for this work.";
  const id = doi
    ? `openaire:${doi}`
    : `openaire:${title.toLowerCase().replace(/\s+/g, "-").slice(0, 80)}`;
  const pdfUrl = openUrl && /\.pdf(?:$|[?#])/i.test(openUrl) ? openUrl : undefined;
  const publisherUrl = sourceUrl(doi, openUrl);

  return {
    id,
    doi,
    title,
    authors: textValues(work.creator).slice(0, 12),
    abstract,
    journal: textValues(work.journal)[0],
    year: findYear(work),
    publisher: textValues(work.publisher)[0],
    citationCount: findCitationCount(work),
    publisherUrl,
    oaUrl: openUrl,
    pdfUrl,
    isOpenAccess: openAccess && Boolean(openUrl),
    sourceProvider: "OpenAIRE",
    concepts: textValues(work.subject).slice(0, 10),
    topics: textValues(work.subject).slice(0, 8),
    keywords: textValues(work.subject).slice(0, 10),
    references: [],
    relatedPapers: [],
  };
}

function providerQuery(request: SearchRequest): string {
  return [request.query, ...request.filters.disciplines]
    .filter(Boolean)
    .join(" ")
    .replace(/[?!.:,;()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function endpoint(): string {
  const path = "/search/publications";
  return isTauri() ? `https://api.openaire.eu${path}` : `/api/openaire${path}`;
}

export const openAireService = {
  async searchWorks(request: SearchRequest): Promise<Paper[]> {
    const params = new URLSearchParams({ format: "json", page: "1", size: "12" });
    if (request.type === "doi") {
      params.set("doi", cleanDoi(request.query));
    } else if (request.type === "title") {
      params.set("title", providerQuery(request));
    } else {
      params.set("keywords", providerQuery(request));
    }

    const data = await fetchScholarlyJson<OpenAireResponse>(`${endpoint()}?${params.toString()}`);
    return openAireResults(data).map(mapResult).filter(Boolean) as Paper[];
  },
};
