import type { Paper, SearchRequest } from "../types/athena";
import { loadProviderSettings } from "./providerSettingsService";
import { fetchScholarlyJson } from "./scholarlyFetch";

type SemanticAuthor = {
  name?: string;
};

type SemanticPaper = {
  paperId?: string;
  title?: string;
  abstract?: string;
  year?: number;
  authors?: SemanticAuthor[];
  venue?: string;
  citationCount?: number;
  referenceCount?: number;
  url?: string;
  externalIds?: {
    DOI?: string;
    ArXiv?: string;
    PubMed?: string;
  };
  openAccessPdf?: {
    url?: string;
  };
  fieldsOfStudy?: string[];
  s2FieldsOfStudy?: Array<{ category?: string }>;
  publicationTypes?: string[];
};

type SemanticSearchResponse = {
  data?: SemanticPaper[];
};

const SEMANTIC_PAPER_BASE = "https://api.semanticscholar.org/graph/v1/paper";
const SEMANTIC_SEARCH_BASE = `${SEMANTIC_PAPER_BASE}/search`;
const FIELDS = [
  "title",
  "abstract",
  "year",
  "authors",
  "venue",
  "citationCount",
  "referenceCount",
  "url",
  "externalIds",
  "openAccessPdf",
  "fieldsOfStudy",
  "s2FieldsOfStudy",
  "publicationTypes",
].join(",");

function providerQuery(request: SearchRequest): string {
  return [request.query, ...request.filters.disciplines]
    .filter(Boolean)
    .join(" ")
    .replace(/[?!.:,;()[\]{}\-‐‑‒–—―]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "未知错误";
}

function semanticScholarError(error: unknown, hasApiKey: boolean): Error {
  const message = errorMessage(error);
  if (/429|too many requests/i.test(message)) {
    return new Error(hasApiKey
      ? "Semantic Scholar 请求受限（429），请稍后重试"
      : "Semantic Scholar 匿名接口限流（429），本次已由 OpenAlex 与 Crossref 继续检索");
  }
  if (/403|forbidden/i.test(message)) {
    return new Error("Semantic Scholar 拒绝了请求（403），请检查 API Key 是否有效");
  }
  return new Error(`Semantic Scholar 请求失败：${message}`);
}

function mapPaper(paper: SemanticPaper): Paper {
  const fields = [
    ...(paper.fieldsOfStudy ?? []),
    ...(paper.s2FieldsOfStudy?.map((field) => field.category).filter(Boolean) as string[] ?? []),
  ];
  const topics = Array.from(new Set(fields)).slice(0, 8);
  const doi = paper.externalIds?.DOI;

  return {
    id: paper.paperId ? `semantic:${paper.paperId}` : `semantic:${paper.title?.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80)}`,
    doi,
    title: paper.title || "Untitled Semantic Scholar paper",
    authors: paper.authors?.map((author) => author.name).filter(Boolean) as string[] ?? [],
    abstract: paper.abstract || "No abstract was provided by Semantic Scholar for this paper.",
    journal: paper.venue,
    year: paper.year,
    publisher: paper.venue || "Semantic Scholar",
    citationCount: paper.citationCount ?? 0,
    publisherUrl: paper.url,
    oaUrl: paper.openAccessPdf?.url,
    pdfUrl: paper.openAccessPdf?.url,
    isOpenAccess: Boolean(paper.openAccessPdf?.url),
    sourceProvider: "Semantic Scholar",
    concepts: topics,
    topics,
    keywords: [...topics, ...(paper.publicationTypes ?? [])].slice(0, 10),
    references: paper.referenceCount ? [`${paper.referenceCount} references indexed by Semantic Scholar`] : [],
    relatedPapers: [],
  };
}

export const semanticScholarService = {
  async searchWorks(request: SearchRequest): Promise<Paper[]> {
    const { semanticScholarApiKey } = loadProviderSettings();
    const apiKey = semanticScholarApiKey.trim();
    const headers = apiKey ? [{ name: "x-api-key", value: apiKey }] : undefined;

    if (request.type === "doi") {
      const paperId = `DOI:${encodeURIComponent(request.query.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim())}`;
      try {
        const paper = await fetchScholarlyJson<SemanticPaper>(
          `${SEMANTIC_PAPER_BASE}/${paperId}?fields=${encodeURIComponent(FIELDS)}`,
          headers,
        );
        return paper.title ? [mapPaper(paper)] : [];
      } catch (error) {
        if (/404|not found/i.test(errorMessage(error))) return [];
        throw semanticScholarError(error, Boolean(apiKey));
      }
    }

    const params = new URLSearchParams({
      query: providerQuery(request),
      limit: "12",
      fields: FIELDS,
    });
    if (request.filters.minYear) {
      params.set("year", request.filters.maxYear ? `${request.filters.minYear}-${request.filters.maxYear}` : `${request.filters.minYear}-`);
    }
    if (request.filters.minCitations) params.set("minCitationCount", String(request.filters.minCitations));
    if (request.filters.openAccessOnly) params.set("openAccessPdf", "");

    try {
      const data = await fetchScholarlyJson<SemanticSearchResponse>(
        `${SEMANTIC_SEARCH_BASE}?${params.toString()}`,
        headers,
      );
      return (data.data ?? []).map(mapPaper);
    } catch (error) {
      throw semanticScholarError(error, Boolean(apiKey));
    }
  },
};
