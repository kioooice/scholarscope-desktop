import type { Paper, SearchFilters, SearchSource } from "./scholarscope";

export type ScanSciLookupStatus = "idle" | "checking" | "found" | "not-found" | "unavailable" | "error";

export type ScanSciLookupState = {
  status: ScanSciLookupStatus;
  source?: string;
  url?: string;
  isPdf?: boolean;
  routeId?: string;
  probeStatus?: "verified" | "unverified" | "blocked" | "rejected" | string;
  probeError?: string;
  routes?: Array<{ source?: string; url?: string; isPdf?: boolean; routeId?: string; probeStatus?: "verified" | "unverified" | "blocked" | "rejected" | string; probeError?: string }>;
  checkedSources?: number;
  totalSources?: number;
  downloadStatus?: "idle" | "downloading" | "ready" | "error";
  error?: string;
};

export type UnifiedPaper = Paper & {
  abstractSource?: SearchSource;
  sourceProviders: SearchSource[];
  sourceUrls: Partial<Record<SearchSource, string>>;
  mergeWarnings: string[];
  relevanceScore: number;
};

export type ProviderStatus = "pending" | "running" | "success" | "disabled" | "error" | "timeout";

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
