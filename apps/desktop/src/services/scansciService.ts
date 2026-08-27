import type { Paper, ProviderSettings } from "../types/scholarscope";
import type { ScanSciLookupState, ScanSciRoute, UnifiedPaper } from "../types/search";
import { fetchInternalApi } from "./internalApi";

const CACHE_TTL_MS = 30 * 60 * 1000;
const MIN_DOWNLOAD_TIMEOUT_MS = 15_000;
const MAX_DOWNLOAD_TIMEOUT_MS = 90_000;
const DOWNLOAD_TIMEOUT_GRACE_MS = 5_000;
const lookupCache = new Map<string, { expiresAt: number; result: ScanSciLookupState }>();
const lookupInFlight = new Map<string, Promise<ScanSciLookupState>>();

type JsonObject = Record<string, unknown>;
type ScanSciConnectionStatus = "disabled" | "checking" | "ready" | "unavailable" | "error";

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

function safeError(error: unknown): string {
  if (!(error instanceof Error)) return "下载引擎请求失败";
  return error.message.replace(/https?:\/\/[^\s]+/g, "远程接口").slice(0, 180);
}

async function requestJson<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchInternalApi(path, { ...init, signal: controller.signal });
    const text = await response.text();
    let payload: unknown;
    try {
      payload = text.trim() ? JSON.parse(text) : undefined;
    } catch {
      payload = { error: text.slice(0, 180) };
    }
    if (!response.ok) {
      const object = asObject(payload);
      throw new Error(textValue(object?.error) || textValue(object?.message) || `下载引擎请求失败：${response.status}`);
    }
    return payload as T;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function requestBody(
  paper: Pick<Paper, "title" | "doi">,
  settings: ProviderSettings,
  timeoutMs = settings.scansciTimeoutMs,
  routeIds?: string[],
): JsonObject {
  const normalizedRouteIds = Array.from(new Set((routeIds || []).filter((routeId) => Boolean(routeId))));
  return {
    identifier: paper.doi?.trim() || undefined,
    title: paper.title.trim(),
    email: settings.crossrefEmail.trim(),
    timeoutMs,
    routeId: normalizedRouteIds[0],
    routeIds: normalizedRouteIds,
    settings: {
      email: settings.crossrefEmail.trim(),
      strategy: "fastest",
      // Include the grey-source candidates in the same queue when enabled. The
      // engine still verifies and falls through them only when earlier sources fail.
      scihubEnabled: settings.scansciScihubEnabled,
      useTor: settings.scansciUseTor,
    },
  };
}

function paperCacheKey(paper: Pick<Paper, "title" | "doi">): string {
  return paper.doi?.trim().toLowerCase() || paper.title.trim().toLowerCase();
}

function lookupCacheKey(paper: Pick<Paper, "title" | "doi">, settings: ProviderSettings): string {
  return `${paperCacheKey(paper)}|scihub:${settings.scansciScihubEnabled ? "on" : "off"}|tor:${settings.scansciUseTor ? "on" : "off"}`;
}

export function downloadTimeoutMs(settings: ProviderSettings): number {
  const requested = Math.round(settings.scansciTimeoutMs * 3);
  return Math.max(MIN_DOWNLOAD_TIMEOUT_MS, Math.min(MAX_DOWNLOAD_TIMEOUT_MS, requested));
}

function retryableDownloadFailure(current: ScanSciLookupState | undefined, error: string): ScanSciLookupState {
  return {
    ...(current || { status: "error" as const }),
    status: current?.status === "found" ? "found" : "error",
    downloadStatus: "error",
    error,
  };
}

function mapRoutes(value: unknown): ScanSciRoute[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const routes = value.filter((item): item is JsonObject => Boolean(asObject(item))).map((item) => ({
      source: textValue(item.source),
      url: textValue(item.url),
      isPdf: item.isPdf === true,
      routeId: textValue(item.routeId),
      probeStatus: textValue(item.probeStatus),
      probeError: textValue(item.probeError),
    })).filter((item) => Boolean(item.url));
  return routes.length ? routes : undefined;
}

function mapLocateResult(payload: unknown): ScanSciLookupState {
  const root = asObject(payload) ?? {};
  const route = asObject(root.route);
  const routes = mapRoutes(root.routes);
  const manualRoutes = mapRoutes(root.manualRoutes);
  const publicationRoutes = mapRoutes(root.publicationRoutes);
  return {
    status: root.status === "found" ? "found" : root.status === "unavailable" ? "unavailable" : root.status === "error" ? "error" : "not-found",
    source: textValue(route?.source) || routes?.[0]?.source,
    url: textValue(route?.url) || routes?.[0]?.url,
    isPdf: route?.isPdf === true || routes?.[0]?.isPdf === true,
    routeId: textValue(route?.routeId) || textValue(root.routeId) || routes?.[0]?.routeId,
    probeStatus: textValue(route?.probeStatus) || routes?.[0]?.probeStatus,
    probeError: textValue(route?.probeError) || routes?.[0]?.probeError,
    routes,
    manualRoutes,
    publicationRoutes,
    checkedSources: Number(root.checkedSources) || undefined,
    totalSources: Number(root.totalSources) || undefined,
    error: textValue(root.error),
  };
}

