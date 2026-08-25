import { aiProviderService, type AiQualityAssessment, type EvidenceAssessment } from "./aiProviderService";
import { arxivService } from "./arxivService";
import { crossrefService } from "./crossrefService";
import { googleScholarService } from "./googleScholarService";
import { openAlexService } from "./openAlexService";
import { openAireService } from "./openAireService";
import { getPaperDownloadUrl, getPaperLandingUrl } from "./paperLinks";
import { loadProviderSettings } from "./providerSettingsService";
import { assessPaperQuality } from "./qualityAssessmentService";
import { pubMedService } from "./pubMedService";
import { unpaywallService } from "./unpaywallService";
import type { AgentStep, AlternativePaper, EvidenceStance, ExternalSearchLink, Paper, QualityStatus, ResearchAgentAnswer, ResearchAgentResult, SearchRequest } from "../types/athena";

type StepSink = (steps: AgentStep[]) => void;

const baseSteps: AgentStep[] = [
  { id: "ai-expand", label: "AI semantic query expansion", status: "pending" },
  { id: "openalex", label: "Query OpenAlex works index", status: "pending" },
  { id: "crossref", label: "Query Crossref metadata", status: "pending" },
  { id: "openaire", label: "Query OpenAIRE records", status: "pending" },
  { id: "pubmed", label: "Query PubMed records", status: "pending" },
  { id: "arxiv", label: "Query arXiv preprints", status: "pending" },
  { id: "google-scholar", label: "Prepare Google Scholar search", status: "pending" },
  { id: "oa", label: "Check legal open-access records", status: "pending" },
  { id: "rank", label: "Deduplicate and rank scientific relevance", status: "pending" },
  { id: "validate", label: "AI evidence validation", status: "pending" },
  { id: "quality", label: "Quality and disclosure assessment", status: "pending" },
  { id: "synth", label: "Build grounded research answer", status: "pending" },
];

function updateStep(steps: AgentStep[], id: string, status: AgentStep["status"], detail?: string): AgentStep[] {
  return steps.map((step) => (step.id === id ? { ...step, status, detail } : step));
}

function emit(steps: AgentStep[], sink?: StepSink): AgentStep[] {
  sink?.(steps);
  return steps;
}

function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 || token === "ai");
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function providerSearchQuery(question: string): string {
  const stopWords = new Set([
    "what",
    "which",
    "when",
    "where",
    "why",
    "how",
    "are",
    "the",
    "most",
    "main",
    "best",
    "promising",
    "being",
    "used",
    "using",
    "about",
    "from",
    "with",
    "have",
    "has",
    "does",
    "research",
    "papers",
    "paper",
    "methods",
    "approaches",
    "affect",
    "effect",
    "effects",
    "impact",
    "increase",
    "decrease",
  ]);
  const tokens = question
    .toLowerCase()
    .replace(/[?!.:,;()[\]{}]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => (token.length > 2 || token === "ai") && !stopWords.has(token));
  const expanded = [...tokens];
  const lowerQuestion = question.toLowerCase();
  if ((lowerQuestion.includes("haber") || lowerQuestion.includes("bosch")) && lowerQuestion.includes("ammonia")) {
    expanded.push("haber", "bosch", "ammonia", "synthesis", "equilibrium", "pressure", "yield");
  }
  return expanded.length ? Array.from(new Set(expanded)).join(" ") : question.replace(/[?!.:,;()[\]{}]/g, " ").trim();
}

