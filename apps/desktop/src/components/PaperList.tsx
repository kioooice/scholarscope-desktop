import { BookOpen, Download, ExternalLink, FileText, GitBranchPlus, Library, SearchCheck } from "lucide-react";
import { getPaperDownloadUrl, getPaperLandingUrl } from "../services/paperLinks";
import type { Paper } from "../types/athena";

type Props = {
  papers: Paper[];
  savedIds: Set<string>;
  onView: (paper: Paper) => void;
  onSave: (paper: Paper) => void;
  onAlternatives: (paper: Paper) => void;
};

export function PaperList({ papers, savedIds, onView, onSave, onAlternatives }: Props) {
  if (!papers.length) {
    return (
      <div className="empty-state">
        <BookOpen size={28} />
        <span>No papers match the current query.</span>
      </div>
    );
  }

  return (
    <div className="paper-list">
      {papers.map((paper) => {
        const landingUrl = getPaperLandingUrl(paper);
        const downloadUrl = getPaperDownloadUrl(paper);

        return (
          <article className="paper-row" key={paper.id}>
            <div className="paper-row__main">
              <div className="paper-row__meta">
                <span>{paper.sourceProvider}</span>
                <span>{paper.year ?? "n.d."}</span>
                <span>{paper.citationCount.toLocaleString()} citations</span>
                <span className={paper.isOpenAccess ? "status status--oa" : "status"}>{paper.isOpenAccess ? "Open access" : "Restricted"}</span>
              </div>
              <h3>{paper.title}</h3>
              <p>{paper.authors.slice(0, 5).join(", ") || "Unknown authors"}</p>
              <div className="tag-row">
                {paper.topics.slice(0, 4).map((topic) => (
                  <span className="tag" key={topic}>{topic}</span>
                ))}
              </div>
            </div>
            <div className="paper-row__actions">
              <button className="icon-button" type="button" onClick={() => onView(paper)} title="View details">
                <FileText size={17} />
              </button>
              {landingUrl && (
                <a className="icon-button" href={landingUrl} target="_blank" rel="noreferrer" title="Open paper link">
                  <ExternalLink size={17} />
                </a>
              )}
              {downloadUrl && (
                <a className="icon-button" href={downloadUrl} target="_blank" rel="noreferrer" title="Download or open PDF">
                  <Download size={17} />
                </a>
              )}
              <button className="icon-button" type="button" onClick={() => onSave(paper)} title={savedIds.has(paper.id) ? "Saved" : "Add to Athena"}>
                <Library size={17} />
              </button>
              <button className="icon-button" type="button" onClick={() => onAlternatives(paper)} title="Find free alternatives">
                <SearchCheck size={17} />
              </button>
              <button className="icon-button" type="button" onClick={() => onSave(paper)} title="Add to knowledge graph">
                <GitBranchPlus size={17} />
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
