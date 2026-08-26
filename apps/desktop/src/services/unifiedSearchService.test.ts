import { describe, expect, it } from "vitest";
import type { Paper, SearchSource } from "../types/scholarscope";
import { mergeAndRank, normalizeTitle } from "./unifiedSearchService";

function paper(sourceProvider: SearchSource, overrides: Partial<Paper> = {}): Paper {
  return {
    id: `${sourceProvider}-${Math.random()}`,
    title: "Secondary current distribution in a Hull cell",
    authors: ["A. Researcher"],
    abstract: "No abstract was provided for this work.",
    year: 2002,
    journal: "Journal of Applied Electrochemistry",
    citationCount: 4,
    isOpenAccess: false,
    sourceProvider,
    concepts: [],
    topics: [],
    keywords: [],
    references: [],
    relatedPapers: [],
    ...overrides,
  };
}

const filters = { disciplines: [], openAccessOnly: false };

describe("unified literature merge", () => {
  it("normalizes punctuation and accents in titles", () => {
    expect(normalizeTitle("Wagner’s Electro-déposition: Part II")).toBe("wagner s electro deposition part ii");
  });

  it("merges DOI matches and keeps the richer metadata", () => {
    const results = mergeAndRank([
      paper("Crossref", { doi: "10.1000/ABC", publisherUrl: "https://doi.org/10.1000/ABC" }),
      paper("OpenAlex", {
        doi: "https://doi.org/10.1000/abc",
        abstract: "This detailed abstract explains secondary current distribution in recessed geometries.",
        citationCount: 42,
        isOpenAccess: true,
        oaUrl: "https://example.org/article",
      }),
    ], "secondary current distribution", filters);

    expect(results).toHaveLength(1);
    expect(results[0].sourceProviders).toEqual(["Crossref", "OpenAlex"]);
    expect(results[0].citationCount).toBe(42);
    expect(results[0].abstract).toContain("detailed abstract");
    expect(results[0].isOpenAccess).toBe(true);
  });

  it("merges exact normalized titles when DOI is missing", () => {
    const results = mergeAndRank([
      paper("Crossref"),
      paper("OpenAlex", { title: "Secondary current distribution—in a Hull cell" }),
    ], "Hull cell", filters);

    expect(results).toHaveLength(1);
    expect(results[0].sourceProviders).toHaveLength(2);
  });

  it("applies open-access filtering after sources are merged", () => {
    const results = mergeAndRank([
      paper("Crossref", { doi: "10.1000/abc" }),
      paper("OpenAlex", { doi: "10.1000/abc", isOpenAccess: true }),
      paper("OpenAlex", { doi: "10.1000/closed", title: "Closed paper" }),
    ], "current distribution", { ...filters, openAccessOnly: true });

    expect(results).toHaveLength(1);
    expect(results[0].doi).toBe("10.1000/abc");
  });

  it("prefers an exact title over a longer title containing the same query", () => {
    const results = mergeAndRank([
      paper("Crossref", {
        title: "Alkaline Noncyanide Zinc Plating with Reuse of Recovered Chemicals",
        abstract: "A detailed abstract is available for this related title.",
      }),
      paper("OpenAlex", {
        title: "Alkaline noncyanide zinc plating",
        citationCount: 10,
      }),
    ], "Alkaline noncyanide zinc plating", filters);

    expect(results[0].title).toBe("Alkaline noncyanide zinc plating");
    expect(results[0].relevanceScore).toBeGreaterThan(results[1].relevanceScore);
  });
});
