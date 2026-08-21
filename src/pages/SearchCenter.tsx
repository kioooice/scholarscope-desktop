import { useMutation } from "@tanstack/react-query";
import { Download, ExternalLink, MessageSquareText, Search, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { PaperList } from "../components/PaperList";
import { alternativeFinderService } from "../services/alternativeFinderService";
import { graphService } from "../services/graphService";
import { paperService } from "../services/paperService";
import { researchAgentService } from "../services/researchAgentService";
import { useAthenaStore } from "../stores/athenaStore";
import type { AgentStep, AlternativePaper, ExternalSearchLink, Paper, ResearchAgentAnswer, SearchFilters } from "../types/athena";

const qldSeniorSubjects = [
  "Aboriginal & Torres Strait Islander Languages",
  "Aboriginal & Torres Strait Islander Studies",
  "Accounting",
  "Aerospace Systems",
  "Agricultural Practices",
  "Agricultural Science",
  "Ancient History",
  "Aquatic Practices",
  "Arts in Practice",
  "Biology",
  "Building & Construction Skills",
  "Business",
  "Business Studies",
  "Chemistry",
  "Chinese",
  "Chinese Extension",
  "Dance",
  "Dance in Practice",
  "Design",
  "Digital Solutions",
  "Drama",
  "Drama in Practice",
  "Early Childhood Studies",
  "Earth & Environmental Science",
  "Economics",
  "Engineering",
  "Engineering Skills",
  "English",
  "English & Literature Extension",
  "English as an Additional Language",
  "Essential English",
  "Essential Mathematics",
  "Fashion",
  "Film, Television & New Media",
  "Food & Nutrition",
  "French",
  "French Extension",
  "Furnishing Skills",
  "General Mathematics",
  "Geography",
  "German",
  "German Extension",
  "Health",
  "Hospitality Practices",
  "Industrial Graphics Skills",
  "Industrial Technology Skills",
  "Information & Communication Technology",
  "Italian",
  "Japanese",
  "Legal Studies",
  "Literature",
  "Marine Science",
  "Mathematical Methods",
  "Media Arts in Practice",
  "Modern History",
  "Music",
  "Music Extension (Composition)",
  "Music Extension (Musicology)",
  "Music Extension (Performance)",
  "Music in Practice",
  "Philosophy & Reason",
  "Physical Education",
  "Physics",
  "Psychology",
  "Religion & Ethics",
  "Science in Practice",
  "Social & Community Studies",
  "Spanish",
  "Specialist Mathematics",
  "Sport & Recreation",
  "Study of Religion",
  "Tourism",
  "Visual Art",
  "Visual Arts in Practice",
];

export function SearchCenter() {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>({ disciplines: [], openAccessOnly: false });
  const [results, setResults] = useState<Paper[]>([]);
  const [alternatives, setAlternatives] = useState<AlternativePaper[]>([]);
  const [externalSearches, setExternalSearches] = useState<ExternalSearchLink[]>([]);
  const [answer, setAnswer] = useState<ResearchAgentAnswer>();
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>(researchAgentService.initialSteps());
  const library = useAthenaStore((state) => state.library);
  const upsertPaper = useAthenaStore((state) => state.upsertPaper);
  const setGraph = useAthenaStore((state) => state.setGraph);
  const setSelectedPaper = useAthenaStore((state) => state.setSelectedPaper);
  const setStatusMessage = useAthenaStore((state) => state.setStatusMessage);
  const savedIds = useMemo(() => new Set(library.map((paper) => paper.id)), [library]);
  const trimmedQuery = query.trim();

  const askMutation = useMutation({
    mutationFn: () => researchAgentService.askQuestion({ query: trimmedQuery, type: "keywords", filters }, setAgentSteps),
    onSuccess: (result) => {
      setResults(result.papers);
      setAlternatives(result.alternatives);
      setExternalSearches(result.externalSearches);
      setAnswer(result.answer);
      setAgentSteps(result.steps);
      setStatusMessage(`Athena answered from ${result.papers.length} ranked papers`);
    },
    onError: (error) => {
      setResults([]);
      setExternalSearches([]);
      setAnswer(undefined);
      setStatusMessage(error instanceof Error ? error.message : "Athena could not answer");
    },
  });

  function askAthena() {
    if (!trimmedQuery) {
      setStatusMessage("Ask Athena a research question");
      return;
    }
    askMutation.mutate();
  }

  async function savePaper(paper: Paper) {
    const saved = await paperService.savePaper(paper);
    upsertPaper(saved);
    setGraph(await graphService.getGraph());
    setStatusMessage("Paper saved locally and linked into graph");
  }

  async function findAlternatives(paper: Paper) {
    setSelectedPaper(paper);
    const matches = await alternativeFinderService.findAlternatives(paper);
    setAlternatives(matches);
    setStatusMessage(`Found ${matches.length} legal alternatives`);
  }

  return (
    <main className="page page--search">
      <section className="ask-panel">
        <div className="ask-panel__header">
          <MessageSquareText size={20} />
          <div>
            <span className="eyebrow">Ask Athena</span>
            <h2>Research question agent</h2>
          </div>
        </div>
        <div className="ask-box">
          <textarea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) askAthena();
            }}
            placeholder="Ask a research question or describe a topic"
          />
          <button type="button" className="primary-button" onClick={askAthena} disabled={askMutation.isPending || !trimmedQuery}>
            <Send size={17} /> Ask
          </button>
        </div>
      </section>

      <section className="filter-band">
        <label className="select-control subject-select">
          <span>QLD senior subject focus</span>
          <select
            value={filters.disciplines[0] ?? ""}
            onChange={(event) => setFilters({ ...filters, disciplines: event.target.value ? [event.target.value] : [] })}
          >
            <option value="">All subjects</option>
            {qldSeniorSubjects.map((subject) => (
              <option value={subject} key={subject}>{subject}</option>
            ))}
          </select>
        </label>
        <label className="check-chip">
          <input type="checkbox" checked={filters.openAccessOnly} onChange={(event) => setFilters({ ...filters, openAccessOnly: event.target.checked })} />
          <span>Open Access Only</span>
        </label>
        <label>
          Year
          <input type="number" value={filters.minYear ?? ""} onChange={(event) => setFilters({ ...filters, minYear: event.target.value ? Number(event.target.value) : undefined })} />
        </label>
        <label>
          Min citations
          <input type="number" value={filters.minCitations ?? ""} onChange={(event) => setFilters({ ...filters, minCitations: event.target.value ? Number(event.target.value) : undefined })} />
        </label>
      </section>

      <section className="agent-panel">
        <div>
          <span className="eyebrow">Research agent</span>
          <h2>Live scholarly answer</h2>
          <p>Athena searches OpenAlex, Crossref, OpenAIRE and specialist sources, checks Unpaywall for legal OA versions, ranks sources, then answers from returned paper records.</p>
        </div>
        <div className="agent-steps">
          {agentSteps.map((step) => (
            <span className={`agent-step agent-step--${step.status}`} key={step.id}>
              <strong>{step.label}</strong>
              {step.detail && <small>{step.detail}</small>}
            </span>
          ))}
        </div>
      </section>

      {answer && (
        <section className="answer-panel">
          <div className="answer-panel__header">
            <span className="eyebrow">Answer</span>
            <h2>{answer.question}</h2>
          </div>
          {answer.directAnswer && <p className="direct-answer">{answer.directAnswer}</p>}
          {answer.aiEnhanced && <span className="ai-enhanced-pill">AI enhanced</span>}
          <p className="answer-overview">{answer.overview}</p>
          {answer.searchQuery && (
            <div className="search-strategy">
              <span>Search query</span>
              <strong>{answer.searchQuery}</strong>
            </div>
          )}
          {answer.keyFindings.length > 0 && (
            <div className="answer-block">
              <h3>Key Findings</h3>
              <ol>
                {answer.keyFindings.map((finding) => (
                  <li key={finding}>{finding}</li>
                ))}
              </ol>
            </div>
          )}
          {answer.sourceNotes.length > 0 && (
            <div className="answer-block">
              <h3>Claim-Level Evidence Table</h3>
              <div className="evidence-table">
                <div className="evidence-table__head">
                  <span>Source</span>
                  <span>Claim relation</span>
                  <span>Quality</span>
                  <span>Key limits</span>
                </div>
                {answer.sourceNotes.map((source) => (
                  <article className="evidence-table__row" key={`${source.paperId}-evidence-row`}>
                    <div>
                      <strong>{source.title}</strong>
                      <small>{source.sourceProvider}{source.year ? `, ${source.year}` : ""}</small>
                    </div>
                    <div>
                      <span className={`evidence-label evidence-label--${source.evidenceLabel ?? "unclear"}`}>{source.evidenceLabel ?? "unclear"}</span>
                      {typeof source.confidence === "number" && <small>{Math.round(source.confidence * 100)}% confidence</small>}
                    </div>
                    <div>
                      <span className={`quality-score quality-score--${source.quality?.overallLabel ?? "unknown"}`}>{source.quality?.overallScore ?? 0}</span>
                      <small>{source.quality?.overallLabel ?? "unknown"}</small>
                    </div>
                    <div>
                      {(source.quality?.limitations.length ? source.quality.limitations : ["No major metadata limitations detected."]).slice(0, 2).map((limit) => (
                        <small key={limit}>{limit}</small>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
          {answer.sourceNotes.length > 0 && (
            <div className="answer-block">
              <h3>Cited Sources</h3>
              <div className="source-grid">
                {answer.sourceNotes.map((source) => {
                  const paper = results.find((item) => item.id === source.paperId);
                  return (
                    <article className="source-card" key={source.paperId}>
                      <button type="button" onClick={() => paper && setSelectedPaper(paper)}>
                        <strong>{source.title}</strong>
                        <span>{source.authors.slice(0, 3).join(", ") || "Unknown authors"}{source.year ? `, ${source.year}` : ""}</span>
                      </button>
                      {source.evidenceLabel && (
                        <div className="evidence-label-row">
                          <span className={`evidence-label evidence-label--${source.evidenceLabel}`}>{source.evidenceLabel}</span>
                          {typeof source.confidence === "number" && <small>{Math.round(source.confidence * 100)}% confidence</small>}
                        </div>
                      )}
                      <p>{source.evidence}</p>
                      {source.reasoning && <small className="evidence-reasoning">{source.reasoning}</small>}
                      {source.quality && (
                        <div className="quality-panel">
                          <div className="quality-panel__summary">
                            <span className={`quality-score quality-score--${source.quality.overallLabel}`}>{source.quality.overallScore}</span>
                            <div>
                              <strong>{source.quality.overallLabel} quality</strong>
                              <small>Metadata-based quality and disclosure check</small>
                            </div>
                          </div>
                          <div className="quality-signal-grid">
                            {[source.quality.journal, source.quality.citations, source.quality.recency, source.quality.methodology, source.quality.sampleSize, source.quality.conflicts, source.quality.funding].map((signal) => (
                              <span className={`quality-signal quality-signal--${signal.status}`} key={`${source.paperId}-${signal.label}`}>
                                <strong>{signal.label}</strong>
                                <small>{signal.detail}</small>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {source.dataPoints.length > 0 && (
                        <div className="data-point-list">
                          {source.dataPoints.map((point) => (
                            <span key={point}>{point}</span>
                          ))}
                        </div>
                      )}
                      <div className="source-card__actions">
                        <small>{source.sourceProvider}</small>
                        <small>{source.citationCount.toLocaleString()} citations</small>
                        {source.url && <a href={source.url} target="_blank" rel="noreferrer" title="Open source"><ExternalLink size={14} /> Open</a>}
                        {source.pdfUrl && <a href={source.pdfUrl} target="_blank" rel="noreferrer" title="Open PDF"><Download size={14} /> PDF</a>}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
          {answer.followUpQueries.length > 0 && (
            <div className="answer-block">
              <h3>Follow-Up Questions</h3>
              <div className="follow-up-row">
                {answer.followUpQueries.map((followUp) => (
                  <button type="button" key={followUp} onClick={() => setQuery(followUp)}>{followUp}</button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <div className="section-title">
        <Search size={16} />
        <h2>Ranked Papers</h2>
      </div>
      <PaperList papers={results} savedIds={savedIds} onView={setSelectedPaper} onSave={savePaper} onAlternatives={findAlternatives} />

      {externalSearches.length > 0 && (
        <section className="results-drawer">
          <h2>External Scholar Searches</h2>
          <div className="alternative-grid">
            {externalSearches.map((search) => (
              <a className="alternative-item" href={search.url} target="_blank" rel="noreferrer" key={search.provider}>
                <strong>{search.provider}</strong>
                <span>{search.label}</span>
                <small>{search.note}</small>
              </a>
            ))}
          </div>
        </section>
      )}

      {alternatives.length > 0 && (
        <section className="results-drawer">
          <h2>Legal Free Alternatives</h2>
          <div className="alternative-grid">
            {alternatives.map((alternative) => (
              <a className="alternative-item" href={alternative.openAccessLink} target="_blank" rel="noreferrer" key={alternative.id}>
                <strong>{alternative.coverageEstimate}%</strong>
                <span>{alternative.title}</span>
                <small>{alternative.source} - {alternative.reason}</small>
              </a>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
