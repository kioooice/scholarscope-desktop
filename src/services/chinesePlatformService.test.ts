import { describe, expect, it } from "vitest";
import type { UnifiedPaper } from "../types/search";
import {
  buildChinesePlatformLinks,
  buildChinesePlatformTargets,
  containsChineseText,
  identifyChinesePlatforms,
} from "./chinesePlatformService";

function paper(overrides: Partial<UnifiedPaper> = {}): UnifiedPaper {
  return {
    id: "paper-1",
    title: "碱性无氰镀锌工艺研究",
    authors: [],
    abstract: "",
    citationCount: 0,
    isOpenAccess: false,
    sourceProvider: "OpenAlex",
    concepts: [],
    topics: [],
    keywords: [],
    references: [],
    relatedPapers: [],
    sourceProviders: ["OpenAlex"],
    sourceUrls: {},
    mergeWarnings: [],
    relevanceScore: 0,
    ...overrides,
  };
}

describe("Chinese platform handoff", () => {
  it("builds direct title-search links for all three platforms", () => {
    const targets = buildChinesePlatformTargets("碱性无氰镀锌");

    expect(targets.map((target) => target.key)).toEqual(["cnki", "wanfang", "cqvip"]);
    expect(targets[0].searchUrl).toContain("kns.cnki.net/kns8s/defaultresult/index?kw=");
    expect(decodeURIComponent(targets[1].searchUrl)).toContain("q=碱性无氰镀锌");
    expect(decodeURIComponent(targets[2].searchUrl)).toContain("k=碱性无氰镀锌");
  });

  it("adds the journal to platform searches when it is available", () => {
    const targets = buildChinesePlatformTargets("碱性无氰镀锌", "电镀表面处理");

    expect(decodeURIComponent(targets[0].searchUrl)).toContain("碱性无氰镀锌 电镀表面处理");
    expect(decodeURIComponent(targets[1].searchUrl)).toContain("q=碱性无氰镀锌 电镀表面处理");
  });

  it("only enables Chinese handoff for text containing Han characters", () => {
    expect(containsChineseText("碱性镀锌 additive")).toBe(true);
    expect(containsChineseText("alkaline zinc plating")).toBe(false);
  });

  it("identifies a platform from an OpenAlex landing page", () => {
    const matches = identifyChinesePlatforms(paper({
      chinesePlatformUrls: { cnki: "https://kns.cnki.net/kcms2/article/abstract?v=1" },
    }));

    expect(matches.map((match) => match.key)).toEqual(["cnki"]);
    expect(matches[0].recordUrl).toContain("kns.cnki.net");
  });

  it("does not claim availability from an unrelated publisher URL", () => {
    expect(identifyChinesePlatforms(paper({
      publisherUrl: "https://doi.org/10.1000/example",
    }))).toEqual([]);
  });

  it("falls back to journal-scoped links without calling them confirmed records", () => {
    const links = buildChinesePlatformLinks(paper({ journal: "电镀表面处理" }), "无氰镀锌工艺");

    expect(links).toHaveLength(3);
    expect(links.every((link) => link.matchType === "journal")).toBe(true);
    expect(decodeURIComponent(links[0].url)).toContain("无氰镀锌工艺 电镀表面处理");
  });

  it("keeps exact platform records ahead of journal-scoped fallbacks", () => {
    const links = buildChinesePlatformLinks(paper({
      journal: "电镀表面处理",
      chinesePlatformUrls: { cnki: "https://kns.cnki.net/kcms2/article/abstract?v=1" },
    }), "无氰镀锌工艺");

    expect(links.map((link) => link.matchType)).toEqual(["record", "journal", "journal"]);
    expect(links[0].url).toContain("kns.cnki.net");
  });
});
