import { invoke, isTauri } from "@tauri-apps/api/core";

function pdfFilename(filename: string): string {
  const safeName = Array.from(filename, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || '<>:"/\\|?*'.includes(character) ? " " : character;
  }).join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.pdf$/i, "")
    .trim()
    .slice(0, 140);
  return `${safeName || "paper"}.pdf`;
}

function triggerBrowserDownload(url: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = pdfFilename(filename);
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

async function saveTauriBlob(url: string, filename: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`读取已准备的 PDF 失败（HTTP ${response.status}）`);
  const bytes = Array.from(new Uint8Array(await response.arrayBuffer()));
  const savedPath = await invoke<string>("save_pdf_file", {
    filename: pdfFilename(filename),
    data: bytes,
  });
  console.info("PDF saved", savedPath);
}

export async function triggerDownload(url: string | undefined, filename: string, onRequest?: () => void): Promise<void> {
  if (!url) {
    onRequest?.();
    return;
  }

  if (isTauri() && url.startsWith("blob:")) {
    try {
      await saveTauriBlob(url, filename);
    } catch (error) {
      console.error("Failed to save PDF in Tauri", error);
      globalThis.alert?.("PDF 保存失败，请稍后重试。保存位置为 Downloads 文件夹。");
    }
    return;
  }

  triggerBrowserDownload(url, filename);
}
