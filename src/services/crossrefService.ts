import type { Paper, SearchRequest } from "../types/athena";
import { loadProviderSettings } from "./providerSettingsService";
import { fetchScholarlyJson } from "./scholarlyFetch";

type CrossrefDate = {
  "date-parts"?: number[][];
};

type CrossrefAuthor = {
  given?: string;
  family?: string;
  name?: string;
};

type CrossrefLink = {
  URL?: string;
  "content-type"?: string;
};

type CrossrefWork = {
  DOI?: string;
  URL?: string;
  title?: string[];
  author?: CrossrefAuthor[];
  abstract?: string;
  publisher?: string;
  "container-title"?: string[];
  subject?: string[];
  "published-print"?: CrossrefDate;
  "published-online"?: CrossrefDate;
  published?: CrossrefDate;
  created?: CrossrefDate;
  "is-referenced-by-count"?: number;
  link?: CrossrefLink[];
  license?: Array<{ URL?: string }>;
  reference?: Array<{ DOI?: string; article_title?: string }>;
};

type CrossrefResponse = {
  message?: {
    items?: CrossrefWork[];
  };
};

const CROSSREF_BASE = "https://api.crossref.org/works";

function stripTags(value?: string): string {
  return value?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "No abstract was provided by Crossref for this work.";
}

function yearFromDate(date?: CrossrefDate): number | undefined {
  return date?.["date-parts"]?.[0]?.[0];
}

function authorName(author: CrossrefAuthor): string | undefined {
  const name = [author.given, author.family].filter(Boolean).join(" ").trim();
  return name || author.name;
}

function buildFilter(request: SearchRequest): string | undefined {
  const filters: string[] = [];
  if (request.filters.minYear) filters.push(`from-pub-date:${request.filters.minYear}-01-01`);
  if (request.filters.maxYear) filters.push(`until-pub-date:${request.filters.maxYear}-12-31`);
  return filters.length ? filters.join(",") : undefined;
}

function providerQuery(request: SearchRequest): string {
  return [request.query, ...request.filters.disciplines].filter(Boolean).join(" ").replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
}

function mapWork(work: CrossrefWork): Paper {
  const doi = work.DOI?.trim();
  const title = work.title?.find(Boolean) || "Untitled Crossref work";
  const subjects = work.subject?.filter(Boolean).slice(0, 8) ?? [];
  const year = yearFromDate(work["published-print"]) ?? yearFromDate(work["published-online"]) ?? yearFromDate(work.published) ?? yearFromDate(work.created);
  const pdfUrl = work.link?.find((link) => link["content-type"]?.toLowerCase().includes("pdf"))?.URL;
  const hasOpenLicense = work.license?.some((license) => /creativecommons\.org|publicdomain/i.test(license.URL ?? "")) ?? false;
  const isOpenAccess = Boolean(pdfUrl && hasOpenLicense);

  return {
    id: doi ? `crossref:${doi.toLowerCase()}` : `crossref:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80)}`,
    doi,
    title,
    authors: work.author?.map(authorName).filter(Boolean) as string[] ?? [],
    abstract: stripTags(work.abstract),
    journal: work["container-title"]?.find(Boolean),
    year,
    publisher: work.publisher,
    citationCount: work["is-referenced-by-count"] ?? 0,
    publisherUrl: work.URL,
    oaUrl: isOpenAccess ? pdfUrl : undefined,
    pdfUrl,
    isOpenAccess,
    sourceProvider: "Crossref",
    concepts: subjects,
    topics: subjects,
    keywords: subjects,
    references: work.reference?.map((reference) => reference.DOI || reference.article_title).filter(Boolean).slice(0, 8) as string[] ?? [],
    relatedPapers: [],
  };
}

export const crossrefService = {
  async searchWorks(request: SearchRequest): Promise<Paper[]> {
    const params = new URLSearchParams({
      rows: "12",
      sort: "relevance",
      "query.bibliographic": providerQuery(request),
    });
    const { crossrefEmail } = loadProviderSettings();
    if (crossrefEmail.trim()) params.set("mailto", crossrefEmail.trim());
    const filter = buildFilter(request);
    if (filter) params.set("filter", filter);

    const data = await fetchScholarlyJson<CrossrefResponse>(`${CROSSREF_BASE}?${params.toString()}`);
    return (data.message?.items ?? []).map(mapWork);
  },
};
