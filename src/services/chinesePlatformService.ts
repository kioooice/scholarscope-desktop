import type { UnifiedPaper } from "../types/search";

export type ChinesePlatformKey = "cnki" | "wanfang" | "cqvip";

export type ChinesePlatformTarget = {
  key: ChinesePlatformKey;
  label: string;
  domain: string;
  searchUrl: string;
};

export type IdentifiedChinesePlatform = ChinesePlatformTarget & {
  recordUrl: string;
};

export type ChinesePlatformLink = ChinesePlatformTarget & {
  url: string;
  matchType: "record" | "journal";
};

const platformDefinitions = [
  { key: "cnki", label: "中国知网", domain: "cnki.net" },
  { key: "wanfang", label: "万方数据", domain: "wanfangdata.com.cn" },
  { key: "cqvip", label: "维普", domain: "cqvip.com" },
] as const;

export function containsChineseText(value: string): boolean {
  return /\p{Script=Han}/u.test(value);
}

function searchText(title: string, journal?: string): string {
  return Array.from(new Set([title, journal].map((value) => value?.trim()).filter(Boolean))).join(" ");
}

export function buildChinesePlatformTargets(title: string, journal?: string): ChinesePlatformTarget[] {
  const encodedQuery = encodeURIComponent(searchText(title, journal));
  return [
    {
      ...platformDefinitions[0],
      searchUrl: `https://kns.cnki.net/kns8s/defaultresult/index?kw=${encodedQuery}`,
    },
    {
      ...platformDefinitions[1],
      searchUrl: `https://s.wanfangdata.com.cn/paper?q=${encodedQuery}`,
    },
    {
      ...platformDefinitions[2],
      searchUrl: `https://www.cqvip.com/search?k=${encodedQuery}`,
    },
  ];
}

function matchesDomain(value: string, domain: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

export function identifyChinesePlatforms(paper: UnifiedPaper): IdentifiedChinesePlatform[] {
  const targets = buildChinesePlatformTargets(paper.title, paper.journal);
  const explicitUrls = paper.chinesePlatformUrls ?? {};
  const candidateUrls = [
    paper.publisherUrl,
    paper.oaUrl,
    paper.pdfUrl,
    ...Object.values(paper.sourceUrls),
  ].filter(Boolean) as string[];

  return targets.flatMap((target): IdentifiedChinesePlatform[] => {
    const recordUrl = explicitUrls[target.key]
      ?? candidateUrls.find((url) => matchesDomain(url, target.domain));
    return recordUrl ? [{ ...target, recordUrl }] : [];
  });
}

export function buildChinesePlatformLinks(paper: UnifiedPaper, query = paper.title): ChinesePlatformLink[] {
  const identified = identifyChinesePlatforms(paper);
  const targets = buildChinesePlatformTargets(query, paper.journal);

  return targets.flatMap((target): ChinesePlatformLink[] => {
    const record = identified.find((item) => item.key === target.key);
    if (record) return [{ ...target, url: record.recordUrl, matchType: "record" as const }];
    if (!paper.journal?.trim()) return [];
    return [{ ...target, url: target.searchUrl, matchType: "journal" as const }];
  });
}
