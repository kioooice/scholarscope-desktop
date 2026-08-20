import { Star, Tag, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { graphService } from "../services/graphService";
import { paperService } from "../services/paperService";
import { useAthenaStore } from "../stores/athenaStore";

type SortKey = "citationCount" | "year" | "dateAdded";

export function LibraryPage() {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("citationCount");
  const library = useAthenaStore((state) => state.library);
  const setLibrary = useAthenaStore((state) => state.setLibrary);
  const setGraph = useAthenaStore((state) => state.setGraph);
  const setSelectedPaper = useAthenaStore((state) => state.setSelectedPaper);
  const setStatusMessage = useAthenaStore((state) => state.setStatusMessage);

  const papers = useMemo(() => {
    const needle = filter.toLowerCase();
    return library
      .filter((paper) => {
        const source = `${paper.title} ${paper.authors.join(" ")} ${paper.topics.join(" ")} ${paper.tags?.join(" ") ?? ""}`.toLowerCase();
        return source.includes(needle);
      })
      .sort((a, b) => {
        if (sort === "citationCount") return b.citationCount - a.citationCount;
        if (sort === "year") return (b.year ?? 0) - (a.year ?? 0);
        return (Date.parse(b.dateAdded ?? "") || 0) - (Date.parse(a.dateAdded ?? "") || 0);
      });
  }, [filter, library, sort]);

  async function removePaper(id: string) {
    const nextLibrary = await paperService.deletePaper(id);
    setLibrary(nextLibrary);
    setGraph(await graphService.getGraph());
    setSelectedPaper(undefined);
    setStatusMessage("Paper removed from library");
  }

  return (
    <main className="page">
      <section className="toolbar">
        <input placeholder="Filter by topic, author, year, OA status, tag" value={filter} onChange={(event) => setFilter(event.target.value)} />
        <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
          <option value="citationCount">Citation count</option>
          <option value="year">Publication date</option>
          <option value="dateAdded">Date added</option>
        </select>
      </section>
      <div className="library-grid">
        {papers.map((paper) => (
          <article className="library-card" key={paper.id} onClick={() => setSelectedPaper(paper)}>
            <div className="paper-row__meta">
              <span>{paper.year}</span>
              <span>{paper.isOpenAccess ? "Open access" : "Restricted"}</span>
              {paper.favorite && <Star size={14} />}
            </div>
            <button
              className="library-card__remove"
              type="button"
              title="Remove from library"
              onClick={(event) => {
                event.stopPropagation();
                void removePaper(paper.id);
              }}
            >
              <Trash2 size={15} />
            </button>
            <h3>{paper.title}</h3>
            <p>{paper.authors.slice(0, 3).join(", ")}</p>
            <div className="tag-row">
              {(paper.tags ?? paper.topics).slice(0, 4).map((tag) => (
                <span className="tag" key={tag}><Tag size={12} /> {tag}</span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
