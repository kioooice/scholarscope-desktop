import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchRequest } from "../types/athena";

const mocks = vi.hoisted(() => ({
  fetchScholarlyJson: vi.fn(),
  loadProviderSettings: vi.fn(),
}));

vi.mock("./scholarlyFetch", () => ({ fetchScholarlyJson: mocks.fetchScholarlyJson }));
vi.mock("./providerSettingsService", () => ({ loadProviderSettings: mocks.loadProviderSettings }));

import { semanticScholarService } from "./semanticScholarService";

function request(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    query: "zinc-nickel coating",
    type: "keywords",
    filters: { disciplines: [], openAccessOnly: false },
    ...overrides,
  };
}

describe("Semantic Scholar provider", () => {
  beforeEach(() => {
    mocks.fetchScholarlyJson.mockReset();
    mocks.loadProviderSettings.mockReset();
    mocks.loadProviderSettings.mockReturnValue({ semanticScholarApiKey: "" });
  });

  it("uses the DOI paper endpoint for exact DOI lookups", async () => {
    mocks.fetchScholarlyJson.mockResolvedValue({
      paperId: "paper-1",
      title: "A DOI result",
      externalIds: { DOI: "10.1234/a.b-c" },
    });

    const papers = await semanticScholarService.searchWorks(request({ query: "10.1234/a.b-c", type: "doi" }));

    expect(mocks.fetchScholarlyJson).toHaveBeenCalledOnce();
    expect(mocks.fetchScholarlyJson.mock.calls[0][0]).toContain("/paper/DOI:10.1234%2Fa.b-c?fields=");
    expect(papers).toHaveLength(1);
    expect(papers[0].doi).toBe("10.1234/a.b-c");
  });

  it("normalizes hyphenated keywords and passes supported filters", async () => {
    mocks.fetchScholarlyJson.mockResolvedValue({ data: [] });

    await semanticScholarService.searchWorks(request({
      filters: { disciplines: [], openAccessOnly: true, minCitations: 5, minYear: 2020 },
    }));

    const url = new URL(mocks.fetchScholarlyJson.mock.calls[0][0]);
    expect(url.searchParams.get("query")).toBe("zinc nickel coating");
    expect(url.searchParams.get("year")).toBe("2020-");
    expect(url.searchParams.get("minCitationCount")).toBe("5");
    expect(url.searchParams.get("openAccessPdf")).toBe("");
  });

  it("reports anonymous rate limiting without hiding the provider status", async () => {
    mocks.fetchScholarlyJson.mockRejectedValue(new Error("Provider request failed: 429"));

    await expect(semanticScholarService.searchWorks(request())).rejects.toThrow("匿名接口限流（429）");
  });
});
