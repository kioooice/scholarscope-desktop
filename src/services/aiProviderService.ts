import { invoke } from "@tauri-apps/api/core";
import { loadProviderSettings } from "./providerSettingsService";
import type { EvidenceStance, Paper, ProviderSettings, QualityStatus, ResearchAgentAnswer, ResearchAnswerSource } from "../types/athena";

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

type ChatChoice = {
  message?: {
    content?: string;
  };
};

type ChatResponse = {
  choices?: ChatChoice[];
};

export type QueryExpansion = {
  searchQuery: string;
  keyConcepts: string[];
  alternateQueries: string[];
};

export type EvidenceAssessment = {
  paperId: string;
  label: EvidenceStance;
  confidence: number;
  reasoning: string;
};

type EvidenceAssessmentPayload = {
  assessments: EvidenceAssessment[];
};

type SynthesisPayload = {
  directAnswer?: string;
  overview?: string;
  keyFindings?: string[];
  followUpQueries?: string[];
};

export type AiQualityAssessment = {
  paperId: string;
  overallScore?: number;
  methodology?: {
    status: QualityStatus;
    label: string;
    detail: string;
  };
  sampleSize?: {
    status: QualityStatus;
    label: string;
    detail: string;
  };
  conflicts?: {
    status: QualityStatus;
    label: string;
    detail: string;
  };
  funding?: {
    status: QualityStatus;
    label: string;
    detail: string;
  };
  limitations?: string[];
};

type AiQualityAssessmentPayload = {
  assessments: AiQualityAssessment[];
};

function providerBaseUrl(settings: ProviderSettings): string {
  if (settings.aiProvider === "ollama") return "http://127.0.0.1:11434/v1";
  if (settings.aiProvider === "openai") return "https://api.openai.com/v1";
  return settings.aiBaseUrl.trim().replace(/\/+$/g, "");
}

function providerModel(settings: ProviderSettings): string {
  if (settings.aiProvider === "ollama" && !settings.aiModel.trim()) return "llama3.2";
  return settings.aiModel.trim();
}

function isConfigured(settings = loadProviderSettings()): boolean {
  if (settings.aiProvider === "off") return false;
  if (!providerModel(settings)) return false;
  if (settings.aiProvider === "openai") return Boolean(settings.aiApiKey.trim());
  return Boolean(providerBaseUrl(settings));
}

function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI response did not contain JSON");
    return JSON.parse(match[0]);
  }
}

