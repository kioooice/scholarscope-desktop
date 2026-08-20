import { arxivService } from "./arxivService";
import { openAlexService } from "./openAlexService";
import { unpaywallService } from "./unpaywallService";
import type { AlternativePaper, Paper, SearchRequest } from "../types/athena";

function overlapScore(source: string[], target: string[]): number {
  const targetSet = new Set(target.map((item) => item.toLowerCase()));
  return source.filter((item) => targetSet.has(item.toLowerCase())).length;
}

function scoreAlternative(target: Paper, candidate: AlternativePaper): AlternativePaper {
  const sameDoi = target.doi && candidate.doi?.toLowerCase() === target.doi.toLowerCase();
  const sameTitle = candidate.title.toLowerCase() === target.title.toLowerCase();
  const authorOverlap = overlapScore(target.authors, candidate.authors);
  const recency = candidate.year ? Math.max(0, Math.min(12, candidate.year - 2012)) : 0;
  const coverageEstimate = sameDoi ? 100 : Math.min(94, candidate.coverageEstimate + (sameTitle ? 18 : 0) + authorOverlap * 6 + recency);
  return { ...candidate, coverageEstimate };
}

export const alternativeFinderService = {
  async findAlternatives(paper: Paper): Promise<AlternativePaper[]> {
    const alternatives: AlternativePaper[] = [];

    try {
      const unpaywall = await unpaywallService.toAlternative(paper);
      if (unpaywall) alternatives.push(unpaywall);
    } catch {
      // Network failures are expected offline; the UI reports zero alternatives.
    }

    try {
      const request: SearchRequest = {
        query: [paper.title, ...paper.concepts.slice(0, 3)].join(" "),
        type: "keywords",
        filters: { disciplines: [], openAccessOnly: true },
      };
      const openAlex = await openAlexService.searchWorks(request);
      alternatives.push(
        ...openAlex
          .filter((candidate) => candidate.id !== paper.id && candidate.isOpenAccess)
          .slice(0, 5)
          .map((candidate) => ({
            id: candidate.id,
            title: candidate.title,
            source: "OpenAlex" as const,
            coverageEstimate: 58 + overlapScore(paper.concepts, candidate.concepts) * 6,
            openAccessLink: candidate.pdfUrl || candidate.oaUrl || candidate.publisherUrl,
            doi: candidate.doi,
            authors: candidate.authors,
            year: candidate.year,
            reason: "Open-access work with shared title terms, concepts, or authors.",
          })),
      );
    } catch {
      // Fall through to arXiv results.
    }

    try {
      alternatives.push(...(await arxivService.findSimilar(paper)));
    } catch {
      // No fallback data: alternatives must come from real providers.
    }

    const deduped = Array.from(new Map(alternatives.map((item) => [item.openAccessLink || item.title, scoreAlternative(paper, item)])).values());
    return deduped.sort((a, b) => b.coverageEstimate - a.coverageEstimate).slice(0, 8);
  },
};
