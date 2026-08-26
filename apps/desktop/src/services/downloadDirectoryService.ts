import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export async function getDefaultDownloadDirectory(): Promise<string | undefined> {
  if (!isTauri()) return undefined;
  return invoke<string>("get_default_download_directory");
}

export async function chooseDownloadDirectory(): Promise<string | undefined> {
  if (!isTauri()) return undefined;
  const selected = await open({
    directory: true,
    multiple: false,
    title: "选择 PDF 保存文件夹",
  });
  if (typeof selected === "string" && selected.trim()) return selected.trim();
  if (Array.isArray(selected) && selected[0]?.trim()) return selected[0].trim();
  return undefined;
}
