import type { ProviderSettings } from "../types/scholarscope";

export const providerSettingsKey = "scholarscope.providerSettings";
const legacyProviderSettingsKey = "athena.providerSettings";

export const defaultProviderSettings: ProviderSettings = {
  crossrefEmail: "2265298543@qq.com",
  downloadDirectory: "",
  scansciEnabled: true,
  scansciAutoSearch: true,
  scansciScope: "selected",
  scansciTopN: 1,
  scansciTimeoutMs: 20_000,
  scansciScihubEnabled: true,
  scansciUseTor: false,
};

function normalizeSettings(value: unknown): ProviderSettings {
  const stored = value && typeof value === "object" ? value as Partial<ProviderSettings> : {};
  return {
    ...defaultProviderSettings,
    crossrefEmail: typeof stored.crossrefEmail === "string" ? stored.crossrefEmail : defaultProviderSettings.crossrefEmail,
    downloadDirectory: typeof stored.downloadDirectory === "string" ? stored.downloadDirectory.trim() : defaultProviderSettings.downloadDirectory,
    scansciEnabled: typeof stored.scansciEnabled === "boolean" ? stored.scansciEnabled : defaultProviderSettings.scansciEnabled,
    scansciAutoSearch: typeof stored.scansciAutoSearch === "boolean" ? stored.scansciAutoSearch : defaultProviderSettings.scansciAutoSearch,
    scansciScope: stored.scansciScope === "selected" || stored.scansciScope === "top" || stored.scansciScope === "all" ? stored.scansciScope : defaultProviderSettings.scansciScope,
    scansciTopN: Number.isFinite(stored.scansciTopN) ? Math.max(1, Math.min(50, Number(stored.scansciTopN))) : defaultProviderSettings.scansciTopN,
    scansciTimeoutMs: Number.isFinite(stored.scansciTimeoutMs) ? Math.max(5_000, Math.min(60_000, Number(stored.scansciTimeoutMs))) : defaultProviderSettings.scansciTimeoutMs,
    scansciScihubEnabled: typeof stored.scansciScihubEnabled === "boolean" ? stored.scansciScihubEnabled : defaultProviderSettings.scansciScihubEnabled,
    scansciUseTor: typeof stored.scansciUseTor === "boolean" ? stored.scansciUseTor : defaultProviderSettings.scansciUseTor,
  };
}

export function loadProviderSettings(): ProviderSettings {
  try {
    const current = window.localStorage.getItem(providerSettingsKey);
    if (current) return normalizeSettings(JSON.parse(current));
    const legacy = window.localStorage.getItem(legacyProviderSettingsKey);
    if (!legacy) return defaultProviderSettings;
    const migrated = normalizeSettings(JSON.parse(legacy));
    window.localStorage.setItem(providerSettingsKey, JSON.stringify(migrated));
    return migrated;
  } catch {
    return defaultProviderSettings;
  }
}

export function saveProviderSettings(settings: ProviderSettings): ProviderSettings {
  const normalized = normalizeSettings(settings);
  window.localStorage.setItem(providerSettingsKey, JSON.stringify(normalized));
  return normalized;
}
