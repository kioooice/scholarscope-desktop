import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSettings } from "../types/scholarscope";
import type { UnifiedPaper } from "../types/search";

import { defaultProviderSettings } from "./providerSettingsService";
import { downloadTimeoutMs, scansciService, selectScanSciPapers } from "./scansciService";

function settings(overrides: Partial<ProviderSettings> = {}): ProviderSettings {
  return {
    ...defaultProviderSettings,
    scansciTimeoutMs: 2_000,
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  const body = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: vi.fn().mockResolvedValue(body),
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

function pdfResponse(source = "Repository mirror"): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/pdf", "x-scholarscope-source": source }),
    blob: vi.fn().mockResolvedValue(new Blob(["%PDF-1.7"], { type: "application/pdf" })),
  } as unknown as Response;
}

function paper(id: string, overrides: Partial<UnifiedPaper> = {}): UnifiedPaper {
  return {
    id,
    title: id,
    authors: [],
    abstract: "",
    citationCount: 0,
    isOpenAccess: false,
    sourceProvider: "Crossref",
    concepts: [],
    topics: [],
    keywords: [],
    references: [],
    relatedPapers: [],
    sourceProviders: ["Crossref"],
    sourceUrls: {},
    mergeWarnings: [],
    relevanceScore: 0,
    ...overrides,
  };
}

