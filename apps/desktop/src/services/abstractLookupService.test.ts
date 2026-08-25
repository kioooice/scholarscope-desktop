import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchScholarlyJson: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock("./scholarlyFetch", () => ({ fetchScholarlyJson: mocks.fetchScholarlyJson }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));

import { abstractLookupService, isPlaceholderAbstract, parseOpenAireAbstract } from "./abstractLookupService";

const response = {
  response: {
    results: {
      result: [{
        metadata: {
          "oaf:entity": {
            "oaf:result": {
              description: { $: "A real &amp; useful abstract." },
            },
          },
        },
      }],
    },
  },
};

describe("abstract fallback lookup", () => {
  beforeEach(() => {
    mocks.fetchScholarlyJson.mockReset();
    mocks.isTauri.mockReturnValue(false);
  });

  it("recognizes provider placeholder text", () => {
    expect(isPlaceholderAbstract("No abstract was provided by OpenAlex for this work.")).toBe(true);
    expect(isPlaceholderAbstract("A real abstract.")).toBe(false);
  });

  it("extracts and cleans an OpenAIRE description", () => {
    expect(parseOpenAireAbstract(response)).toBe("A real & useful abstract.");
  });

  it("uses the local development proxy in browser mode", async () => {
    mocks.fetchScholarlyJson.mockResolvedValue(response);

    const result = await abstractLookupService.findByDoi("10.5555/unique-abstract-test");

    expect(mocks.fetchScholarlyJson.mock.calls[0][0]).toBe("/api/openaire/search/publications?doi=10.5555%2Funique-abstract-test&format=json");
    expect(result).toEqual({ status: "found", abstract: "A real & useful abstract.", source: "OpenAIRE" });
  });
});
