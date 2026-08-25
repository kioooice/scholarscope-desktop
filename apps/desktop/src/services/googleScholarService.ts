import type { ExternalSearchLink } from "../types/athena";

export const googleScholarService = {
  searchLink(query: string): ExternalSearchLink {
    return {
      provider: "Google Scholar",
      label: "Open Google Scholar results",
      url: `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`,
      note: "Google Scholar does not provide an official public API, so Athena opens the same cleaned query as an external scholar search.",
    };
  },
};
