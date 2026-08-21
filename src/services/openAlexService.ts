import { invoke } from "@tauri-apps/api/core";
import type { Paper, SearchRequest } from "../types/athena";

type OpenAlexAuthor = {
  author?: { display_name?: string };
};

type OpenAlexConcept = {
  display_name?: string;
};

type OpenAlexWork = {
  id: string;
  doi?: string;
  title?: string;
  display_name?: string;
  publication_year?: number;
  cited_by_count?: number;
  primary_location?: {
    source?: { display_name?: string };
    landing_page_url?: string;
    pdf_url?: string;
    is_oa?: boolean;
  };
  locations?: Array<{
    landing_page_url?: string;
    pdf_url?: string;
  }>;
  open_access?: {
    is_oa?: boolean;
    oa_url?: string;
  };
  authorships?: OpenAlexAuthor[];
  concepts?: OpenAlexConcept[];
  topics?: { display_name?: string }[];
  abstract_inverted_index?: Record<string, number[]>;
  referenced_works?: string[];
  related_works?: string[];
};

const OPENALEX_BASE = "https://api.openalex.org";

function rebuildAbstract(index?: Record<string, number[]>): string {
  if (!index) return "No abstract was provided by OpenAlex for this work.";
  const words: Array<[number, string]> = [];
  Object.entries(index).forEach(([word, positions]) => {
    positions.forEach((position) => words.push([position, word]));
  });
  return words
    .sort((a, b) => a[0] - b[0])
    .map(([, word]) => word)
    .join(" ");
}

function normalizeDoi(doi?: string): string | undefined {
  if (!doi) return undefined;
  return doi.replace(/^https?:\/\/doi\.org\//i, "").trim();
}

function chinesePlatformUrls(work: OpenAlexWork): Partial<Record<"cnki" | "wanfang" | "cqvip", string>> {
  const urls = [
    work.primary_location?.landing_page_url,
    work.primary_location?.pdf_url,
    ...(work.locations ?? []).flatMap((location) => [location.landing_page_url, location.pdf_url]),
  ].filter(Boolean) as string[];
  const result: Partial<Record<"cnki" | "wanfang" | "cqvip", string>> = {};
  for (const value of urls) {
    try {
      const host = new URL(value).hostname.toLowerCase();
      const key = host === "cnki.net" || host.endsWith(".cnki.net")
        ? "cnki"
        : host === "wanfangdata.com.cn" || host.endsWith(".wanfangdata.com.cn")
          ? "wanfang"
          : host === "cqvip.com" || host.endsWith(".cqvip.com")
            ? "cqvip"
            : undefined;
      if (key && !result[key]) result[key] = value;
    } catch {
      // Ignore malformed provider links.
    }
  }
  return result;
}

function mapWork(work: OpenAlexWork): Paper {
  const authors = work.authorships?.map((item) => item.author?.display_name).filter(Boolean) as string[];
  const concepts = work.concepts?.map((concept) => concept.display_name).filter(Boolean).slice(0, 10) as string[];
  const topics = work.topics?.map((topic) => topic.display_name).filter(Boolean).slice(0, 8) as string[];
  const primary = work.primary_location;
  const isOpenAccess = Boolean(work.open_access?.is_oa || primary?.is_oa);

  return {
    id: work.id,
    openalexId: work.id,
    doi: normalizeDoi(work.doi),
    title: work.title || work.display_name || "Untitled work",
    authors,
    abstract: rebuildAbstract(work.abstract_inverted_index),
    journal: primary?.source?.display_name,
    year: work.publication_year,
    publisher: primary?.source?.display_name,
    citationCount: work.cited_by_count ?? 0,
    publisherUrl: primary?.landing_page_url,
    oaUrl: work.open_access?.oa_url,
    pdfUrl: primary?.pdf_url,
    chinesePlatformUrls: chinesePlatformUrls(work),
    isOpenAccess,
    sourceProvider: "OpenAlex",
    concepts,
    topics,
    keywords: [...new Set([...concepts.slice(0, 5), ...topics.slice(0, 3)])],
    references: work.referenced_works?.slice(0, 8) ?? [],
    relatedPapers: work.related_works?.slice(0, 8) ?? [],
  };
}

function buildFilter(request: SearchRequest): string | undefined {
  const filters: string[] = [];
  if (request.filters.openAccessOnly) filters.push("is_oa:true");
  if (request.filters.minYear) filters.push(`from_publication_date:${request.filters.minYear}-01-01`);
  if (request.filters.maxYear) filters.push(`to_publication_date:${request.filters.maxYear}-12-31`);
  if (request.filters.minCitations) filters.push(`cited_by_count:>${request.filters.minCitations}`);
  return filters.length ? filters.join(",") : undefined;
}

function buildProviderQuery(request: SearchRequest): string {
  const query = request.query.replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
  if (request.type === "topic" || request.type === "keywords") {
    return [query, ...request.filters.disciplines].filter(Boolean).join(" ");
  }
  return query;
}

export const openAlexService = {
  async searchWorks(request: SearchRequest): Promise<Paper[]> {
    try {
      return await invoke<Paper[]>("agent_search_openalex", { request });
    } catch {
      // Browser development and older desktop builds fall back to direct API fetch.
    }

    const params = new URLSearchParams({
      "per-page": "25",
    });

    if (request.type === "doi") {
      params.set("filter", `doi:${request.query.trim()}`);
    } else if (request.type === "author") {
      const query = buildProviderQuery(request);
      params.set("search", query);
      params.set("filter", ["authorships.author.search:" + query, buildFilter(request)].filter(Boolean).join(","));
    } else if (request.type === "title") {
      params.set("search.title", buildProviderQuery(request));
    } else {
      params.set("search", buildProviderQuery(request));
    }

    const filter = buildFilter(request);
    if (filter && request.type !== "author") params.set("filter", filter);

    const response = await fetch(`${OPENALEX_BASE}/works?${params.toString()}`);
    if (!response.ok) throw new Error(`OpenAlex search failed: ${response.status}`);
    const data = await response.json();
    return (data.results ?? []).map(mapWork);
  },

  async getWork(idOrDoi: string): Promise<Paper> {
    const id = idOrDoi.startsWith("10.") ? `doi:${idOrDoi}` : idOrDoi;
    const response = await fetch(`${OPENALEX_BASE}/works/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`OpenAlex lookup failed: ${response.status}`);
    return mapWork(await response.json());
  },
};
