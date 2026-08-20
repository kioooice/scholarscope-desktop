import type { Paper, QualityAssessment, QualitySignal, QualityStatus } from "../types/athena";

const currentYear = new Date().getFullYear();

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function labelFromScore(score: number): QualityStatus {
  if (score >= 75) return "strong";
  if (score >= 52) return "moderate";
  if (score > 0) return "weak";
  return "unknown";
}

function signal(status: QualityStatus, label: string, detail: string): QualitySignal {
  return { status, label, detail };
}

function journalSignal(paper: Paper): { signal: QualitySignal; score: number } {
  if (paper.sourceProvider === "arXiv") {
    return { signal: signal("moderate", "Preprint", "arXiv preprints can be useful but are not journal peer review by themselves."), score: 48 };
  }
  if (paper.journal || paper.publisher) {
    return { signal: signal("moderate", paper.journal || paper.publisher || "Indexed source", "A journal or publisher venue is present; reputation is not fully verified locally."), score: 64 };
  }
  return { signal: signal("unknown", "Venue unknown", "No journal or publisher metadata was returned."), score: 28 };
}

function citationSignal(paper: Paper): { signal: QualitySignal; score: number } {
  if (paper.citationCount >= 250) return { signal: signal("strong", "Highly cited", `${paper.citationCount.toLocaleString()} citations returned by provider metadata.`), score: 88 };
  if (paper.citationCount >= 50) return { signal: signal("moderate", "Well cited", `${paper.citationCount.toLocaleString()} citations returned by provider metadata.`), score: 70 };
  if (paper.citationCount > 0) return { signal: signal("weak", "Low citation count", `${paper.citationCount.toLocaleString()} citations; this may reflect recency or niche scope.`), score: 45 };
  return { signal: signal("unknown", "No citation count", "No citation count was returned by this provider."), score: 30 };
}

function recencySignal(paper: Paper): { signal: QualitySignal; score: number } {
  if (!paper.year) return { signal: signal("unknown", "Year unknown", "No publication year was returned."), score: 30 };
  const age = currentYear - paper.year;
  if (age <= 5) return { signal: signal("strong", "Recent", `Published ${paper.year}; within the last five years.`), score: 86 };
  if (age <= 12) return { signal: signal("moderate", "Established", `Published ${paper.year}; not recent but still useful for background.`), score: 64 };
  return { signal: signal("weak", "Older source", `Published ${paper.year}; check whether newer research has changed the conclusion.`), score: 42 };
}

function methodologySignal(abstract: string): { signal: QualitySignal; score: number } {
  const text = abstract.toLowerCase();
  if (/\b(systematic review|meta-analysis|randomi[sz]ed|controlled trial)\b/.test(text)) {
    return { signal: signal("strong", "Strong study design", "Abstract mentions systematic review, meta-analysis, randomized, or controlled design."), score: 86 };
  }
  if (/\b(experiment|experimental|simulation|model|kinetic|thermodynamic|cohort|survey|case-control|observational)\b/.test(text)) {
    return { signal: signal("moderate", "Method present", "Abstract mentions a recognizable method or study design."), score: 66 };
  }
  if (abstract.startsWith("No abstract")) return { signal: signal("unknown", "No abstract", "Methodology cannot be assessed without an abstract or full text."), score: 24 };
  return { signal: signal("weak", "Method unclear", "The returned abstract does not clearly describe methodology."), score: 40 };
}

function sampleSizeSignal(abstract: string): { signal: QualitySignal; score: number } {
  const match = abstract.match(/\b(?:n\s?=\s?|sample(?: size)? of |participants?|patients?|subjects?|specimens?|experiments?)\s?(\d{2,6})\b/i);
  if (match?.[1]) {
    const size = Number(match[1]);
    if (size >= 200) return { signal: signal("strong", "Sample size reported", `Sample size signal found: ${size.toLocaleString()}.`), score: 82 };
    return { signal: signal("moderate", "Sample size reported", `Sample size signal found: ${size.toLocaleString()}; judge against the method and field.`), score: 62 };
  }
  if (/\b(laboratory|catalyst|reaction|equilibrium|simulation|model)\b/i.test(abstract)) {
    return { signal: signal("unknown", "Not directly applicable", "A human sample size may not apply; check experiment count or model validation in the full paper."), score: 48 };
  }
  return { signal: signal("unknown", "Sample size not found", "No sample size was detected in the returned abstract."), score: 34 };
}

function disclosureSignal(abstract: string, kind: "conflicts" | "funding"): { signal: QualitySignal; score: number } {
  const text = abstract.toLowerCase();
  if (kind === "conflicts") {
    if (/\b(conflict of interest|competing interest|no competing|no conflict)\b/.test(text)) {
      return { signal: signal("moderate", "Conflict statement found", "The abstract text includes a conflict or competing-interest statement."), score: 64 };
    }
    return { signal: signal("unknown", "Conflicts not reported", "No conflict-of-interest statement was detected in the returned metadata."), score: 42 };
  }
  if (/\b(funding|funded by|grant|supported by|financial support)\b/.test(text)) {
    return { signal: signal("moderate", "Funding signal found", "The abstract text includes funding or grant language."), score: 64 };
  }
  return { signal: signal("unknown", "Funding not reported", "No funding statement was detected in the returned metadata."), score: 42 };
}

function limitationsFor(assessment: Omit<QualityAssessment, "limitations">): string[] {
  const limitations: string[] = [];
  if (assessment.methodology.status === "weak" || assessment.methodology.status === "unknown") limitations.push("Methodology is unclear from returned metadata.");
  if (assessment.sampleSize.status === "unknown") limitations.push("Sample size or experiment count was not available in metadata.");
  if (assessment.conflicts.status === "unknown") limitations.push("Conflict-of-interest disclosure was not found in metadata.");
  if (assessment.funding.status === "unknown") limitations.push("Funding disclosure was not found in metadata.");
  if (assessment.recency.status === "weak") limitations.push("Older source; compare with recent literature.");
  return limitations.slice(0, 4);
}

export function assessPaperQuality(paper: Paper): QualityAssessment {
  const journal = journalSignal(paper);
  const citations = citationSignal(paper);
  const recency = recencySignal(paper);
  const methodology = methodologySignal(paper.abstract);
  const sampleSize = sampleSizeSignal(paper.abstract);
  const conflicts = disclosureSignal(paper.abstract, "conflicts");
  const funding = disclosureSignal(paper.abstract, "funding");
  const overallScore = clampScore(
    journal.score * 0.16 +
      citations.score * 0.16 +
      recency.score * 0.14 +
      methodology.score * 0.22 +
      sampleSize.score * 0.12 +
      conflicts.score * 0.1 +
      funding.score * 0.1,
  );
  const partial = {
    overallScore,
    overallLabel: labelFromScore(overallScore),
    journal: journal.signal,
    citations: citations.signal,
    recency: recency.signal,
    methodology: methodology.signal,
    sampleSize: sampleSize.signal,
    conflicts: conflicts.signal,
    funding: funding.signal,
  };
  return { ...partial, limitations: limitationsFor(partial) };
}
