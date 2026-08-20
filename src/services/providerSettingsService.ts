import type { ProviderSettings } from "../types/athena";

export const providerSettingsKey = "athena.providerSettings";

export const defaultProviderSettings: ProviderSettings = {
  semanticScholarApiKey: "",
  ncbiApiKey: "",
  crossrefEmail: "",
  googleScholarApiKey: "",
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