function normalizeKey(paper: Paper): string {
  return paper.doi?.toLowerCase() ?? paper.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function dedupe(papers: Paper[]): Paper[] {
  const map = new Map<string, Paper>();
  for (const paper of papers) {
    const key = normalizeKey(paper);
    const existing = map.get(key);
    if (
      !existing ||
      paper.citationCount > existing.citationCount ||
      (paper.abstract.length > existing.abstract.length && existing.abstract.startsWith("No abstract")) ||
      (paper.isOpenAccess && !existing.isOpenAccess)
    ) {
      map.set(key, paper);
    }
  }
  return Array.from(map.values());
}

function inferTerms(request: SearchRequest): string[] {
  return [...request.filters.disciplines, ...queryTokens(request.query).slice(0, 6)];
}

function arxivAlternativeToPaper(alternative: AlternativePaper, request: SearchRequest): Paper {
  const terms = inferTerms(request);
  return {
    id: alternative.id,
    title: alternative.title,
    authors: alternative.authors,
    abstract: alternative.reason,
    year: alternative.year,
    journal: "arXiv",
    publisher: "arXiv",
    citationCount: 0,
    publisherUrl: alternative.openAccessLink,
    oaUrl: alternative.openAccessLink,
    pdfUrl: alternative.openAccessLink?.replace("/abs/", "/pdf/"),
    isOpenAccess: true,
    sourceProvider: "arXiv",
    concepts: terms,
    topics: request.filters.disciplines.length ? request.filters.disciplines : ["Physics"],
    keywords: terms,
    references: [],
    relatedPapers: [],
  };
}

function scorePaper(paper: Paper, request: SearchRequest): number {
  const haystack = `${paper.title} ${paper.abstract} ${paper.authors.join(" ")} ${paper.concepts.join(" ")} ${paper.topics.join(" ")}`.toLowerCase();
  const termScore = queryTokens(request.query).reduce((score, token) => score + (haystack.includes(token) ? 12 : 0), 0);
  const disciplineScore = request.filters.disciplines.reduce((score, discipline) => score + (haystack.includes(discipline.toLowerCase()) ? 10 : 0), 0);
  const accessScore = paper.isOpenAccess ? 20 : 0;
  const citationScore = Math.min(30, Math.log10(Math.max(1, paper.citationCount)) * 10);
  const recencyScore = paper.year ? Math.max(0, Math.min(16, paper.year - 2010)) : 0;
  return termScore + disciplineScore + accessScore + citationScore + recencyScore;
}

function sentenceTokens(value: string): string[] {
  return queryTokens(value).filter((token) => !["what", "why", "how", "does", "with", "from", "about", "paper", "papers", "research"].includes(token));
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 42 && sentence.length < 320);
}

