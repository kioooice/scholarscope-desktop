import { Database, Wifi } from "lucide-react";
import { useAthenaStore } from "../stores/athenaStore";

export function TopBar() {
  const library = useAthenaStore((state) => state.library);
  const graph = useAthenaStore((state) => state.graph);
  const statusMessage = useAthenaStore((state) => state.statusMessage);

  return (
    <header className="top-bar">
      <div>
        <span className="eyebrow">Windows-first research paper search</span>
        <h1>Athena Scholar</h1>
      </div>
      <div className="top-bar__status">
        <span><Database size={15} /> {library.length} papers</span>
        <span><Wifi size={15} /> Live agent: OpenAlex / Unpaywall / arXiv</span>
        <span>{graph?.nodes.length ?? 0} graph nodes</span>
        {statusMessage && <strong>{statusMessage}</strong>}
      </div>
    </header>
  );
}
