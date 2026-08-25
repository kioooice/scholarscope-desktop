import type { ProviderSettings } from "../types/athena";

export const providerSettingsKey = "athena.providerSettings";

export const defaultProviderSettings: ProviderSettings = {
  semanticScholarApiKey: "",
  ncbiApiKey: "",
  crossrefEmail: "2265298543@qq.com",
  googleScholarApiKey: "",
  scansciEnabled: true,
  scansciAutoSearch: true,
  scansciScope: "selected",
  scansciTopN: 1,
  scansciTimeoutMs: 20_000,
  aiProvider: "off",
  aiBaseUrl: "https://api.openai.com/v1",
  aiModel: "gpt-5.5",
  aiApiKey: "",
  aiSemanticExpansion: true,
  aiEvidenceLabels: true,
  aiAnswerSynthesis: true,
  aiQualityValidation: true,
};

export function loadProviderSettings(): ProviderSettings {
  try {
    const stored = window.localStorage.getItem(providerSettingsKey);
    return stored ? { ...defaultProviderSettings, ...(JSON.parse(stored) as Partial<ProviderSettings>) } : defaultProviderSettings;
  } catch {
    return defaultProviderSettings;
  }
}

export function saveProviderSettings(settings: ProviderSettings): ProviderSettings {
  window.localStorage.setItem(providerSettingsKey, JSON.stringify(settings));
  return settings;
}
