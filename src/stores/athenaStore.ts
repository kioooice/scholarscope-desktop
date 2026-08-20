import { create } from "zustand";
import { defaultProviderSettings, loadProviderSettings, saveProviderSettings } from "../services/providerSettingsService";
import type { AthenaGraph, AthenaNote, Paper, ProviderSettings, UiSettings } from "../types/athena";

type View = "home" | "search" | "library" | "graph" | "notes" | "settings";

const uiSettingsKey = "athena.uiSettings";

export const defaultUiSettings: UiSettings = {
  accentColor: "#7c3cff",
  graphNodeColor: "#7c3cff",
  graphEdgeColor: "#0d6f7f",
  backgroundColor: "#141414",
  surfaceColor: "#101824",
  textColor: "#dce7f7",
  density: "comfortable",
  smoothUi: true,
};

function loadUiSettings(): UiSettings {
  try {
    const stored = window.localStorage.getItem(uiSettingsKey);
    return stored ? { ...defaultUiSettings, ...(JSON.parse(stored) as Partial<UiSettings>) } : defaultUiSettings;
  } catch {
    return defaultUiSettings;
  }
}

function saveUiSettings(settings: UiSettings): UiSettings {
  window.localStorage.setItem(uiSettingsKey, JSON.stringify(settings));
  return settings;
}

type AthenaState = {
  activeView: View;
  selectedPaper?: Paper;
  selectedNodeId?: string;
  library: Paper[];
  graph?: AthenaGraph;
  notes: AthenaNote[];
  uiSettings: UiSettings;
  providerSettings: ProviderSettings;
  statusMessage?: string;
  setActiveView: (view: View) => void;
  setSelectedPaper: (paper?: Paper) => void;
  setSelectedNodeId: (nodeId?: string) => void;
  setLibrary: (papers: Paper[]) => void;
  upsertPaper: (paper: Paper) => void;
  setGraph: (graph: AthenaGraph) => void;
  setNotes: (notes: AthenaNote[]) => void;
  upsertNote: (note: AthenaNote) => void;
  updateUiSettings: (settings: Partial<UiSettings>) => void;
  updateProviderSettings: (settings: Partial<ProviderSettings>) => void;
  setStatusMessage: (message?: string) => void;
};

export const useAthenaStore = create<AthenaState>((set) => ({
  activeView: "home",
  library: [],
  notes: [],
  uiSettings: loadUiSettings(),
  providerSettings: loadProviderSettings(),
  setActiveView: (activeView) => set({ activeView }),
  setSelectedPaper: (selectedPaper) => set({ selectedPaper }),
  setSelectedNodeId: (selectedNodeId) => set({ selectedNodeId }),
  setLibrary: (library) => set({ library }),
  upsertPaper: (paper) =>
    set((state) => {
      const index = state.library.findIndex((item) => item.id === paper.id);
      const library = index >= 0 ? state.library.map((item) => (item.id === paper.id ? paper : item)) : [paper, ...state.library];
      return { library, selectedPaper: paper };
    }),
  setGraph: (graph) => set({ graph }),
  setNotes: (notes) => set({ notes }),
  upsertNote: (note) =>
    set((state) => {
      const index = state.notes.findIndex((item) => item.id === note.id);
      const notes = index >= 0 ? state.notes.map((item) => (item.id === note.id ? note : item)) : [note, ...state.notes];
      return { notes };
    }),
  updateUiSettings: (settings) =>
    set((state) => {
      const uiSettings = saveUiSettings({ ...state.uiSettings, ...settings });
      return { uiSettings };
    }),
  updateProviderSettings: (settings) =>
    set((state) => {
      const providerSettings = saveProviderSettings({ ...defaultProviderSettings, ...state.providerSettings, ...settings });
      return { providerSettings };
    }),
  setStatusMessage: (statusMessage) => set({ statusMessage }),
}));
