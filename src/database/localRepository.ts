import { invoke } from "@tauri-apps/api/core";
import type { AthenaGraph, AthenaNote, Paper } from "../types/athena";

const keys = {
  papers: "athena.papers",
  graph: "athena.graph",
  notes: "athena.notes",
  resetMarker: "athena.searchEngineReset.v1",
};

const emptyGraph: AthenaGraph = { nodes: [], edges: [] };

async function tryInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    return await invoke<T>(command, args);
  } catch {
    return null;
  }
}

function readLocal<T>(key: string, fallback: T): T {
  const value = window.localStorage.getItem(key);
  return value ? (JSON.parse(value) as T) : fallback;
}

function writeLocal<T>(key: string, value: T): T {
  window.localStorage.setItem(key, JSON.stringify(value));
  return value;
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const map = new Map(existing.map((item) => [item.id, item]));
  incoming.forEach((item) => map.set(item.id, { ...map.get(item.id), ...item }));
  return Array.from(map.values());
}

function isDemoPaper(paper: Paper): boolean {
  return (paper.sourceProvider as string) === "Demo" || paper.id.startsWith("demo-");
}

function isDemoNote(note: AthenaNote): boolean {
  return note.id.startsWith("note-perovskite-review");
}

function cleanDemoGraph(graph: AthenaGraph): AthenaGraph {
  const nodes = graph.nodes.filter((node) => !node.id.includes("demo-"));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter(
    (edge) =>
      nodeIds.has(edge.sourceNodeId) &&
      nodeIds.has(edge.targetNodeId) &&
      !/^edge-[0-9]+$/.test(edge.id),
  );
  return { nodes, edges };
}

function migrateLocalDemoData(): void {
  const papers = readLocal(keys.papers, [] as Paper[]).filter((paper) => !isDemoPaper(paper));
  const graph = cleanDemoGraph(readLocal(keys.graph, emptyGraph));
  const notes = readLocal(keys.notes, [] as AthenaNote[]).filter((note) => !isDemoNote(note));
  writeLocal(keys.papers, papers);
  writeLocal(keys.graph, graph);
  writeLocal(keys.notes, notes);
}

async function resetSavedResearchDataOnce(): Promise<void> {
  if (window.localStorage.getItem(keys.resetMarker)) {
    migrateLocalDemoData();
    return;
  }

  await tryInvoke("clear_saved_research_data");
  writeLocal(keys.papers, [] as Paper[]);
  writeLocal(keys.graph, emptyGraph);
  writeLocal(keys.notes, [] as AthenaNote[]);
  window.localStorage.setItem(keys.resetMarker, new Date().toISOString());
}

export const localRepository = {
  async initialize(): Promise<void> {
    await tryInvoke("initialize_database");
    await resetSavedResearchDataOnce();
  },

  async loadPapers(): Promise<Paper[]> {
    const fromTauri = await tryInvoke<Paper[]>("load_papers");
    return (fromTauri?.length ? fromTauri : readLocal(keys.papers, [] as Paper[])).filter((paper) => !isDemoPaper(paper));
  },

  async savePaper(paper: Paper): Promise<Paper> {
    const normalized = { ...paper, dateAdded: paper.dateAdded ?? new Date().toISOString() };
    const saved = await tryInvoke<Paper>("save_paper", { paper: normalized });
    if (saved) return saved;
    const papers = mergeById(readLocal(keys.papers, [] as Paper[]), [normalized]).filter((item) => !isDemoPaper(item));
    writeLocal(keys.papers, papers);
    return normalized;
  },

  async deletePaper(id: string): Promise<void> {
    const deleted = await tryInvoke<boolean>("delete_paper", { id });
    if (deleted) return;
    const papers = readLocal(keys.papers, [] as Paper[]).filter((paper) => paper.id !== id);
    writeLocal(keys.papers, papers);
  },

  async loadGraph(): Promise<AthenaGraph> {
    const fromTauri = await tryInvoke<AthenaGraph>("load_graph");
    return cleanDemoGraph(fromTauri?.nodes?.length ? fromTauri : readLocal(keys.graph, emptyGraph));
  },

  async saveGraph(graph: AthenaGraph): Promise<AthenaGraph> {
    const cleaned = cleanDemoGraph(graph);
    const saved = await tryInvoke<AthenaGraph>("save_graph", { graph: cleaned });
    return saved ?? writeLocal(keys.graph, cleaned);
  },

  async loadNotes(): Promise<AthenaNote[]> {
    const fromTauri = await tryInvoke<AthenaNote[]>("load_notes");
    return (fromTauri?.length ? fromTauri : readLocal(keys.notes, [] as AthenaNote[])).filter((note) => !isDemoNote(note));
  },

  async saveNote(note: AthenaNote): Promise<AthenaNote> {
    const normalized = { ...note, updatedAt: new Date().toISOString() };
    const saved = await tryInvoke<AthenaNote>("save_note", { note: normalized });
    if (saved) return saved;
    const notes = mergeById(readLocal(keys.notes, [] as AthenaNote[]), [normalized]).filter((item) => !isDemoNote(item));
    writeLocal(keys.notes, notes);
    return normalized;
  },
};
