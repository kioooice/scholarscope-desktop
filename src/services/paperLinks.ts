import type { Paper } from "../types/athena";

export function getPaperLandingUrl(paper: Paper): string | undefined {
  if (paper.publisherUrl) return paper.publisherUrl;
  if (paper.oaUrl) return paper.oaUrl;
  if (paper.pdfUrl) return paper.pdfUrl;
  if (paper.doi) return `https://doi.org/${paper.doi}`;
  if (paper.openalexId) return paper.openalexId;
  return undefined;
}

export function getPaperDownloadUrl(paper: Paper): string | undefined {
  return paper.pdfUrl;
}
