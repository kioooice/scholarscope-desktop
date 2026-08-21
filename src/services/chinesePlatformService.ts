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

const platformDefinitions = [
  { key: "cnki", label: "中国知网", domain: "cnki.net" },
  { key: "wanfang", label: "万方数据", domain: "wanfangdata.com.cn" },
  { key: "cqvip", label: "维普", domain: "cqvip.com" },
] as const;

export function containsChineseText(value: string): boolean {
  return /\p{Script=Han}/u.test(value);
}

export function buildChinesePlatformTargets(title: string): ChinesePlatformTarget[] {
  const encodedTitle = encodeURIComponent(title.trim());
  return [
    {
      ...platformDefinitions[0],
      searchUrl: `https://kns.cnki.net/kns8s/defaultresult/index?kw=${encodedTitle}`,
    },
    {
      ...platformDefinitions[1],
      searchUrl: `https://s.wanfangdata.com.cn/paper?q=${encodedTitle}`,
    },
    {
      ...platformDefinitions[2],
      searchUrl: `https://www.cqvip.com/search?k=${encodedTitle}`,
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
  const targets = buildChinesePlatformTargets(paper.title);
  const explicitUrls = paper.chinesePlatformUrls ?? {};
  const candidateUrls = [
    paper.publisherUrl,
    paper.oaUrl,
    paper.pdfUrl,
    ...Object.values(paper.sourceUrls),
  ].filter(Boolean) as string[];

  return targets.flatMap((target) => {
    const recordUrl = explicitUrls[target.key]
      ?? candidateUrls.find((url) => matchesDomain(url, target.domain));
    return recordUrl ? [{ ...target, recordUrl }] : [];
  });
}