async function callChatJson<T>(system: string, user: string, maxTokens = 900): Promise<T> {
  const settings = loadProviderSettings();
  if (!isConfigured(settings)) throw new Error("AI backend is not configured");

  const payload = {
    model: providerModel(settings),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ] satisfies ChatMessage[],
    temperature: 0.15,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    stream: false,
  };
  const url = `${providerBaseUrl(settings)}/chat/completions`;

  let raw: string;
  try {
    raw = await invoke<string>("agent_call_ai_chat", { request: { url, apiKey: settings.aiApiKey, payload } });
  } catch {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(settings.aiApiKey.trim() ? { authorization: `Bearer ${settings.aiApiKey.trim()}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`AI request failed: ${response.status}`);
    raw = await response.text();
  }

  const data = JSON.parse(raw) as ChatResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI response was empty");
  return extractJson(content) as T;
}

function paperContext(paper: Paper): string {
  return [
    `ID: ${paper.id}`,
    `Title: ${paper.title}`,
    `Source: ${paper.sourceProvider}`,
    `Year: ${paper.year ?? "unknown"}`,
    `Citations: ${paper.citationCount}`,
    `Authors: ${paper.authors.slice(0, 6).join(", ") || "unknown"}`,
    `Abstract: ${paper.abstract.slice(0, 1600)}`,
  ].join("\n");
}

export const aiProviderService = {
  isConfigured,

  async expandQuery(question: string, fallbackQuery: string): Promise<QueryExpansion> {
    const system = "You expand student research questions into concise scholarly database search terms. Return only JSON.";
    const user = `Return JSON with keys searchQuery, keyConcepts, alternateQueries.
Rules:
- searchQuery must be 6 to 16 useful academic search terms, not a sentence.
- Preserve specific processes, chemicals, people, theories, and named methods.
- Include synonyms only when useful.
- alternateQueries should contain 2 focused alternatives.

Question: ${question}
Current keyword query: ${fallbackQuery}`;

    const result = await callChatJson<QueryExpansion>(system, user, 700);
    return {
      searchQuery: result.searchQuery?.trim() || fallbackQuery,
      keyConcepts: Array.isArray(result.keyConcepts) ? result.keyConcepts.slice(0, 8) : [],
      alternateQueries: Array.isArray(result.alternateQueries) ? result.alternateQueries.slice(0, 4) : [],
    };
  },

  async assessEvidence(question: string, papers: Paper[], sourceNotes: ResearchAnswerSource[]): Promise<EvidenceAssessment[]> {
    const system =
      "You classify whether each paper abstract supports, contradicts, is neutral to, or is unclear for a research claim. Return only JSON.";
    const user = `Return JSON in this exact shape:
{"assessments":[{"paperId":"...","label":"supports|contradicts|neutral|unclear","confidence":0.0,"reasoning":"brief reason"}]}

Use supports only when the abstract or metadata provides direct evidence for the claim.
Use contradicts only when it directly conflicts with the claim.
Use neutral when relevant but not testing the claim.
Use unclear when the abstract is missing or too thin.
Confidence must be between 0 and 1.

Question or claim: ${question}

Papers:
${papers
  .slice(0, sourceNotes.length)
  .map(paperContext)
  .join("\n\n---\n\n")}`;

    const result = await callChatJson<EvidenceAssessmentPayload>(system, user, 1200);
    return Array.isArray(result.assessments) ? result.assessments : [];
  },

  async assessQuality(question: string, papers: Paper[], sourceNotes: ResearchAnswerSource[]): Promise<AiQualityAssessment[]> {
    const system =
      "You extract research quality signals from paper abstracts and metadata. Return only JSON. Do not invent unavailable facts.";
    const user = `Return JSON in this exact shape:
{"assessments":[{"paperId":"...","overallScore":0,"methodology":{"status":"strong|moderate|weak|unknown","label":"...","detail":"..."},"sampleSize":{"status":"strong|moderate|weak|unknown","label":"...","detail":"..."},"conflicts":{"status":"strong|moderate|weak|unknown","label":"...","detail":"..."},"funding":{"status":"strong|moderate|weak|unknown","label":"...","detail":"..."},"limitations":["..."]}]}

Rules:
- Extract methodology, sample size or experiment count, funding, and conflicts only from supplied text.
- Use unknown when the supplied abstract/metadata does not say.
- overallScore is 0-100 based on evidence relevance plus metadata quality; do not overrate missing methods.
- Keep details short.

Research question or claim: ${question}
Current source labels:
${sourceNotes.map((source) => `${source.paperId}: ${source.evidenceLabel ?? "unclear"} (${source.confidence ?? 0})`).join("\n")}

Papers:
${papers
  .slice(0, sourceNotes.length)
  .map(paperContext)
  .join("\n\n---\n\n")}`;

    const result = await callChatJson<AiQualityAssessmentPayload>(system, user, 1500);
    return Array.isArray(result.assessments) ? result.assessments : [];
  },

  async synthesizeAnswer(question: string, searchQuery: string, sources: ResearchAnswerSource[]): Promise<Partial<ResearchAgentAnswer>> {
    const system =
      "You write concise citation-grounded research answers for students. You must only use the supplied source notes. Return only JSON.";
    const user = `Return JSON with keys directAnswer, overview, keyFindings, followUpQueries.
Rules:
- directAnswer: one short answer to the question.
- overview: 2 to 4 sentences summarizing the evidence strength and limits.
- keyFindings: 3 to 5 bullet-style strings, each grounded in a source note.
- followUpQueries: 2 to 4 useful next research questions.
- Do not invent paper details.

Question: ${question}
Search query: ${searchQuery}
Source notes:
${sources
  .map((source, index) =>
    [
      `Source ${index + 1}: ${source.title}`,
      `Provider: ${source.sourceProvider}`,
      `Year: ${source.year ?? "unknown"}`,
      `Citations: ${source.citationCount}`,
      `Evidence label: ${source.evidenceLabel ?? "unclassified"}`,
      `Quality score: ${source.quality?.overallScore ?? "unscored"}`,
      `Quality limitations: ${source.quality?.limitations.join("; ") || "none"}`,
      `Evidence: ${source.evidence}`,
      `Reasoning: ${source.reasoning ?? "none"}`,
    ].join("\n"),
  )
  .join("\n\n---\n\n")}`;

    return callChatJson<SynthesisPayload>(system, user, 1400);
  },
};
