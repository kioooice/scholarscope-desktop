import { Download, ExternalLink, FileText, GitBranchPlus, Link, Save, SearchCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { alternativeFinderService } from "../services/alternativeFinderService";
import { paperService } from "../services/paperService";
import { getPaperDownloadUrl, getPaperLandingUrl } from "../services/paperLinks";
import { useAthenaStore } from "../stores/athenaStore";
import type { AlternativePaper, Paper } from "../types/athena";

type Props = {
  paper?: Paper;
};

export function PaperDetailPanel({ paper }: Props) {
  const [alternatives, setAlternatives] = useState<AlternativePaper[]>([]);
  const [busy, setBusy] = useState(false);
  const upsertPaper = useAthenaStore((state) => state.upsertPaper);
  const setGraph = useAthenaStore((state) => state.setGraph);
  const setActiveView = useAthenaStore((state) => state.setActiveView);
  const setStatusMessage = useAthenaStore((state) => state.setStatusMessage);
  const landingUrl = useMemo(() => (paper ? getPaperLandingUrl(paper) : undefined), [paper]);
  const downloadUrl = useMemo(() => (paper ? getPaperDownloadUrl(paper) : undefined), [paper]);

  if (!paper) {
    return (
      <aside className="context-panel">
        <div className="panel-placeholder">
          <FileText size={30} />
          <span>Select a paper or graph node to inspect metadata, links, and alternatives.</span>
        </div>
      </aside>
    );
  }

  async function savePaper() {
    if (!paper) return;
    setBusy(true);
    try {
      const saved = await paperService.savePaper(paper);
      upsertPaper(saved);
      setStatusMessage("Paper saved and graph updated");
    } finally {
      setBusy(false);
    }
  }

  async function findAlternatives() {
    if (!paper) return;
    setBusy(true);
    try {
      const matches = await alternativeFinderService.findAlternatives(paper);
      setAlternatives(matches);
      setStatusMessage(`Found ${matches.length} legal open-access alternatives`);
    } finally {
      setBusy(false);
    }
  }

  async function addToGraph() {
    await savePaper();
    const graph = await import("../services/graphService").then((module) => module.graphService.getGraph());
    setGraph(graph);
    setActiveView("graph");
  }

  return (
    <aside className="context-panel">
      <div className="context-header">
        <span className="eyebrow">{paper.journal ?? paper.sourceProvider}</span>
        <h2>{paper.title}</h2>
        <p>{paper.authors.join(", ") || "Unknown authors"}</p>
      </div>

      <div className="action-strip">
        {landingUrl && (
          <a href={landingUrl} target="_blank" rel="noreferrer" title="Open paper link">
            <ExternalLink size={16} /> Open
          </a>
        )}
        {downloadUrl && (
          <a href={downloadUrl} target="_blank" rel="noreferrer" title="Download or open PDF">
            <Download size={16} /> PDF
          </a>
        )}
        <button type="button" onClick={savePaper} disabled={busy} title="Save to library">
          <Save size={16} /> Save
        </button>
        <button type="button" onClick={addToGraph} disabled={busy} title="Add to graph">
          <GitBranchPlus size={16} /> Graph
        </button>
        <button type="button" onClick={findAlternatives} disabled={busy} title="Find alternatives">
          <SearchCheck size={16} /> OA
        </button>
      </div>

      <section className="context-section">
        <h3>Metadata</h3>
        <dl className="metadata-grid">
          <dt>DOI</dt><dd>{paper.doi ?? "Unknown"}</dd>
          <dt>Year</dt><dd>{paper.year ?? "Unknown"}</dd>
          <dt>Publisher</dt><dd>{paper.publisher ?? "Unknown"}</dd>
          <dt>Citations</dt><dd>{paper.citationCount.toLocaleString()}</dd>
          <dt>Access</dt><dd>{paper.isOpenAccess ? "Open access" : "Restricted"}</dd>
        </dl>
      </section>

      <section className="context-section">
        <h3>Abstract</h3>
        <p>{paper.abstract}</p>
      </section>

      <section className="context-section">
        <h3>Concepts</h3>
        <div className="tag-row">
          {paper.concepts.map((concept) => <span className="tag" key={concept}>{concept}</span>)}
        </div>
      </section>

      <section className="context-section link-list">
        <h3>Links</h3>
        {paper.pdfUrl && <a href={paper.pdfUrl} target="_blank" rel="noreferrer"><Link size={15} /> Open PDF</a>}
        {paper.oaUrl && <a href={paper.oaUrl} target="_blank" rel="noreferrer"><Link size={15} /> Open access record</a>}
        {paper.publisherUrl && <a href={paper.publisherUrl} target="_blank" rel="noreferrer"><Link size={15} /> Publisher page</a>}
        {paper.doi && <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noreferrer"><Link size={15} /> DOI</a>}
      </section>

      {alternatives.length > 0 && (
        <section className="context-section">
          <h3>Free Alternatives</h3>
          <div className="alternative-list">
            {alternatives.map((alternative) => (
              <a className="alternative-item" key={alternative.id} href={alternative.openAccessLink} target="_blank" rel="noreferrer">
                <strong>{alternative.coverageEstimate}%</strong>
                <span>{alternative.title}</span>
                <small>{alternative.source} - {alternative.reason}</small>
              </a>
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}
