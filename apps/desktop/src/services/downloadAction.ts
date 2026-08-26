export function triggerDownload(url: string | undefined, filename: string, onRequest?: () => void): void {
  if (!url) {
    onRequest?.();
    return;
  }

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${filename.replace(/[<>:"/\\|?*]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140) || "paper"}.pdf`;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
