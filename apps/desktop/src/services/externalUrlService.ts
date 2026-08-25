import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

function normalizeWebUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "blob:") {
    throw new Error(`Unsupported external URL protocol: ${url.protocol}`);
  }
  return url.href;
}

export async function openExternalUrl(value: string): Promise<void> {
  const url = normalizeWebUrl(value);

  if (isTauri()) {
    if (url.startsWith("blob:")) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    await openUrl(url);
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}
