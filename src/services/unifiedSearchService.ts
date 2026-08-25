import type { Paper, SearchFilters, SearchSource } from "../types/athena";
import type { ProviderDiagnostic, SearchHistoryEntry, SearchSession, UnifiedPaper } from "../types/search";
import { isPlaceholderAbstract } from "./abstractLookupService";
import { internalApiUrl } from "./internalApi";
import { loadProviderSettings } from "./providerSettingsService";

const CACHE_TTL_MS = 15 * 60 * 1000;
const ENGINE_TIMEOUT_MS = 90_000;
const HISTORY_KEY = "scholarscope.searchHistory.v1";
const cache = new Map<string, { expiresAt: number; session: SearchSession }>();

const ENGINE_PROVIDER: SearchSource = "ScholarScope";

// Crossref supplies the initial record; the internal Python engine owns the
// complete ScanSci source pool used for access discovery and download.
export const primaryProviderCount = 1;

function cleanDoi(value?: string): string | undefined {
  const doi = value?.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").toLowerCase();
  return doi || undefined;
}

export function normalizeTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function paperKey(paper: Paper): string {
  const doi = cleanDoi(paper.doi);
  return doi ? `doi:${doi}` : `title:${normalizeTitle(paper.title)}`;
}

function preferredAbstract(left: string, right: string): string {
  if (isPlaceholderAbstract(left) && !isPlaceholderAbstract(right)) return right;
  if (!isPlaceholderAbstract(left) && isPlaceholderAbstract(right)) return left;
  return right.length > left.length ? right : left;
}

function sourceUrl(paper: Paper): string | undefined {
  if (paper.sourceProvider === "OpenAlex" && paper.openalexId) return paper.openalexId;
  if (paper.sourceProvider === "Crossref" && paper.doi) return `https://doi.org/${cleanDoi(paper.doi)}`;
  if (paper.sourceProvider === "OpenAIRE" && paper.doi) return `https://doi.org/${cleanDoi(paper.doi)}`;
  if (paper.sourceProvider === "Unpaywall") return paper.oaUrl || paper.pdfUrl;
  if (paper.publisherUrl) return paper.publisherUrl;
  if (paper.doi) return `https://doi.org/${cleanDoi(paper.doi)}`;
  return paper.openalexId;
}

function initialPaper(paper: Paper): UnifiedPaper {
  const url = sourceUrl(paper);
  return {
    ...paper,
    abstractSource: isPlaceholderAbstract(paper.abstract) ? undefined : paper.sourceProvider,
    doi: cleanDoi(paper.doi),
    sourceProviders: [paper.sourceProvider],
    sourceUrls: url ? { [paper.sourceProvider]: url } : {},
    mergeWarnings: [],
    relevanceScore: 0,
  };
}

function mergePaper(current: UnifiedPaper, incoming: Paper): UnifiedPaper {
  const sourceProviders = Array.from(new Set([...current.sourceProviders, incoming.sourceProvider]));
  const incomingUrl = sourceUrl(incoming);
  const yearConflict = Boolean(current.year && incoming.year && Math.abs(current.year - incoming.year) > 1);
  const mergeWarnings = yearConflict
    ? Array.from(new Set([...current.mergeWarnings, `来源年份不一致：${current.year} / ${incoming.year}`]))
    : current.mergeWarnings;
  const abstract = preferredAbstract(current.abstract, incoming.abstract);
  const abstractSource = abstract === current.abstract
    ? current.abstractSource
    : isPlaceholderAbstract(incoming.abstract) ? current.abstractSource : incoming.sourceProvider;

  return {
    ...current,
    doi: current.doi ?? cleanDoi(incoming.doi),
    openalexId: current.openalexId ?? incoming.openalexId,
    title: incoming.title.length > current.title.length ? incoming.title : current.title,
    authors: incoming.authors.length > current.authors.length ? incoming.authors : current.authors,
    abstract,
    abstractSource,
    journal: current.journal ?? incoming.journal,
    year: current.year ?? incoming.year,
    publisher: current.publisher ?? incoming.publisher,
    citationCount: Math.max(current.citationCount, incoming.citationCount),
    publisherUrl: current.publisherUrl ?? incoming.publisherUrl,
    oaUrl: current.oaUrl ?? incoming.oaUrl,
    pdfUrl: current.pdfUrl ?? incoming.pdfUrl,
    isOpenAccess: current.isOpenAccess || incoming.isOpenAccess,
    concepts: Array.from(new Set([...current.concepts, ...incoming.concepts])).slice(0, 12),
    topics: Array.from(new Set([...current.topics, ...incoming.topics])).slice(0, 10),
    keywords: Array.from(new Set([...current.keywords, ...incoming.keywords])).slice(0, 14),
    references: Array.from(new Set([...current.references, ...incoming.references])).slice(0, 12),
    relatedPapers: Array.from(new Set([...current.relatedPapers, ...incoming.relatedPapers])).slice(0, 12),
    sourceProviders,
    sourceUrls: incomingUrl ? { ...current.sourceUrls, [incoming.sourceProvider]: incomingUrl } : current.sourceUrls,
    mergeWarnings,
  };
}

function tokens(value: string): string[] {
  return normalizeTitle(value).split(" ").filter((token) => token.length > 1);
}

