import { Cpu, Database, Palette, RotateCcw, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { defaultUiSettings, useAthenaStore } from "../stores/athenaStore";
import type { UiSettings } from "../types/athena";

type ColorSetting = {
  key: keyof Pick<UiSettings, "accentColor" | "graphNodeColor" | "graphEdgeColor" | "backgroundColor" | "surfaceColor" | "textColor">;
  label: string;
};

const colorSettings: ColorSetting[] = [
  { key: "accentColor", label: "Accent" },
  { key: "graphNodeColor", label: "Graph nodes" },
  { key: "graphEdgeColor", label: "Graph links" },
  { key: "backgroundColor", label: "Background" },
  { key: "surfaceColor", label: "Panels" },
  { key: "textColor", label: "Text" },
];

const themePresets: Array<{ name: string; settings: Partial<UiSettings> }> = [
  {
    name: "Athena",
    settings: {
      accentColor: "#7c3cff",
      graphNodeColor: "#7c3cff",
      graphEdgeColor: "#0d6f7f",
      backgroundColor: "#141414",
      surfaceColor: "#101824",
      textColor: "#dce7f7",
    },
  },
  {
    name: "Scholar",
    settings: {
      accentColor: "#2f80ed",
      graphNodeColor: "#8f6cff",
      graphEdgeColor: "#1c7d8f",
      backgroundColor: "#101318",
      surfaceColor: "#121b28",
      textColor: "#e7eef8",
    },
  },
  {
    name: "Focus",
    settings: {
      accentColor: "#2fbf71",
      graphNodeColor: "#8b5cf6",
      graphEdgeColor: "#0f766e",
      backgroundColor: "#111412",
      surfaceColor: "#111c17",
      textColor: "#ecfdf5",
    },
  },
];

export function SettingsPage() {
  const uiSettings = useAthenaStore((state) => state.uiSettings);
  const providerSettings = useAthenaStore((state) => state.providerSettings);
  const updateUiSettings = useAthenaStore((state) => state.updateUiSettings);
  const updateProviderSettings = useAthenaStore((state) => state.updateProviderSettings);

  return (
    <main className="page settings-page">
      <section className="settings-row">
        <Palette />
        <div>
          <h2>Appearance</h2>
          <p>Change Athena's accent colours, graph colours, panel tone, text colour, density, and motion preference.</p>
          <div className="theme-presets">
            {themePresets.map((preset) => (
              <button type="button" key={preset.name} onClick={() => updateUiSettings(preset.settings)}>
                <span className="preset-swatch" style={{ background: preset.settings.accentColor }} />
                {preset.name}
              </button>
            ))}
          </div>
          <div className="settings-controls">
            {colorSettings.map((setting) => (
              <label className="color-control" key={setting.key}>
                <span>
                  <span className="color-preview" style={{ backgroundColor: uiSettings[setting.key] }} />
                  {setting.label}
                </span>
                <input type="color" value={uiSettings[setting.key]} onChange={(event) => updateUiSettings({ [setting.key]: event.target.value })} />
              </label>
            ))}
          </div>
          <div className="settings-actions">
            <label className="select-control">
              <span>Density</span>
              <select value={uiSettings.density} onChange={(event) => updateUiSettings({ density: event.target.value as UiSettings["density"] })}>
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>
            <label className="check-chip">
              <input type="checkbox" checked={uiSettings.smoothUi} onChange={(event) => updateUiSettings({ smoothUi: event.target.checked })} />
              <span>Smooth motion</span>
            </label>
            <button type="button" onClick={() => updateUiSettings(defaultUiSettings)}>
              <RotateCcw size={16} /> Reset
            </button>
          </div>
        </div>
      </section>
      <section className="settings-row">
        <SlidersHorizontal />
        <div>
          <h2>Subject coverage</h2>
          <p>The subject dropdown uses Queensland senior subject names from QCAA syllabuses. It adds focus to the search query, while Athena still follows the question you ask.</p>
        </div>
      </section>
      <section className="settings-row">
        <Database />
        <div>
          <h2>Research provider access</h2>
          <p>These are optional. They improve rate limits or prepare paid provider access, and are stored locally on this computer.</p>
          <div className="settings-controls settings-controls--stacked">
            <label className="text-control">
              <span>Semantic Scholar API key</span>
              <input
                type="password"
                value={providerSettings.semanticScholarApiKey}
                onChange={(event) => updateProviderSettings({ semanticScholarApiKey: event.target.value })}
                placeholder="Optional, helps avoid 429 rate limits"
              />
            </label>
            <label className="text-control">
              <span>NCBI / PubMed API key</span>
              <input
                type="password"
                value={providerSettings.ncbiApiKey}
                onChange={(event) => updateProviderSettings({ ncbiApiKey: event.target.value })}
                placeholder="Optional, raises PubMed request limits"
              />
            </label>
            <label className="text-control">
              <span>Crossref contact email</span>
              <input
                type="email"
                value={providerSettings.crossrefEmail}
                onChange={(event) => updateProviderSettings({ crossrefEmail: event.target.value })}
                placeholder="Optional, enters Crossref polite pool"
              />
            </label>
            <label className="text-control">
              <span>Google Scholar third-party API key</span>
              <input
                type="password"
                value={providerSettings.googleScholarApiKey}
                onChange={(event) => updateProviderSettings({ googleScholarApiKey: event.target.value })}
                placeholder="Reserved for a future SerpApi/Apify adapter"
              />
            </label>
          </div>
        </div>
      </section>
      <section className="settings-row">
        <Cpu />
        <div>
          <h2>AI backend</h2>
          <p>Use OpenAI, Ollama, or any OpenAI-compatible chat completions server for semantic query expansion, evidence labels, and answer synthesis.</p>
          <div className="settings-controls settings-controls--stacked">
            <label className="select-control">
              <span>Provider</span>
              <select
                value={providerSettings.aiProvider}
                onChange={(event) => {
                  const provider = event.target.value as typeof providerSettings.aiProvider;
                  if (provider === "openai") updateProviderSettings({ aiProvider: provider, aiBaseUrl: "https://api.openai.com/v1" });
                  else if (provider === "ollama") updateProviderSettings({ aiProvider: provider, aiBaseUrl: "http://127.0.0.1:11434/v1", aiModel: providerSettings.aiModel || "llama3.2" });
                  else updateProviderSettings({ aiProvider: provider });
                }}
              >
                <option value="off">Off</option>
                <option value="openai">OpenAI</option>
                <option value="ollama">Local Ollama</option>
                <option value="compatible">OpenAI-compatible</option>
              </select>
            </label>
            <label className="text-control">
              <span>Base URL</span>
              <input
                type="url"
                value={providerSettings.aiBaseUrl}
                onChange={(event) => updateProviderSettings({ aiBaseUrl: event.target.value })}
                placeholder="https://api.openai.com/v1 or http://127.0.0.1:11434/v1"
              />
            </label>
            <label className="text-control">
              <span>Model</span>
              <input
                value={providerSettings.aiModel}
                onChange={(event) => updateProviderSettings({ aiModel: event.target.value })}
                placeholder="gpt-5.5, llama3.2, qwen3:8b, etc."
              />
            </label>
            <label className="text-control">
              <span>AI API key</span>
              <input
                type="password"
                value={providerSettings.aiApiKey}
                onChange={(event) => updateProviderSettings({ aiApiKey: event.target.value })}
                placeholder="Required for OpenAI; usually blank for local Ollama"
              />
            </label>
          </div>
          <div className="settings-actions">
            <label className="check-chip">
              <input
                type="checkbox"
                checked={providerSettings.aiSemanticExpansion}
                onChange={(event) => updateProviderSettings({ aiSemanticExpansion: event.target.checked })}
              />
              <span>Semantic query expansion</span>
            </label>
            <label className="check-chip">
              <input
                type="checkbox"
                checked={providerSettings.aiEvidenceLabels}
                onChange={(event) => updateProviderSettings({ aiEvidenceLabels: event.target.checked })}
              />
              <span>Support / contradict / neutral labels</span>
            </label>
            <label className="check-chip">
              <input
                type="checkbox"
                checked={providerSettings.aiAnswerSynthesis}
                onChange={(event) => updateProviderSettings({ aiAnswerSynthesis: event.target.checked })}
              />
              <span>AI answer synthesis</span>
            </label>
            <label className="check-chip">
              <input
                type="checkbox"
                checked={providerSettings.aiQualityValidation}
                onChange={(event) => updateProviderSettings({ aiQualityValidation: event.target.checked })}
              />
              <span>Quality/disclosure extraction</span>
            </label>
          </div>
        </div>
      </section>
      <section className="settings-row">
        <Database />
        <div>
          <h2>Local-first SQLite</h2>
          <p>Tauri stores papers, notes, and graph layouts under the Windows app data directory. The browser build uses localStorage as a development fallback.</p>
        </div>
      </section>
      <section className="settings-row">
        <ShieldCheck />
        <div>
          <h2>Legal open-access discovery</h2>
          <p>Unpaywall, OpenAlex, and arXiv are queried for lawful OA records, preprints, and alternatives. No paywall circumvention features are implemented.</p>
        </div>
      </section>
      <section className="settings-row">
        <Cpu />
        <div>
          <h2>Future AI backends</h2>
          <p>The AI backend is now configurable. The remaining future work is deeper full-text PDF extraction, quality scoring, and public deployment controls.</p>
        </div>
      </section>
    </main>
  );
}
