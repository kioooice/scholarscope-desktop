import { BookOpen, BrainCircuit, ChevronDown, Database, GitBranch, Library, MessageSquareText, ShieldCheck, Sparkles } from "lucide-react";
import { useAthenaStore } from "../stores/athenaStore";

const timeline = [
  {
    version: "Available now",
    title: "Grounded Research Agent",
    items: [
      "Natural-language research questions and claims",
      "OpenAlex, Crossref, OpenAIRE, Unpaywall, and specialist source handoff",
      "Relevance ranking, citations, evidence snippets, saved-paper graph",
    ],
  },
  {
    version: "Available now",
    title: "AI Backend Layer",
    items: [
      "OpenAI-compatible and local/Ollama provider settings are now in Settings",
      "Semantic query expansion and answer synthesis run when an AI provider is configured",
      "Structured support / contradict / neutral evidence labels are available for cited sources",
    ],
  },
  {
    version: "Available now",
    title: "Quality & Validation Engine",
    items: [
      "Journal, citation, recency, methodology, and sample-size checks where metadata is available",
      "Claim-level evidence tables and confidence scoring",
      "Conflict-of-interest and funding extraction when papers expose it",
    ],
  },
];

const capabilities = [
  { label: "Question or claim input", status: "Available", detail: "Ask Athena accepts full research questions and claims." },
  { label: "Academic database search", status: "Available", detail: "OpenAlex, Crossref, OpenAIRE, Unpaywall, plus specialist source handoff." },
  { label: "Keyword matching", status: "Available", detail: "Search query terms are cleaned and expanded before provider lookup." },
  { label: "Semantic expansion", status: "Available", detail: "Uses the configured AI backend to expand question meaning into scholarly query terms." },
  { label: "Evidence validation", status: "Available", detail: "Configured AI backends label cited source evidence as support, contradict, neutral, or unclear." },
  { label: "Quality assessment", status: "Available", detail: "Scores source quality from venue, citations, recency, methodology, sample size, funding, and conflict signals." },
];

const faqs = [
  {
    question: "What databases does Athena search?",
    answer: "The current build searches OpenAlex, Crossref, and OpenAIRE, then uses Unpaywall to locate lawful open versions by DOI. Specialist sources remain available through focused handoffs.",
  },
  {
    question: "Can it tell whether a paper supports a claim?",
    answer: "Yes when an AI backend is configured. It classifies cited source snippets as supports, contradicts, neutral, or unclear against the exact question or claim.",
  },
  {
    question: "What will AI backends add?",
    answer: "They add semantic query expansion, claim-vs-evidence reasoning, structured evidence labels, quality extraction, and clearer answer synthesis while still citing retrieved papers.",
  },
  {
    question: "Will it work across subjects?",
    answer: "Yes. The subject dropdown only focuses the search. Athena is driven by the question text and can search across any topic covered by the connected scholarly databases.",
  },
  {
    question: "Can it use full papers?",
    answer: "The current build primarily uses provider metadata, abstracts, and available links. Full-text PDF extraction is a later step because access and licensing vary by source.",
  },
];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function HomePage() {
  const library = useAthenaStore((state) => state.library);
  const graph = useAthenaStore((state) => state.graph);
  const notes = useAthenaStore((state) => state.notes);
  const setActiveView = useAthenaStore((state) => state.setActiveView);
  const openAccessCount = library.filter((paper) => paper.isOpenAccess).length;
  const graphEdges = graph?.edges.length ?? 0;

  return (
    <main className="page home-page">
      <section className="home-main">
        <div className="home-hero">
          <span className="eyebrow">Athena Scholar</span>
          <h2>{greeting()}</h2>
          <p>Ask research questions, collect useful papers, and build a relevance map of your saved evidence.</p>
          <div className="home-actions">
            <button type="button" className="primary-button" onClick={() => setActiveView("search")}>
              <MessageSquareText size={16} /> Ask Athena
            </button>
            <button type="button" onClick={() => setActiveView("library")}>
              <Library size={16} /> Open Library
            </button>
          </div>
        </div>

        <section className="home-stat-grid">
          <article>
            <Library />
            <strong>{library.length}</strong>
            <span>Saved papers</span>
          </article>
          <article>
            <ShieldCheck />
            <strong>{openAccessCount}</strong>
            <span>Open-access saved</span>
          </article>
          <article>
            <GitBranch />
            <strong>{graphEdges}</strong>
            <span>Paper relevance links</span>
          </article>
          <article>
            <BookOpen />
            <strong>{notes.length}</strong>
            <span>Research notes</span>
          </article>
        </section>

        <section className="home-section">
          <div className="section-title">
            <BrainCircuit size={16} />
            <h2>Agent Capability Status</h2>
          </div>
          <div className="capability-grid">
            {capabilities.map((capability) => (
              <article key={capability.label}>
                <div>
                  <strong>{capability.label}</strong>
                  <span className={`status-pill status-pill--${capability.status.toLowerCase().replace(/\s+/g, "-")}`}>{capability.status}</span>
                </div>
                <p>{capability.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="home-section">
          <div className="section-title">
            <Sparkles size={16} />
            <h2>Common Questions</h2>
          </div>
          <div className="faq-list">
            {faqs.map((faq) => (
              <details key={faq.question}>
                <summary>{faq.question}<ChevronDown size={15} /></summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>
      </section>

      <aside className="home-sidebar">
        <section className="timeline-panel">
          <div className="timeline-panel__header">
            <h2>Release Timeline</h2>
            <span>AI backend roadmap</span>
          </div>
          <div className="timeline-list">
            {timeline.map((release) => (
              <article key={release.version}>
                <strong>{release.version}</strong>
                <span>{release.title}</span>
                <ul>
                  {release.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
        <section className="home-section home-database-card">
          <Database size={18} />
          <div>
            <h2>Current Sources</h2>
            <p>OpenAlex, Crossref, OpenAIRE, Unpaywall, and focused specialist-source handoffs. AI backends will sit on top of citation-grounded retrieval.</p>
          </div>
        </section>
      </aside>
    </main>
  );
}
