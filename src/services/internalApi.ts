import { isTauri } from "@tauri-apps/api/core";

const DESKTOP_API_BASE = "http://127.0.0.1:5181";

export function internalApiUrl(path: string): string {
  return isTauri() ? `${DESKTOP_API_BASE}${path}` : path;
}
