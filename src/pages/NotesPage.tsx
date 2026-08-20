import { Plus, Save } from "lucide-react";
import { useMemo, useState } from "react";
import { localRepository } from "../database/localRepository";
import { graphService } from "../services/graphService";
import { useAthenaStore } from "../stores/athenaStore";
import type { AthenaNote } from "../types/athena";

function makeId(title: string): string {
  return `note-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now()}`;
}

export function NotesPage() {
  const notes = useAthenaStore((state) => state.notes);
  const graph = useAthenaStore((state) => state.graph);
  const upsertNote = useAthenaStore((state) => state.upsertNote);
  const setGraph = useAthenaStore((state) => state.setGraph);
  const [title, setTitle] = useState("New research note");
  const [content, setContent] = useState("");

  const linkedNodeIds = useMemo(() => {
    const wikiLinks = Array.from(content.matchAll(/\[\[([^\]]+)\]\]/g)).map((match) => match[1].toLowerCase());
    return graph?.nodes.filter((node) => wikiLinks.includes(node.label.toLowerCase())).map((node) => node.id) ?? [];
  }, [content, graph]);

  async function saveNote() {
    const now = new Date().toISOString();
    const note: AthenaNote = { id: makeId(title), title, content, linkedNodeIds, createdAt: now, updatedAt: now };
    const saved = await localRepository.saveNote(note);
    upsertNote(saved);

    if (linkedNodeIds.length) {
      const noteNode = { id: `note-node-${saved.id}`, type: "Concept" as const, label: saved.title, refId: saved.id, metadata: { note: true } };
      const noteEdges = linkedNodeIds.map((nodeId) => ({
        id: `edge-${saved.id}-${nodeId}`,
        sourceNodeId: noteNode.id,
        targetNodeId: nodeId,
        relationshipType: "Mentioned In" as const,
        metadata: {},
      }));
      setGraph(await graphService.mergeGraph({ nodes: [noteNode], edges: noteEdges }));
    }
  }

  return (
    <main className="page notes-page">
      <section className="note-editor">
        <div className="toolbar">
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
          <button type="button" className="primary-button" onClick={saveNote}><Save size={16} /> Save</button>
          <span>{linkedNodeIds.length} graph links</span>
        </div>
        <textarea value={content} onChange={(event) => setContent(event.target.value)} />
      </section>
      <section className="note-list">
        <div className="section-title">
          <Plus size={16} />
          <h2>Research Notes</h2>
        </div>
        {notes.map((note) => (
          <article className="note-card" key={note.id}>
            <h3>{note.title}</h3>
            <p>{note.content}</p>
            <span>{note.linkedNodeIds.length} linked nodes</span>
          </article>
        ))}
      </section>
    </main>
  );
}
