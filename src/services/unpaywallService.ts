import { isTauri } from "@tauri-apps/api/core";
import type { AlternativePaper, Paper, SearchRequest } from "../types/athena";
import { loadProviderSettings } from "./providerSettingsService";
import { fetchScholarlyJson } from "./scholarlyFetch";

type UnpaywallBestLocation = {
  url?: string;
  url_for_pdf?: string;
  url_for_landing_page?: string;
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

export type OpenAccessLookupResult = {
  status: "found" | "not-found";
  provider: "Unpaywall";
  url?: string;
  isPdf?: boolean;
  license?: string;
  reason?: "missing-doi" | "missing-email" | "not-open";
};

export type OpenAccessFallbackLink = {
  provider: "CORE" | "BASE";
  url: string;
};

const CACHE_TTL_MS = 30 * 60 * 1000;
const lookupCache = new Map<string, { expiresAt: number; result: OpenAccessLookupResult }>();

function cleanDoi(value: string): string {
  return value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim().toLowerCase();
}

function unpaywallEmail(): string {
  return loadProviderSettings().crossrefEmail.trim();
}

function lookupEndpoint(doi: string): string {
  const path = `/v2/${encodeURIComponent(doi)}`;
  return isTauri() ? `https://api.unpaywall.org${path}` : `/api/unpaywall${path}`;
}

function bestOpenUrl(location?: UnpaywallBestLocation): string | undefined {
  return location?.url_for_pdf || location?.url_for_landing_page || location?.url;
}

export function openAccessFallbackLinks(paper: Pick<Paper, "title" | "doi">): OpenAccessFallbackLink[] {
  const query = [`"${paper.title}"`, paper.doi].filter(Boolean).join(" ");
  return [
    { provider: "CORE", url: `https://core.ac.uk/search?q=${encodeURIComponent(query)}` },
    { provider: "BASE", url: `https://www.base-search.net/Search/Results?lookfor=${encodeURIComponent(query)}&type=all&oaboost=1` },
  ];
}

export const unpaywallService = {
  async lookupByDoi(doi: string): Promise<UnpaywallResult | null> {
    const normalizedDoi = cleanDoi(doi);
    const email = unpaywallEmail();
    if (!email) return null;
    try {
      return await fetchScholarlyJson<UnpaywallResult>(
        `${lookupEndpoint(normalizedDoi)}?email=${encodeURIComponent(email)}`,
      );
    } catch (error) {
      if (error instanceof Error && /404|not found/i.test(error.message)) return null;
      throw error;
    }
  },

  async findOpenAccessVersion(paper: Pick<Paper, "doi">): Promise<OpenAccessLookupResult> {
    if (!paper.doi) {
      return { status: "not-found", provider: "Unpaywall", reason: "missing-doi" };
    }
    if (!unpaywallEmail()) {
      return { status: "not-found", provider: "Unpaywall", reason: "missing-email" };
    }

    const doi = cleanDoi(paper.doi);
    const cached = lookupCache.get(doi);
    if (cached && cached.expiresAt > Date.now()) return cached.result;

    const payload = await this.lookupByDoi(doi);
    const url = bestOpenUrl(payload?.best_oa_location);
    const result: OpenAccessLookupResult = payload?.is_oa && url
      ? {
          status: "found",
          provider: "Unpaywall",
          url,
          isPdf: Boolean(payload.best_oa_location?.url_for_pdf && url === payload.best_oa_location.url_for_pdf),
          license: payload.best_oa_location?.license,
        }
      : { status: "not-found", provider: "Unpaywall", reason: "not-open" };

    lookupCache.set(doi, { expiresAt: Date.now() + CACHE_TTL_MS, result });
    return result;
  },

  async searchWorks(request: SearchRequest): Promise<Paper[]> {
    if (request.type !== "doi" || !unpaywallEmail()) return [];
    const result = await this.lookupByDoi(request.query);
    const url = bestOpenUrl(result?.best_oa_location);
    if (!result?.is_oa || !result.doi || !url) return [];

    const doi = cleanDoi(result.doi);
    const authors = result.z_authors?.map((author) => [author.given, author.family].filter(Boolean).join(" ")).filter(Boolean) as string[] ?? [];
    const isPdf = Boolean(result.best_oa_location?.url_for_pdf && url === result.best_oa_location.url_for_pdf);
    return [{
      id: `unpaywall:${doi}`,
      doi,
      title: result.title || `Open-access version for ${doi}`,
      authors,
      abstract: "No abstract was provided by Unpaywall for this work.",
      year: result.year,
      publisher: result.best_oa_location?.host_type || "Open-access repository",
      citationCount: 0,
      publisherUrl: url,
      oaUrl: url,
      pdfUrl: isPdf ? url : undefined,
      isOpenAccess: true,
      sourceProvider: "Unpaywall",
      concepts: [],
      topics: [],
      keywords: [],
      references: [],
      relatedPapers: [],
    }];
  },

  async toAlternative(paper: Paper): Promise<AlternativePaper | null> {
    if (!paper.doi || !unpaywallEmail()) return null;
    const result = await this.lookupByDoi(paper.doi);
    if (!result?.is_oa || !result.best_oa_location) return null;

    const authors =
      result.z_authors?.map((author) => [author.given, author.family].filter(Boolean).join(" ")).filter(Boolean) ?? [];

    return {
      id: `unpaywall-${paper.doi}`,
      title: result.title || paper.title,
      source: "Unpaywall",
      coverageEstimate: result.doi?.toLowerCase() === paper.doi.toLowerCase() ? 100 : 85,
      openAccessLink: bestOpenUrl(result.best_oa_location),
      doi: result.doi,
      authors,
      year: result.year,
      reason: `Legal ${result.oa_status ?? "open-access"} version from ${result.best_oa_location.host_type ?? "repository"}.`,
    };
  },
};
