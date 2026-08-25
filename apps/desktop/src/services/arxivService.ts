import type { AlternativePaper, Paper } from "../types/athena";
import { fetchScholarlyText } from "./scholarlyFetch";

function textContent(entry: Element, selector: string): string {
  return entry.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function authors(entry: Element): string[] {
  return Array.from(entry.querySelectorAll("author > name"))
    .map((node) => node.textContent?.trim())
    .filter(Boolean) as string[];
}

export const arxivService = {
  async search(query: string): Promise<AlternativePaper[]> {
    const xml = await fetchScholarlyText(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=8&sortBy=relevance`);
    const document = new DOMParser().parseFromString(xml, "application/xml");
    return Array.from(document.querySelectorAll("entry")).map((entry) => {
      const id = textContent(entry, "id");
      const title = textContent(entry, "title");
      const published = textContent(entry, "published");
      const pdf = Array.from(entry.querySelectorAll("link")).find((link) => link.getAttribute("title") === "pdf");
      return {
        id,
        title,
        source: "arXiv",
        coverageEstimate: 62,
        openAccessLink: pdf?.getAttribute("href") ?? id,
        authors: authors(entry),
        year: published ? Number(published.slice(0, 4)) : undefined,
        reason: "Preprint surfaced by arXiv relevance search.",
      };
    });
  },

  async findSimilar(paper: Paper): Promise<AlternativePaper[]> {
    const terms = [paper.title, ...paper.concepts.slice(0, 2), ...paper.authors.slice(0, 1)].join(" ");
    return this.search(terms);
  },
};
