import type { AlternativePaper, Paper } from "../types/athena";

type UnpaywallBestLocation = {
  url?: string;
  url_for_pdf?: string;
  host_type?: string;
  license?: string;
};

type UnpaywallResult = {
  doi: string;
  title?: string;
  is_oa?: boolean;
  oa_status?: string;
  best_oa_location?: UnpaywallBestLocation;
  z_authors?: { given?: string; family?: string }[];
  year?: number;
};

const UNPAYWALL_EMAIL = "athena.scholar@example.com";

export const unpaywallService = {
  async lookupByDoi(doi: string): Promise<UnpaywallResult | null> {
    const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//i, "");
    const response = await fetch(`https://api.unpaywall.org/v2/${encodeURIComponent(cleanDoi)}?email=${UNPAYWALL_EMAIL}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Unpaywall lookup failed: ${response.status}`);
    return response.json();
  },

  async toAlternative(paper: Paper): Promise<AlternativePaper | null> {
    if (!paper.doi) return null;
    const result = await this.lookupByDoi(paper.doi);
    if (!result?.is_oa || !result.best_oa_location) return null;

    const authors =
      result.z_authors?.map((author) => [author.given, author.family].filter(Boolean).join(" ")).filter(Boolean) ?? [];

    return {
      id: `unpaywall-${paper.doi}`,
      title: result.title || paper.title,
      source: "Unpaywall",
      coverageEstimate: result.doi?.toLowerCase() === paper.doi.toLowerCase() ? 100 : 85,
      openAccessLink: result.best_oa_location.url_for_pdf || result.best_oa_location.url,
      doi: result.doi,
      authors,
      year: result.year,
      reason: `Legal ${result.oa_status ?? "open-access"} version from ${result.best_oa_location.host_type ?? "repository"}.`,
    };
  },
};
