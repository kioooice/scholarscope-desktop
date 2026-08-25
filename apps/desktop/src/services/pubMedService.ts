import type { Paper, SearchRequest } from "../types/athena";
import { loadProviderSettings } from "./providerSettingsService";
import { fetchScholarlyJson, fetchScholarlyText } from "./scholarlyFetch";

const PUBMED_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

type PubMedSearchResponse = {
  esearchresult?: {
    idlist?: string[];
  };
};

function textContent(parent: Element, selector: string): string {
  return parent.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function allText(parent: Element, selector: string): string[] {
  return Array.from(parent.querySelectorAll(selector))
    .map((node) => node.textContent?.replace(/\s+/g, " ").trim())
    .filter(Boolean) as string[];
}

function providerQuery(request: SearchRequest): string {
  const query = [request.query, ...request.filters.disciplines].filter(Boolean).join(" ");
  const dateFilter = request.filters.minYear ? ` AND ${request.filters.minYear}:3000[pdat]` : "";
  return `${query}${dateFilter}`;
}

function authorNames(article: Element): string[] {
  return Array.from(article.querySelectorAll("Author"))
    .map((author) => {
      const last = textContent(author, "LastName");
      const fore = textContent(author, "ForeName") || textContent(author, "Initials");
      const collective = textContent(author, "CollectiveName");
      return collective || [fore, last].filter(Boolean).join(" ").trim();
    })
    .filter(Boolean);
}

function doi(article: Element): string | undefined {
  return Array.from(article.querySelectorAll("ArticleId"))
    .find((id) => id.getAttribute("IdType")?.toLowerCase() === "doi")
    ?.textContent?.trim();
}

function publicationYear(article: Element): number | undefined {
  const year = textContent(article, "PubDate Year") || textContent(article, "ArticleDate Year");
  return year ? Number(year) : undefined;
}

function mapArticle(article: Element): Paper {
  const pmid = textContent(article, "PMID");
  const articleDoi = doi(article);
  const title = textContent(article, "ArticleTitle") || "Untitled PubMed record";
  const meshTerms = allText(article, "MeshHeading DescriptorName").slice(0, 8);
  const keywords = allText(article, "Keyword").slice(0, 8);
  const abstract = allText(article, "Abstract AbstractText").join(" ") || "No abstract was provided by PubMed for this record.";

  return {
    id: pmid ? `pubmed:${pmid}` : `pubmed:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80)}`,
    doi: articleDoi,
    title,
    authors: authorNames(article),
    abstract,
    journal: textContent(article, "Journal Title") || textContent(article, "MedlineTA"),
    year: publicationYear(article),
    publisher: "PubMed",
    citationCount: 0,
    publisherUrl: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : undefined,
    isOpenAccess: false,
    sourceProvider: "PubMed",
    concepts: meshTerms,
    topics: meshTerms,
    keywords: keywords.length ? keywords : meshTerms,
    references: [],
    relatedPapers: [],
  };
}

export const pubMedService = {
  async searchWorks(request: SearchRequest): Promise<Paper[]> {
    const { ncbiApiKey } = loadProviderSettings();
    const searchParams = new URLSearchParams({
      db: "pubmed",
      term: providerQuery(request),
      retmode: "json",
      retmax: "12",
      sort: "relevance",
    });
    if (ncbiApiKey.trim()) searchParams.set("api_key", ncbiApiKey.trim());
    const searchData = await fetchScholarlyJson<PubMedSearchResponse>(`${PUBMED_BASE}/esearch.fcgi?${searchParams.toString()}`);
    const ids = (searchData.esearchresult?.idlist ?? []) as string[];
    if (!ids.length) return [];

    const fetchParams = new URLSearchParams({
      db: "pubmed",
      id: ids.join(","),
      retmode: "xml",
    });
    if (ncbiApiKey.trim()) fetchParams.set("api_key", ncbiApiKey.trim());
    const xml = await fetchScholarlyText(`${PUBMED_BASE}/efetch.fcgi?${fetchParams.toString()}`);
    const document = new DOMParser().parseFromString(xml, "application/xml");
    return Array.from(document.querySelectorAll("PubmedArticle")).map(mapArticle);
  },
};
