import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchScholarlyJson: vi.fn(),
  loadProviderSettings: vi.fn(),
}));

vi.mock("./scholarlyFetch", () => ({
  fetchScholarlyJson: mocks.fetchScholarlyJson,
}));

vi.mock("./providerSettingsService", () => ({
  loadProviderSettings: mocks.loadProviderSettings,
}));

import { openAccessFallbackLinks, unpaywallService } from "./unpaywallService";

describe("open-access lookup", () => {
  beforeEach(() => {
    mocks.fetchScholarlyJson.mockReset();
    mocks.loadProviderSettings.mockReset();
    mocks.loadProviderSettings.mockReturnValue({ crossrefEmail: "research@example.org" });
  });

  it("returns the best Unpaywall PDF for an exact DOI", async () => {
    mocks.fetchScholarlyJson.mockResolvedValue({
      doi: "10.1234/example.oa",
      is_oa: true,
      best_oa_location: {
        url_for_pdf: "https://repository.example.org/paper.pdf",
        url_for_landing_page: "https://repository.example.org/paper",
        license: "cc-by",
      },
    });

    const result = await unpaywallService.findOpenAccessVersion({ doi: "https://doi.org/10.1234/example.oa" });

    expect(result).toMatchObject({
      status: "found",
      provider: "Unpaywall",
      url: "https://repository.example.org/paper.pdf",
      isPdf: true,
      license: "cc-by",
    });
    expect(mocks.fetchScholarlyJson).toHaveBeenCalledWith(expect.stringContaining("10.1234%2Fexample.oa"));
  });

  it("does not call Unpaywall when the paper has no DOI", async () => {
    await expect(unpaywallService.findOpenAccessVersion({})).resolves.toMatchObject({
      status: "not-found",
      reason: "missing-doi",
    });
    expect(mocks.fetchScholarlyJson).not.toHaveBeenCalled();
  });

  it("does not call Unpaywall without a configured contact email", async () => {
    mocks.loadProviderSettings.mockReturnValue({ crossrefEmail: "" });

    await expect(unpaywallService.findOpenAccessVersion({ doi: "10.1234/example.closed" })).resolves.toMatchObject({
      status: "not-found",
      reason: "missing-email",
    });
    expect(mocks.fetchScholarlyJson).not.toHaveBeenCalled();
  });

  it("builds fallback searches in the configured discovery order", () => {
    const links = openAccessFallbackLinks({ title: "A precise paper title", doi: "10.1000/test" });

    expect(links.map((link) => link.provider)).toEqual(["CORE", "BASE", "Google Scholar", "Zenodo", "HAL"]);
    expect(links.every((link) => decodeURIComponent(link.url).includes("A precise paper title"))).toBe(true);
    expect(links.every((link) => !/lens/i.test(link.url))).toBe(true);
    expect(links[3].url).toContain("zenodo.org/search?q=");
    expect(links[4].url).toContain("hal.science/search/index/?q=");
  });
});