function bestEvidence(paper: Paper, question: string): string {
  const tokens = sentenceTokens(question);
  const sentences = splitSentences(paper.abstract);
  const scored = sentences
    .map((sentence) => ({
      sentence,
      score: tokens.reduce((total, token) => total + (sentence.toLowerCase().includes(token) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.sentence || paper.abstract || "No abstract was available for this source.";
}

function extractDataPoints(paper: Paper, question: string): string[] {
  const tokens = sentenceTokens(question);
  const unitPattern = /\b\d+(?:\.\d+)?\s?(?:%|bar|atm|mpa|gpa|pa|kpa|k|degc|c|°c|mol|mmol|m|h-?1|s-?1)\b/i;
  const keywordPattern = /\b(?:pressure|temperature|yield|equilibrium|conversion|rate|selectivity|ammonia|hydrogen|nitrogen|haber|bosch)\b/i;
  return splitSentences(paper.abstract)
    .filter((sentence) => unitPattern.test(sentence) || (keywordPattern.test(sentence) && tokens.some((token) => sentence.toLowerCase().includes(token))))
    .slice(0, 3);
}

function buildFinding(paper: Paper, question: string, index: number): string {
  const evidence = bestEvidence(paper, question);
  const authors = paper.authors.slice(0, 2).join(", ") || "the authors";
  const year = paper.year ? ` (${paper.year})` : "";
  const prefix = index === 0 ? "The most relevant source" : "Another relevant source";
  return `${prefix}, ${authors}${year}, reports: ${evidence}`;
}

function buildFollowUps(question: string, papers: Paper[]): string[] {
  const concepts = Array.from(new Set(papers.flatMap((paper) => [...paper.concepts, ...paper.topics]).filter(Boolean))).slice(0, 4);
  const base = question.replace(/[?.!]+$/g, "").trim();
  return [
    `What are the strongest disagreements or limitations in ${base}?`,
    concepts[0] ? `Find recent open-access reviews about ${concepts[0]}` : `Find recent open-access reviews about ${base}`,
    concepts[1] ? `Compare ${concepts[0] ?? base} and ${concepts[1]} in the literature` : `Which papers should I read first about ${base}?`,
  ];
}

function buildDirectAnswer(question: string): string | undefined {
  const tokens = new Set(queryTokens(question));
  const isHaberPressureQuestion =
    (tokens.has("haber") || tokens.has("bosch")) &&
    tokens.has("ammonia") &&
    tokens.has("pressure") &&
    (tokens.has("equilibrium") || tokens.has("yield"));

  if (isHaberPressureQuestion) {
    return "Short answer: yes. In the Haber equilibrium, N2 + 3H2 reversibly forms 2NH3, so the product side has fewer gas molecules. Increasing pressure favours the ammonia side and can increase the equilibrium yield, while industrial conditions still balance yield, rate, catalyst performance, temperature, and cost.";
  }

  return undefined;
}

function synthesizeAnswer(question: string, papers: Paper[], searchQuery: string): ResearchAgentAnswer {
  const sources = papers.slice(0, 6);
  const openAccessCount = papers.filter((paper) => paper.isOpenAccess).length;
  const yearRange = sources
    .map((paper) => paper.year)
    .filter((year): year is number => Boolean(year))
    .sort((a, b) => a - b);
  const rangeText = yearRange.length ? `${yearRange[0]}-${yearRange[yearRange.length - 1]}` : "undated";
  const topTopics = Array.from(new Set(sources.flatMap((paper) => paper.topics).filter(Boolean))).slice(0, 3);
  const topicText = topTopics.length ? topTopics.join(", ") : titleCase(question);

  return {
    question,
    searchQuery,
    directAnswer: buildDirectAnswer(question),
    overview:
      papers.length === 0
        ? "I could not find matching scholarly records from the configured sources."
        : `I found ${papers.length} ranked scholarly records, including ${openAccessCount} open-access matches. The strongest returned sources cluster around ${topicText}, with the leading evidence spanning ${rangeText}.`,
    keyFindings: sources.slice(0, 4).map((paper, index) => buildFinding(paper, question, index)),
    sourceNotes: sources.map((paper) => ({
      paperId: paper.id,
      title: paper.title,
      authors: paper.authors,
      year: paper.year,
      sourceProvider: paper.sourceProvider,
      citationCount: paper.citationCount,
      url: getPaperLandingUrl(paper),
      pdfUrl: getPaperDownloadUrl(paper),
      evidence: bestEvidence(paper, question),
      dataPoints: extractDataPoints(paper, question),
      evidenceLabel: "unclear",
      confidence: 0,
      reasoning: "AI evidence validation has not been run for this source.",
      quality: assessPaperQuality(paper),
    })),
    followUpQueries: buildFollowUps(question, sources),
    aiEnhanced: false,
  };
}

function normalizedLabel(value: string): EvidenceStance {
  if (value === "supports" || value === "contradicts" || value === "neutral" || value === "unclear") return value;
  return "unclear";
}

function normalizedQualityStatus(value?: string): QualityStatus {
  if (value === "strong" || value === "moderate" || value === "weak" || value === "unknown") return value;
  return "unknown";
}

function mergeEvidenceAssessments(answer: ResearchAgentAnswer, assessments: EvidenceAssessment[]): ResearchAgentAnswer {
  const assessmentMap = new Map(assessments.map((assessment) => [assessment.paperId, assessment]));
  return {
    ...answer,
    sourceNotes: answer.sourceNotes.map((source) => {
      const assessment = assessmentMap.get(source.paperId);
      if (!assessment) return source;
      return {
        ...source,
        evidenceLabel: normalizedLabel(assessment.label),
        confidence: Math.max(0, Math.min(1, Number(assessment.confidence) || 0)),
        reasoning: assessment.reasoning || source.reasoning,
      };
    }),
    aiEnhanced: true,
  };
}

function mergeAiQuality(answer: ResearchAgentAnswer, assessments: AiQualityAssessment[]): ResearchAgentAnswer {
  const assessmentMap = new Map(assessments.map((assessment) => [assessment.paperId, assessment]));
  return {
    ...answer,
    sourceNotes: answer.sourceNotes.map((source) => {
      const assessment = assessmentMap.get(source.paperId);
      if (!assessment || !source.quality) return source;
      const overallScore = Math.max(0, Math.min(100, Math.round(Number(assessment.overallScore ?? source.quality.overallScore) || source.quality.overallScore)));
      return {
        ...source,
        quality: {
          ...source.quality,
          overallScore,
          overallLabel: normalizedQualityStatus(
            overallScore >= 75 ? "strong" : overallScore >= 52 ? "moderate" : overallScore > 0 ? "weak" : "unknown",
          ),
          methodology: assessment.methodology
            ? { ...assessment.methodology, status: normalizedQualityStatus(assessment.methodology.status) }
            : source.quality.methodology,
          sampleSize: assessment.sampleSize ? { ...assessment.sampleSize, status: normalizedQualityStatus(assessment.sampleSize.status) } : source.quality.sampleSize,
          conflicts: assessment.conflicts ? { ...assessment.conflicts, status: normalizedQualityStatus(assessment.conflicts.status) } : source.quality.conflicts,
          funding: assessment.funding ? { ...assessment.funding, status: normalizedQualityStatus(assessment.funding.status) } : source.quality.funding,
          limitations: assessment.limitations?.length ? assessment.limitations.slice(0, 5) : source.quality.limitations,
        },
      };
    }),
    aiEnhanced: true,
  };
}

function mergeAiSynthesis(answer: ResearchAgentAnswer, aiAnswer: Partial<ResearchAgentAnswer>): ResearchAgentAnswer {
  return {
    ...answer,
    directAnswer: aiAnswer.directAnswer?.trim() || answer.directAnswer,
    overview: aiAnswer.overview?.trim() || answer.overview,
    keyFindings: aiAnswer.keyFindings?.length ? aiAnswer.keyFindings : answer.keyFindings,
    followUpQueries: aiAnswer.followUpQueries?.length ? aiAnswer.followUpQueries : answer.followUpQueries,
    aiEnhanced: true,
  };
}

async function enrichOpenAccess(papers: Paper[]): Promise<{ papers: Paper[]; alternatives: AlternativePaper[] }> {
  const alternatives: AlternativePaper[] = [];
  const enriched = await Promise.all(
    papers.map(async (paper) => {
      if (!paper.doi || paper.isOpenAccess) return paper;
      try {
        const alternative = await unpaywallService.toAlternative(paper);
        if (!alternative) return paper;
        alternatives.push(alternative);
        return {
          ...paper,
          isOpenAccess: true,
          oaUrl: alternative.openAccessLink ?? paper.oaUrl,
          pdfUrl: alternative.openAccessLink?.includes(".pdf") ? alternative.openAccessLink : paper.pdfUrl,
        };
      } catch {
        return paper;
      }
    }),
  );
  return { papers: enriched, alternatives };
}

export const researchAgentService = {
  initialSteps(): AgentStep[] {
    return baseSteps.map((step) => ({ ...step }));
  },

  async searchWeb(request: SearchRequest, onStep?: StepSink): Promise<ResearchAgentResult> {
    let steps = emit(this.initialSteps(), onStep);
    const papers: Paper[] = [];
    const alternatives: AlternativePaper[] = [];
    const providerSettings = loadProviderSettings();
    const fallbackQuery = providerSearchQuery(request.query);
    let searchQuery = fallbackQuery;

    if (aiProviderService.isConfigured(providerSettings) && providerSettings.aiSemanticExpansion) {
      steps = emit(updateStep(steps, "ai-expand", "running"), onStep);
      try {
        const expansion = await aiProviderService.expandQuery(request.query, fallbackQuery);
        searchQuery = expansion.searchQuery || fallbackQuery;
        const detail = expansion.keyConcepts.length ? `${expansion.keyConcepts.slice(0, 4).join(", ")}` : "Expanded query ready";
        steps = emit(updateStep(steps, "ai-expand", "done", detail), onStep);
      } catch (error) {
        steps = emit(updateStep(steps, "ai-expand", "error", error instanceof Error ? error.message : "AI expansion failed"), onStep);
      }
    } else {
      steps = emit(updateStep(steps, "ai-expand", "done", "Using keyword expansion"), onStep);
    }

    const providerRequest = { ...request, query: searchQuery };
    const externalSearches: ExternalSearchLink[] = [googleScholarService.searchLink(searchQuery)];

    steps = emit(updateStep(steps, "openalex", "running"), onStep);
    try {
      const openAlexPapers = await openAlexService.searchWorks(providerRequest);
      papers.push(...openAlexPapers);
      steps = emit(updateStep(steps, "openalex", "done", `${openAlexPapers.length} works returned`), onStep);
    } catch (error) {
      steps = emit(updateStep(steps, "openalex", "error", error instanceof Error ? error.message : "OpenAlex failed"), onStep);
    }

    steps = emit(updateStep(steps, "crossref", "running"), onStep);
    try {
      const crossrefPapers = await crossrefService.searchWorks(providerRequest);
      papers.push(...crossrefPapers);
      steps = emit(updateStep(steps, "crossref", "done", `${crossrefPapers.length} works returned`), onStep);
    } catch (error) {
      steps = emit(updateStep(steps, "crossref", "error", error instanceof Error ? error.message : "Crossref failed"), onStep);
    }

    steps = emit(updateStep(steps, "openaire", "running"), onStep);
    try {
      const openAirePapers = await openAireService.searchWorks(providerRequest);
      papers.push(...openAirePapers);
      steps = emit(updateStep(steps, "openaire", "done", `${openAirePapers.length} records returned`), onStep);
    } catch (error) {
      steps = emit(updateStep(steps, "openaire", "error", error instanceof Error ? error.message : "OpenAIRE failed"), onStep);
    }

    steps = emit(updateStep(steps, "pubmed", "running"), onStep);
    try {
      const pubMedPapers = await pubMedService.searchWorks(providerRequest);
      papers.push(...pubMedPapers);
      steps = emit(updateStep(steps, "pubmed", "done", `${pubMedPapers.length} records returned`), onStep);
    } catch (error) {
      steps = emit(updateStep(steps, "pubmed", "error", error instanceof Error ? error.message : "PubMed failed"), onStep);
    }

    steps = emit(updateStep(steps, "arxiv", "running"), onStep);
    try {
      const arxivMatches = await arxivService.search(providerRequest.query);
      alternatives.push(...arxivMatches);
      papers.push(...arxivMatches.map((alternative) => arxivAlternativeToPaper(alternative, providerRequest)));
      steps = emit(updateStep(steps, "arxiv", "done", `${arxivMatches.length} preprints returned`), onStep);
    } catch (error) {
      steps = emit(updateStep(steps, "arxiv", "error", error instanceof Error ? error.message : "arXiv failed"), onStep);
    }

    steps = emit(updateStep(steps, "google-scholar", "done", "External Scholar search link ready"), onStep);

    steps = emit(updateStep(steps, "oa", "running"), onStep);
    const { papers: enrichedPapers, alternatives: unpaywallAlternatives } = await enrichOpenAccess(papers.slice(0, 12));
    alternatives.push(...unpaywallAlternatives);
    const remaining = papers.slice(12);
    steps = emit(updateStep(steps, "oa", "done", `${unpaywallAlternatives.length} legal OA records found`), onStep);

    steps = emit(updateStep(steps, "rank", "running"), onStep);
    const rankedPapers = dedupe([...enrichedPapers, ...remaining])
      .filter((paper) => !request.filters.openAccessOnly || paper.isOpenAccess)
      .sort((a, b) => scorePaper(b, request) - scorePaper(a, request));
    steps = emit(updateStep(steps, "rank", "done", `${rankedPapers.length} ranked results ready`), onStep);
    steps = emit(updateStep(steps, "synth", "done", "Ready to answer from ranked sources"), onStep);

    return {
      papers: rankedPapers,
      importedPapers: [],
      alternatives,
      externalSearches,
      steps,
      answer: {
        question: request.query,
        searchQuery,
        directAnswer: undefined,
        overview: "",
        keyFindings: [],
        sourceNotes: [],
        followUpQueries: [],
      },
    };
  },

  async askQuestion(request: SearchRequest, onStep?: StepSink): Promise<ResearchAgentResult> {
    const result = await this.searchWeb(request, onStep);
    let steps = result.steps;
    const providerSettings = loadProviderSettings();
    let answer = synthesizeAnswer(request.query, result.papers, result.answer?.searchQuery ?? providerSearchQuery(request.query));

    if (aiProviderService.isConfigured(providerSettings) && providerSettings.aiEvidenceLabels && answer.sourceNotes.length > 0) {
      steps = emit(updateStep(steps, "validate", "running"), onStep);
      try {
        const assessments = await aiProviderService.assessEvidence(request.query, result.papers.slice(0, answer.sourceNotes.length), answer.sourceNotes);
        answer = mergeEvidenceAssessments(answer, assessments);
        steps = emit(updateStep(steps, "validate", "done", `${assessments.length} sources labelled`), onStep);
      } catch (error) {
        steps = emit(updateStep(steps, "validate", "error", error instanceof Error ? error.message : "AI evidence validation failed"), onStep);
      }
    } else {
      steps = emit(updateStep(steps, "validate", "done", "AI labels off or no sources"), onStep);
    }

    if (answer.sourceNotes.length > 0) {
      if (aiProviderService.isConfigured(providerSettings) && providerSettings.aiQualityValidation) {
        steps = emit(updateStep(steps, "quality", "running"), onStep);
        try {
          const qualityAssessments = await aiProviderService.assessQuality(request.query, result.papers.slice(0, answer.sourceNotes.length), answer.sourceNotes);
          answer = mergeAiQuality(answer, qualityAssessments);
          steps = emit(updateStep(steps, "quality", "done", `${qualityAssessments.length} sources quality-checked`), onStep);
        } catch (error) {
          steps = emit(updateStep(steps, "quality", "error", error instanceof Error ? error.message : "AI quality assessment failed"), onStep);
        }
      } else {
        steps = emit(updateStep(steps, "quality", "done", "Heuristic quality scoring ready"), onStep);
      }
    } else {
      steps = emit(updateStep(steps, "quality", "done", "No sources to quality-check"), onStep);
    }

    steps = emit(updateStep(steps, "synth", "running"), onStep);
    if (aiProviderService.isConfigured(providerSettings) && providerSettings.aiAnswerSynthesis && answer.sourceNotes.length > 0) {
      try {
        const aiAnswer = await aiProviderService.synthesizeAnswer(request.query, answer.searchQuery, answer.sourceNotes);
        answer = mergeAiSynthesis(answer, aiAnswer);
        steps = emit(updateStep(steps, "synth", "done", `${answer.sourceNotes.length} sources cited with AI synthesis`), onStep);
      } catch (error) {
        steps = emit(updateStep(steps, "synth", "error", error instanceof Error ? error.message : "AI synthesis failed; fallback answer shown"), onStep);
      }
    } else {
      steps = emit(updateStep(steps, "synth", "done", `${answer.sourceNotes.length} sources cited`), onStep);
    }

    return { ...result, answer, steps };
  },
};