describe("integrated paper download engine", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("checks the internal engine and locates without downloading", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "ok", engine: { status: "ready" }, sourceCount: 13 }))
      .mockResolvedValueOnce(jsonResponse({
        status: "found",
        route: { source: "CORE", url: "https://repository.example/paper.pdf", isPdf: true },
        routeId: "route-core",
        checkedSources: 13,
        totalSources: 13,
      }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await scansciService.checkStatus(settings())).toBe("ready");
    const result = await scansciService.searchPaper({ title: "中文标题", doi: "10.5555/scansci-unique" }, settings());

    expect(fetchMock.mock.calls[0][0]).toBe("/api/status");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/papers/locate");
    expect(result).toMatchObject({
      status: "found",
      source: "CORE",
      url: "https://repository.example/paper.pdf",
      isPdf: true,
      routeId: "route-core",
      checkedSources: 13,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a blocked source as a browser page instead of a PDF candidate", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      status: "found",
      route: {
        source: "SpringerBrowser",
        url: "https://publisher.example/article",
        isPdf: false,
        probeStatus: "blocked",
        probeError: "来源被 Cloudflare 防护拦截，未返回 PDF。请打开来源页面完成验证，并在来源页直接下载 PDF。",
      },
      routes: [
        {
          source: "SpringerBrowser",
          url: "https://publisher.example/article",
          isPdf: false,
          probeStatus: "blocked",
        },
        { source: "CORE", url: "https://repository.example/paper.pdf", isPdf: true },
      ],
      checkedSources: 13,
      totalSources: 13,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await scansciService.searchPaper({ title: "Blocked paper", doi: "10.5555/scansci-blocked" }, settings());

    expect(result).toMatchObject({
      status: "found",
      source: "SpringerBrowser",
      url: "https://publisher.example/article",
      isPdf: false,
      probeStatus: "blocked",
    });
    expect(result.routes?.[0]).toMatchObject({ isPdf: false, probeStatus: "blocked" });
    expect(result.routes?.[1]).toMatchObject({ isPdf: true });
  });

  it("keeps download, manual, and publication routes in separate groups", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      status: "found",
      route: { source: "Unpaywall", url: "https://oa.example/paper.pdf", isPdf: true, probeStatus: "verified" },
      routes: [{ source: "Unpaywall", url: "https://oa.example/paper.pdf", isPdf: true, probeStatus: "verified" }],
      manualRoutes: [{ source: "LibGen", url: "https://mirror.example/article", isPdf: false, probeStatus: "blocked" }],
      publicationRoutes: [{ source: "ElsevierBrowser", url: "https://publisher.example/article", isPdf: false }],
      checkedSources: 13,
      totalSources: 13,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await scansciService.searchPaper({ title: "Categorised paper", doi: "10.5555/scansci-categories" }, settings());

    expect(result.routes).toMatchObject([{ source: "Unpaywall", isPdf: true, probeStatus: "verified" }]);
    expect(result.manualRoutes).toMatchObject([{ source: "LibGen", probeStatus: "blocked" }]);
    expect(result.publicationRoutes).toMatchObject([{ source: "ElsevierBrowser" }]);
    expect(result.checkedSources).toBe(13);
  });

  it("downloads only after the explicit download request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(pdfResponse());
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:scansci-test");

    const result = await scansciService.downloadPaper(
      { title: "Open paper", doi: "10.5555/scansci-oa" },
      settings(),
      {
        status: "found",
        source: "CORE",
        url: "https://repository.example/paper.pdf",
        isPdf: true,
        routeId: "route-core",
        routes: [
          { source: "CORE", url: "https://repository.example/paper.pdf", isPdf: true, routeId: "route-core" },
          { source: "Unpaywall", url: "https://oa.example/paper.pdf", isPdf: true, routeId: "route-oa" },
          { source: "LibGen", url: "https://libgen.example/get.php?id=1", isPdf: true, routeId: "route-libgen" },
          { source: "Publisher", url: "https://publisher.example/article", isPdf: false, routeId: "route-page" },
        ],
      },
    );

    expect(fetchMock.mock.calls[0][0]).toBe("/api/papers/download");
    expect(result).toMatchObject({ status: "found", source: "Repository mirror", url: "blob:scansci-test", isPdf: true, downloadStatus: "ready" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      identifier: "10.5555/scansci-oa",
      routeId: "route-core",
      routeIds: ["route-core", "route-oa", "route-libgen"],
      settings: { scihubEnabled: true, useTor: false },
    });
    expect(body).not.toHaveProperty("route");
  });

  it("forwards source and Tor settings to the internal engine", async () => {
    const fetchMock = vi.fn().mockResolvedValue(pdfResponse("Fallback source"));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:scansci-settings");

    await scansciService.downloadPaper(
      { title: "Configured paper", doi: "10.5555/scansci-settings" },
      settings({ scansciScihubEnabled: false, scansciUseTor: true }),
      {
        status: "found",
        source: "CORE",
        url: "https://repository.example/paper.pdf",
        isPdf: true,
        routeId: "route-core",
      },
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.settings).toMatchObject({ scihubEnabled: false, useTor: true });
  });

  it("keeps a located source retryable when a download attempt fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "内部下载引擎请求超时" }, 504));
    vi.stubGlobal("fetch", fetchMock);
    const current = { status: "found" as const, source: "CORE", url: "https://repository.example/paper.pdf", isPdf: true };

    const result = await scansciService.downloadPaper(
      { title: "Slow paper", doi: "10.5555/scansci-timeout" },
      settings(),
      current,
    );

    expect(result).toMatchObject({
      status: "found",
      source: "CORE",
      url: "https://repository.example/paper.pdf",
      downloadStatus: "error",
      error: "内部下载引擎请求超时",
    });
  });

  it("bounds a user-facing download request to a finite interval", () => {
    expect(downloadTimeoutMs(settings({ scansciTimeoutMs: 2_000 }))).toBe(15_000);
    expect(downloadTimeoutMs(settings({ scansciTimeoutMs: 20_000 }))).toBe(60_000);
    expect(downloadTimeoutMs(settings({ scansciTimeoutMs: 60_000 }))).toBe(90_000);
  });

  it("returns not-found from the locate endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "not-found", checkedSources: 13, totalSources: 13 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await scansciService.searchPaper({ title: "No route", doi: "10.5555/scansci-not-found" }, settings());

    expect(result).toMatchObject({ status: "not-found", checkedSources: 13, totalSources: 13 });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/papers/locate");
  });

  it("applies selected, top-N, and all scopes to papers", () => {
    const papers = [paper("paper-1"), paper("paper-2"), paper("paper-3")];

    expect(selectScanSciPapers(papers, settings({ scansciScope: "selected" }), "paper-2").map((item) => item.id)).toEqual(["paper-2"]);
    expect(selectScanSciPapers(papers, settings({ scansciScope: "top", scansciTopN: 1 })).map((item) => item.id)).toEqual(["paper-1"]);
    expect(selectScanSciPapers(papers, settings({ scansciScope: "all" })).map((item) => item.id)).toEqual(["paper-1", "paper-2", "paper-3"]);
  });
});