function scorePaper(paper: UnifiedPaper, query: string): number {
  const queryTokens = tokens(query);
  const title = normalizeTitle(paper.title);
  const abstract = normalizeTitle(paper.abstract);
  const exactTitleBoost = title.includes(normalizeTitle(query)) ? 60 : 0;
  const titleHits = queryTokens.reduce((score, token) => score + (title.includes(token) ? 14 : 0), 0);
  const abstractHits = queryTokens.reduce((score, token) => score + (abstract.includes(token) ? 3 : 0), 0);
  const sourceBoost = Math.min(18, paper.sourceProviders.length * 6);
  const citationBoost = Math.min(20, Math.log10(Math.max(1, paper.citationCount)) * 7);
  const abstractBoost = isPlaceholderAbstract(paper.abstract) ? 0 : 8;
  return exactTitleBoost + titleHits + abstractHits + sourceBoost + citationBoost + abstractBoost;
}

export function mergeAndRank(papers: Paper[], query: string, filters: SearchFilters): UnifiedPaper[] {
  const merged = new Map<string, UnifiedPaper>();
  for (const paper of papers) {
    const key = paperKey(paper);
    const existing = merged.get(key);
    merged.set(key, existing ? mergePaper(existing, paper) : initialPaper(paper));
  }

  return Array.from(merged.values())
    .filter((paper) => !filters.openAccessOnly || paper.isOpenAccess)
    .filter((paper) => !filters.minCitations || paper.citationCount >= filters.minCitations)
    .map((paper) => ({ ...paper, relevanceScore: scorePaper(paper, query) }))
    .sort((left, right) => right.relevanceScore - left.relevanceScore || right.citationCount - left.citationCount);
}

function cacheKey(query: string, filters: SearchFilters): string {
  return JSON.stringify({
    query: normalizeTitle(query),
    filters,
    providerPipeline: "internal-engine-crossref-metadata-v1",
  });
}

function safeMessage(error: unknown): string {
  if (!(error instanceof Error)) return "未知错误";
  return error.message.replace(/https?:\/\/[^\s]+/g, "远程接口").slice(0, 180);
}

function normalizeEnginePaper(paper: Paper): Paper {
  return {
    ...paper,
    sourceProvider: "ScholarScope",
  };
}

async function searchWithInternalEngine(query: string, filters: SearchFilters): Promise<{ papers: Paper[]; diagnostic: ProviderDiagnostic }> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);
  const started = performance.now();
  try {
    const settings = loadProviderSettings();
    const response = await fetch(internalApiUrl("/api/papers/search"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, filters, email: settings.crossrefEmail, timeoutMs: ENGINE_TIMEOUT_MS }),
      signal: controller.signal,
    });
    const payload = await response.json() as {
      papers?: Paper[];
      diagnostic?: Partial<ProviderDiagnostic>;
      error?: string;
    };
    if (!response.ok || payload.diagnostic?.status === "error") {
      throw new Error(payload.error || payload.diagnostic?.error || `内部引擎请求失败：${response.status}`);
    }
    const papers = Array.isArray(payload.papers) ? payload.papers.map(normalizeEnginePaper) : [];
    return {
      papers,
      diagnostic: {
        provider: ENGINE_PROVIDER,
        status: "success",
        resultCount: papers.length,
        durationMs: Number(payload.diagnostic?.durationMs) || Math.round(performance.now() - started),
      },
    };
  } catch (error) {
    const message = safeMessage(error);
    return {
      papers: [],
      diagnostic: {
        provider: ENGINE_PROVIDER,
        status: message.includes("超时") || /abort|timeout/i.test(message) ? "timeout" : "error",
        resultCount: 0,
        durationMs: Math.round(performance.now() - started),
        error: message,
      },
    };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function storeHistory(session: SearchSession): void {
  const previous = loadSearchHistory().filter((item) => normalizeTitle(item.query) !== normalizeTitle(session.query));
  const entry: SearchHistoryEntry = {
    id: session.id,
    query: session.query,
    startedAt: session.startedAt,
    durationMs: session.durationMs,
    mergedResultCount: session.mergedResultCount,
  };
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify([entry, ...previous].slice(0, 12)));
}

export function loadSearchHistory(): SearchHistoryEntry[] {
  try {
    return JSON.parse(window.localStorage.getItem(HISTORY_KEY) || "[]") as SearchHistoryEntry[];
  } catch {
    return [];
  }
}

export async function searchLiterature(query: string, filters: SearchFilters): Promise<SearchSession> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) throw new Error("请输入检索词");

  const key = cacheKey(normalizedQuery, filters);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.session, id: crypto.randomUUID(), startedAt: new Date().toISOString(), durationMs: 0, cacheHit: true };
  }

  const started = performance.now();
  const result = await searchWithInternalEngine(normalizedQuery, filters);
  const rawPapers = result.papers;
  const papers = mergeAndRank(rawPapers, normalizedQuery, filters);
  const session: SearchSession = {
    id: crypto.randomUUID(),
    query: normalizedQuery,
    filters,
    startedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    rawResultCount: rawPapers.length,
    mergedResultCount: papers.length,
    cacheHit: false,
    diagnostics: [result.diagnostic],
    papers,
  };

  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, session });
  storeHistory(session);
  return session;
}
