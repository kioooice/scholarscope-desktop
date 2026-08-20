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

const SEMANTIC_BASE = "https://api.semanticscholar.org/graph/v1/paper/search";
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
  return [request.query, ...request.filters.disciplines].filter(Boolean).join(" ").replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
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
    const params = new URLSearchParams({
      query: providerQuery(request),
      limit: "12",
      fields: FIELDS,
    });
    if (request.filters.minYear) {
      params.set("year", request.filters.maxYear ? `${request.filters.minYear}-${request.filters.maxYear}` : `${request.filters.minYear}-`);
    }

    const { semanticScholarApiKey } = loadProviderSettings();
    const headers = semanticScholarApiKey.trim() ? { "x-api-key": semanticScholarApiKey.trim() } : undefined;
    const data = await fetchScholarlyJson<SemanticSearchResponse>(
      `${SEMANTIC_BASE}?${params.toString()}`,
      headers ? [{ name: "x-api-key", value: headers["x-api-key"] }] : undefined,
    );
    return (data.data ?? []).map(mapPaper);
  },
};
