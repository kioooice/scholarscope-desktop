export type SearchSource = "Crossref" | "OpenAlex" | "ScholarScope";

export type Paper = {
  id: string;
  openalexId?: string;
  doi?: string;
  title: string;
  authors: string[];
  abstract: string;
  journal?: string;
  year?: number;
  publisher?: string;
  citationCount: number;
  publisherUrl?: string;
  oaUrl?: string;
  pdfUrl?: string;
  isOpenAccess: boolean;
  sourceProvider: SearchSource;
  concepts: string[];
  topics: string[];
  keywords: string[];
  references: string[];
  relatedPapers: string[];
};

export type SearchFilters = {
  disciplines: string[];
  openAccessOnly: boolean;
  minYear?: number;
  maxYear?: number;
  minCitations?: number;
};

export type ProviderSettings = {
  crossrefEmail: string;
  /** Empty means the portable package directory resolved by the desktop runtime. */
  downloadDirectory: string;
  scansciEnabled: boolean;
  scansciAutoSearch: boolean;
  scansciScope: "selected" | "top" | "all";
  scansciTopN: number;
  scansciTimeoutMs: number;
  scansciScihubEnabled: boolean;
  scansciUseTor: boolean;
};
