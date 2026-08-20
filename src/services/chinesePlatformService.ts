import { fetchScholarlyText } from "./scholarlyFetch";

export type ChinesePlatformKey = "cnki" | "wanfang" | "cqvip";
export type ChinesePlatformStatus = "found" | "not-found" | "unavailable";

export type ChinesePlatformResult = {
  key: ChinesePlatformKey;
  label: string;
  searchUrl: string;
  status: ChinesePlatformStatus;
  detail?: string;
};

type ChinesePlatformTarget = Omit<ChinesePlatformResult, "status" | "detail"> & {
  domain: string;
};

const CACHE_TTL_MS = 30 * 60 * 1_000;
const lookupCache = new Map<string, { expiresAt: number; results: ChinesePlatformResult[] }>();
const pendingLookups: Array<() => void> = [];
let activeLookups = 0;

export function buildChinesePlatformTargets(title: string): ChinesePlatformTarget[] {
  const encodedTitle = encodeURIComponent(title.trim());
  return [
    {
      key: "cnki",
      label: "中国知网",
      domain: "cnki.net",
      searchUrl: `https://kns.cnki.net/kns8s/defaultresult/index?kw=${encodedTitle}`,
    },
    {
      key: "wanfang",
      label: "万方数据",
      domain: "wanfangdata.com.cn",
      searchUrl: `https://s.wanfangdata.com.cn/paper?q=${encodedTitle}`,
    },
    {
      key: "cqvip",
      label: "维普",
      domain: "cqvip.com",
      searchUrl: `https://www.cqvip.com/search?k=${encodedTitle}`,
    },
  ];
}

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeTitle(value: string): string {
  return decodeHtml(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function titleMatch(candidate: string, expected: string): boolean {
  const normalizedCandidate = normalizeTitle(candidate);
  const normalizedExpected = normalizeTitle(expected);
  if (!normalizedCandidate || !normalizedExpected) return false;
  if (normalizedCandidate.includes(normalizedExpected) || normalizedExpected.includes(normalizedCandidate)) {
    return Math.min(normalizedCandidate.length, normalizedExpected.length) >= Math.min(10, normalizedExpected.length);
  }

  const expectedPairs = new Set(Array.from({ length: Math.max(0, normalizedExpected.length - 1) }, (_, index) => normalizedExpected.slice(index, index + 2)));
  const candidatePairs = new Set(Array.from({ length: Math.max(0, normalizedCandidate.length - 1) }, (_, index) => normalizedCandidate.slice(index, index + 2)));
  if (!expectedPairs.size || !candidatePairs.size) return false;
  let overlap = 0;
  candidatePairs.forEach((pair) => { if (expectedPairs.has(pair)) overlap += 1; });
  return (2 * overlap) / (expectedPairs.size + candidatePairs.size) >= 0.82;
}

function bingResultBlocks(html: string): string[] {
  const starts = Array.from(html.matchAll(/<(?:li|div)\b[^>]*class=["'][^"']*\bb_algo\b[^"']*["'][^>]*>/gi));
  return starts.map((match, index) => html.slice(match.index, starts[index + 1]?.index ?? html.length));
}

export function classifyPlatformIndexHtml(html: string, title: string, domain: string): ChinesePlatformStatus {
  const blocks = bingResultBlocks(html);
  if (!blocks.length) return "unavailable";
  const matched = blocks.some((block) => {
    if (!block.toLowerCase().includes(domain.toLowerCase())) return false;
    const heading = block.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? block;
    return titleMatch(heading, title);
  });
  return matched ? "found" : "not-found";
}

function indexSearchUrl(title: string, domains: string[]): string {
  const params = new URLSearchParams({
    q: `"${title.trim()}" (${domains.map((domain) => `site:${domain}`).join(" OR ")})`,
    count: "10",
  });
  return `https://www.bing.com/search?${params.toString()}`;
}

function withLookupSlot<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeLookups += 1;
      void task().then(resolve, reject).finally(() => {
        activeLookups -= 1;
        pendingLookups.shift()?.();
      });
    };
    if (activeLookups < 2) run();
    else pendingLookups.push(run);
  });
}

export async function checkChinesePlatforms(title: string): Promise<ChinesePlatformResult[]> {
  const normalized = title.trim();
  if (!normalized) return [];
  const cached = lookupCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return cached.results;

  const targets = buildChinesePlatformTargets(normalized);
  let results: ChinesePlatformResult[];
  try {
    const html = await withLookupSlot(() => fetchScholarlyText(indexSearchUrl(normalized, targets.map((target) => target.domain))));
    results = targets.map((target): ChinesePlatformResult => {
      const status = classifyPlatformIndexHtml(html, normalized, target.domain);
      return {
        key: target.key,
        label: target.label,
        searchUrl: target.searchUrl,
        status,
        detail: status === "found"
          ? "公开网页索引中检出同题名记录"
          : status === "not-found"
            ? "公开网页索引暂未检出，建议打开平台确认"
            : "公开网页索引当前不可用，建议打开平台确认",
      };
    });
  } catch {
    results = targets.map((target): ChinesePlatformResult => ({
        key: target.key,
        label: target.label,
        searchUrl: target.searchUrl,
        status: "unavailable",
        detail: "网络或索引服务当前不可用，建议打开平台确认",
    }));
  }

  if (results.some((result) => result.status !== "unavailable")) {
    lookupCache.set(normalized, { expiresAt: Date.now() + CACHE_TTL_MS, results });
  }
  return results;
}