function createPdfObjectUrl(blob: Blob): string | undefined {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return undefined;
  return URL.createObjectURL(blob);
}

export function knownAccessUrl(paper: Pick<Paper, "oaUrl" | "pdfUrl" | "isOpenAccess">): string | undefined {
  return paper.oaUrl || (paper.isOpenAccess ? paper.pdfUrl : undefined);
}

export function selectScanSciPapers(
  papers: UnifiedPaper[],
  settings: ProviderSettings,
  selectedPaperId?: string,
): UnifiedPaper[] {
  if (settings.scansciScope === "selected") return papers.filter((paper) => paper.id === selectedPaperId);
  if (settings.scansciScope === "all") return papers;
  const limit = Math.max(1, Math.min(50, Math.round(settings.scansciTopN) || 1));
  return papers.slice(0, limit);
}

export const scansciService = {
  async checkStatus(settings: ProviderSettings): Promise<ScanSciConnectionStatus> {
    if (!settings.scansciEnabled || !settings.scansciAutoSearch) return "disabled";
    try {
      const payload = await requestJson<JsonObject>("/api/status", { method: "GET" }, settings.scansciTimeoutMs);
      const engine = asObject(payload.engine);
      return payload.status === "ok" && (!engine || engine.status === "ready") ? "ready" : "error";
    } catch (error) {
      return /404|not found|fetch|network|abort|超时|请求失败/i.test(safeError(error)) ? "unavailable" : "error";
    }
  },

  async searchPaper(paper: Pick<Paper, "title" | "doi">, settings: ProviderSettings): Promise<ScanSciLookupState> {
    const cacheKey = lookupCacheKey(paper, settings);
    const cached = lookupCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
    const inFlight = lookupInFlight.get(cacheKey);
    if (inFlight) return inFlight;

    const request: Promise<ScanSciLookupState> = (async () => {
      try {
        const payload = await requestJson<JsonObject>("/api/papers/locate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody(paper, settings)),
        }, settings.scansciTimeoutMs * 6);
        const result = mapLocateResult(payload);
        lookupCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, result });
        return result;
      } catch (error) {
        return { status: "error", error: safeError(error) };
      }
    })();
    lookupInFlight.set(cacheKey, request);
    void request.finally(() => {
      if (lookupInFlight.get(cacheKey) === request) lookupInFlight.delete(cacheKey);
    });
    return request;
  },

  async downloadPaper(paper: Pick<Paper, "title" | "doi">, settings: ProviderSettings, current?: ScanSciLookupState): Promise<ScanSciLookupState> {
    const timeoutMs = downloadTimeoutMs(settings);
    const routeIds = Array.from(new Set([
      ...(current?.routeId ? [current.routeId] : []),
      ...(current?.routes || [])
        .filter((route) => route.isPdf === true && typeof route.routeId === "string")
        .map((route) => route.routeId as string),
    ]));
    try {
      const response = await fetchInternalApi("/api/papers/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody(paper, settings, timeoutMs, routeIds)),
        signal: AbortSignal.timeout(timeoutMs + DOWNLOAD_TIMEOUT_GRACE_MS),
      });
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!response.ok || !contentType.includes("application/pdf")) {
        let detail = "下载引擎未能获取 PDF";
        try {
          const payload = asObject(await response.json());
          detail = textValue(payload?.error) || textValue(payload?.message) || detail;
        } catch {
          // Keep the generic message for non-JSON failures.
        }
        return retryableDownloadFailure(current, detail);
      }
      const url = createPdfObjectUrl(await response.blob());
      if (!url) return retryableDownloadFailure(current, "浏览器不支持保存 PDF");
      const source = response.headers.get("x-scholarscope-source") || current?.source;
      return {
        ...(current || { status: "found" }),
        status: "found",
        source,
        url,
        isPdf: true,
        downloadStatus: "ready",
      };
    } catch (error) {
      return retryableDownloadFailure(current, safeError(error));
    }
  },

  async discoverPapers(
    papers: UnifiedPaper[],
    settings: ProviderSettings,
    onUpdate: (paperId: string, state: ScanSciLookupState) => void,
    selectedPaperId?: string,
  ): Promise<void> {
    if (!settings.scansciEnabled || !settings.scansciAutoSearch) return;
    const targets = selectScanSciPapers(papers, settings, selectedPaperId);
    for (const paper of targets) {
      onUpdate(paper.id, { status: "checking" });
      const state = await this.searchPaper(paper, settings);
      onUpdate(paper.id, state);
    }
  },
};

export type { ScanSciConnectionStatus };
