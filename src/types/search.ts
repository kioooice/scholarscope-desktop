import type { Paper, SearchFilters, SearchSource } from "./athena";

export type UnifiedPaper = Paper & {
  sourceProviders: SearchSource[];
  sourceUrls: Partial<Record<SearchSource, string>>;
  mergeWarnings: string[];
  relevanceScore: number;
};

export type ProviderStatus = "pending" | "running" | "success" | "error" | "timeout";

export type ProviderDiagnostic = {
  provider: SearchSource;
  status: ProviderStatus;
  resultCount: number;
  durationMs: number;
  error?: string;
};

export type SearchSession = {
  id: string;
  query: string;
  filters: SearchFilters;
  startedAt: string;
  durationMs: number;
  rawResultCount: number;
  mergedResultCount: number;
  cacheHit: boolean;
  diagnostics: ProviderDiagnostic[];
  papers: UnifiedPaper[];
};

export type SearchHistoryEntry = Pick<SearchSession, "id" | "query" | "startedAt" | "durationMs" | "mergedResultCount">;
