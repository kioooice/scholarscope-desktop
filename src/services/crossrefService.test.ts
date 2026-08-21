import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchRequest } from "../types/athena";

const mocks = vi.hoisted(() => ({
  fetchScholarlyJson: vi.fn(),
  loadProviderSettings: vi.fn(),
}));

vi.mock("./scholarlyFetch", () => ({ fetchScholarlyJson: mocks.fetchScholarlyJson }));
vi.mock("./providerSettingsService", () => ({ loadProviderSettings: mocks.loadProviderSettings }));

import { crossrefService } from "./crossrefService";

const request: SearchRequest = {
  query: "10.1234/example",
  type: "doi",
  filters: { disciplines: [], openAccessOnly: false },
};

describe("Crossref provider", () => {
  beforeEach(() => {
    mocks.fetchScholarlyJson.mockReset();
    mocks.loadProviderSettings.mockReset();
    mocks.loadProviderSettings.mockReturnValue({ crossrefEmail: "research@example.org" });
    mocks.fetchScholarlyJson.mockResolvedValue({ message: { items: [] } });
  });

  it("uses exact DOI filtering for DOI queries", async () => {
    await crossrefService.searchWorks(request);

    expect(mocks.fetchScholarlyJson).toHaveBeenCalledWith(expect.stringContaining("filter=doi%3A10.1234%2Fexample"));
    expect(mocks.fetchScholarlyJson.mock.calls[0][0]).not.toContain("query.bibliographic");
  });
});
