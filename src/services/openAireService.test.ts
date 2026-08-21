import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchRequest } from "../types/athena";

const mocks = vi.hoisted(() => ({
  fetchScholarlyJson: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock("./scholarlyFetch", () => ({ fetchScholarlyJson: mocks.fetchScholarlyJson }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));

import { openAireService } from "./openAireService";

const request: SearchRequest = {
  query: "secondary current distribution",
  type: "keywords",
  filters: { disciplines: [], openAccessOnly: false },
};

describe("OpenAIRE provider", () => {
  beforeEach(() => {
    mocks.fetchScholarlyJson.mockReset();
    mocks.isTauri.mockReturnValue(false);
  });

  it("maps publication metadata and abstracts from a keyword search", async () => {
    mocks.fetchScholarlyJson.mockResolvedValue({
      response: {
        results: {
          result: [{
            metadata: {
              "oaf:entity": {
                "oaf:result": {
                  pid: { $: "10.1234/example" },
                  title: [{ $: "A paper from OpenAIRE" }],
                  description: { $: "An abstract from the repository graph." },
                  creator: [{ $: "A. Researcher" }],
                  relevantdate: { $: "2024-01-01" },
                  publisher: { $: "Example Publisher" },
                  measure: [{ "@id": "citationCount", $: "7" }],
                  bestaccessright: { "@classid": "OPEN" },
                  children: { instance: { url: { $: "https://repository.example/paper.pdf" } } },
                },
              },
            },
          }],
        },
      },
    });

    const papers = await openAireService.searchWorks(request);

    expect(mocks.fetchScholarlyJson).toHaveBeenCalledWith(
      "/api/openaire/search/publications?format=json&page=1&size=12&keywords=secondary+current+distribution",
    );
    expect(papers[0]).toMatchObject({
      sourceProvider: "OpenAIRE",
      doi: "10.1234/example",
      title: "A paper from OpenAIRE",
      abstract: "An abstract from the repository graph.",
      citationCount: 7,
      isOpenAccess: true,
      pdfUrl: "https://repository.example/paper.pdf",
    });
  });

  it("skips the incompatible keyword endpoint for Chinese queries", async () => {
    const papers = await openAireService.searchWorks({ ...request, query: "碱性无氰镀锌" });

    expect(papers).toEqual([]);
    expect(mocks.fetchScholarlyJson).not.toHaveBeenCalled();
  });
});
