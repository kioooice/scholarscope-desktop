import {
  ArrowLeft,
  ArrowUpRight,
  BookOpenText,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  ExternalLink,
  FileSearch,
  History,
  LoaderCircle,
  MinusCircle,
  Search,
  Settings2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { isPlaceholderAbstract } from "./services/paperMetadata";
import { triggerDownload } from "./services/downloadAction";
import { chooseDownloadDirectory, getDefaultDownloadDirectory } from "./services/downloadDirectoryService";
import { openExternalUrl } from "./services/externalUrlService";
import { loadSearchHistory, primaryProviderCount, searchLiterature } from "./services/unifiedSearchService";
import { defaultProviderSettings, loadProviderSettings, saveProviderSettings } from "./services/providerSettingsService";
import { scansciService, selectScanSciPapers, type ScanSciConnectionStatus } from "./services/scansciService";
import { SearchSettingsPage, type SearchEngineStatus } from "./pages/SearchSettingsPage";
import type { ProviderSettings, SearchFilters, SearchSource } from "./types/scholarscope";
import type { ScanSciLookupState, ScanSciRoute, SearchHistoryEntry, SearchSession, UnifiedPaper } from "./types/search";

const defaultFilters: SearchFilters = {
  disciplines: [],
  openAccessOnly: false,
};

const sourceNames: Record<SearchSource, string> = {
  Crossref: "Crossref",
  OpenAlex: "OpenAlex",
  ScholarScope: "下载引擎",
};

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

function providerFailureLabel(error?: string): string {
  if (/未配置|未启用/i.test(error ?? "")) return "未启用";
  if (/仅对 DOI|仅 DOI/i.test(error ?? "")) return "仅 DOI";
  if (/联系邮箱/i.test(error ?? "")) return "需邮箱";
  if (/429|too many requests|限流/i.test(error ?? "")) return "限流";
  if (/403|forbidden|API Key/i.test(error ?? "")) return "鉴权失败";
  return "失败";
}

function scanSciStatusLabel(status: ScanSciConnectionStatus): string {
  if (status === "disabled") return "未启用";
  if (status === "checking") return "连接中";
  if (status === "ready") return "已连接";
  if (status === "unavailable") return "未连接";
  return "失败";
}

function doiUrl(doi?: string): string | undefined {
  return doi ? `https://doi.org/${doi}` : undefined;
}

function authorLine(paper: UnifiedPaper): string {
  if (!paper.authors.length) return "作者信息缺失";
  const visible = paper.authors.slice(0, 4).join("、");
  return paper.authors.length > 4 ? `${visible} 等` : visible;
}

function queryFallbackPaper(query: string): UnifiedPaper {
  const doi = /^(?:https?:\/\/(?:dx\.)?doi\.org\/)?10\.\d{4,9}\/\S+$/i.test(query) ? query.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "") : undefined;
  return {
    id: `query:${query.toLowerCase()}`,
    doi,
    title: query,
    authors: [],
    abstract: "暂未返回摘要，正在由来源引擎整理可打开链接。",
    citationCount: 0,
    isOpenAccess: false,
    sourceProvider: "ScholarScope",
    concepts: [],
    topics: [],
    keywords: [],
    references: [],
    relatedPapers: [],
    sourceProviders: [],
    sourceUrls: {},
    mergeWarnings: [],
    relevanceScore: 0,
  };
}

function SourceChip({ source }: { source: SearchSource }) {
  return <span className="source-chip">{sourceNames[source]}</span>;
}

function ExternalAction({ url, className, children }: { url: string; className?: string; children: ReactNode }) {
  function handleClick() {
    void openExternalUrl(url).catch((openError) => {
      console.error("Failed to open external URL", openError);
      window.alert("无法打开链接，请检查 Windows 默认浏览器设置后重试。");
    });
  }

  return (
    <button className={className} type="button" onClick={handleClick}>
      {children}
    </button>
  );
}

function DownloadAction({ url, filename, className, onClick, disabled, downloadDirectory, children }: { url?: string; filename: string; className?: string; onClick?: () => void; disabled?: boolean; downloadDirectory?: string; children: ReactNode }) {
  function handleClick() {
    void triggerDownload(url, filename, onClick, downloadDirectory);
  }

  return <button className={className} type="button" onClick={handleClick} disabled={disabled || (!url && !onClick)}>{children}</button>;
}

function scanSciLabel(state?: ScanSciLookupState): string | undefined {
  if (!state) return undefined;
  if (state.status === "checking") return "来源检索中";
  if (state.status === "found" && state.downloadStatus === "ready" && state.url?.startsWith("blob:")) return `${state.source || "下载来源"} · PDF 已就绪`;
  if (state.status === "found" && state.downloadStatus === "downloading") return `${state.source || "候选来源"} · 正在获取`;
  if (state.status === "found" && (state.routes?.length ?? 0) > 0) return `${state.routes?.length} 个 PDF 候选`;
  if (state.status === "found" && (state.manualRoutes?.length ?? 0) > 0) return `${state.manualRoutes?.length} 个手动候选`;
  if (state.status === "found" && (state.publicationRoutes?.length ?? 0) > 0) return "出版页面已就绪";
  if (state.status === "found") return "未找到可获取 PDF";
  if (state.status === "not-found") return "未找到来源链接";
  if (state.status === "unavailable") return "来源引擎未连接";
  if (state.status === "error") return "来源引擎失败";
  return undefined;
}

function downloadLabel(state?: ScanSciLookupState): string {
  if (state?.downloadStatus === "downloading") return "正在准备 PDF";
  if (state?.downloadStatus === "ready" && state.url?.startsWith("blob:")) return "保存 PDF";
  if (state?.downloadStatus === "error") return "重试获取 PDF";
  return "应用内获取 PDF";
}

type DownloadRoute = Pick<ScanSciRoute, "source" | "url" | "isPdf" | "routeId">;

function PaperRow({ paper, active, onSelect, scanSciState }: { paper: UnifiedPaper; active: boolean; onSelect: () => void; scanSciState?: ScanSciLookupState }) {
  return (
    <button className={`paper-row${active ? " paper-row--active" : ""}`} type="button" onClick={onSelect}>
      <div className="paper-row__title">{paper.title}</div>
      <div className="paper-row__authors">{authorLine(paper)}</div>
      <div className="paper-row__meta">
        <span>{paper.year ?? "年份未知"}</span>
        <span>{paper.journal || paper.publisher || "来源刊物未知"}</span>
        <span>被引 {paper.citationCount}</span>
        {paper.isOpenAccess && <span className="oa-badge">开放获取</span>}
      </div>
      <div className="paper-row__sources">
        {paper.sourceProviders.map((source) => <SourceChip source={source} key={source} />)}
        {scanSciState?.status === "found" && <span className="source-chip source-chip--scansci">{scanSciLabel(scanSciState)}</span>}
        {scanSciState?.status === "checking" && <span className="source-chip source-chip--checking">{scanSciLabel(scanSciState)}</span>}
      </div>
    </button>
  );
}

function PaperPreview({ paper, scanSciState, downloadDirectory, onDownload }: { paper?: UnifiedPaper; scanSciState?: ScanSciLookupState; downloadDirectory?: string; onDownload: (route?: DownloadRoute) => void }) {
  if (!paper) {
    return (
      <aside className="preview-panel preview-panel--empty">
        <FileSearch size={34} />
        <h2>选择一条文献</h2>
        <p>右侧会直接显示元数据、摘要、来源和打开链接。</p>
      </aside>
    );
  }

  const publisherUrl = paper.publisherUrl || paper.sourceUrls.ScholarScope;
  const downloadRoutes = scanSciState?.routes ?? [];
  const manualRoutes = scanSciState?.manualRoutes ?? [];
  const publicationRoutes = scanSciState?.publicationRoutes ?? [];
  const activeDownloadRoute = downloadRoutes.find((route) => route.routeId === scanSciState?.routeId) || downloadRoutes[0];
  const scanSciUrl = scanSciState?.status === "found" ? activeDownloadRoute?.url : undefined;
  const waitingForAccess = !scanSciState || scanSciState.status === "checking";
  const downloadedUrl = scanSciState?.downloadStatus === "ready" && scanSciState.url?.startsWith("blob:") ? scanSciState.url : undefined;
  const isDownloading = scanSciState?.downloadStatus === "downloading";
  const verifiedPdfCandidate = activeDownloadRoute?.isPdf === true && activeDownloadRoute.probeStatus === "verified";
  const abstract = paper.abstract;

  return (
    <aside className="preview-panel">
      <div className="preview-panel__scroll">
        <div className="preview-kicker">
          <span>{paper.year ?? "年份未知"}</span>
          <span>被引 {paper.citationCount}</span>
          {paper.isOpenAccess && <span className="oa-badge">开放获取</span>}
        </div>
        <h1>{paper.title}</h1>
        <p className="preview-authors">{authorLine(paper)}</p>
        <dl className="metadata-grid">
          <div><dt>期刊/会议</dt><dd>{paper.journal || "—"}</dd></div>
          <div><dt>出版方</dt><dd>{paper.publisher || "—"}</dd></div>
          <div><dt>DOI</dt><dd>{paper.doi || "—"}</dd></div>
          <div><dt>合并来源</dt><dd>{paper.sourceProviders.length} 个平台</dd></div>
        </dl>

        <section className="preview-section">
          <div className="section-title"><BookOpenText size={17} /><h2>摘要</h2></div>
          <p className={isPlaceholderAbstract(abstract) ? "muted" : ""}>{abstract}</p>
          {isPlaceholderAbstract(abstract) && <p className="muted abstract-status">当前元数据接口未提供摘要。</p>}
        </section>

        {(paper.topics.length > 0 || paper.concepts.length > 0) && (
          <section className="preview-section">
            <div className="section-title"><Database size={17} /><h2>主题</h2></div>
            <div className="topic-list">
              {Array.from(new Set([...paper.topics, ...paper.concepts])).slice(0, 10).map((topic) => <span key={topic}>{topic}</span>)}
            </div>
          </section>
        )}

        <section className="preview-section">
          <div className="section-title"><ShieldCheck size={17} /><h2>来源核验</h2></div>
          <div className="source-stack">
            {paper.sourceProviders.filter((source) => paper.sourceUrls[source]).map((source) => (
              <ExternalAction url={paper.sourceUrls[source]!} key={source}>
                <SourceChip source={source} /><span>查看该平台记录</span><ArrowUpRight size={14} />
              </ExternalAction>
            ))}
            {publicationRoutes.slice(0, 4).map((route) => (
              <ExternalAction url={route.url!} key={`${route.source}:${route.url}`}>
                <span className="source-chip">{route.source || "出版页面"}</span><span>查看出版页面</span><ArrowUpRight size={14} />
              </ExternalAction>
            ))}
          </div>
          {paper.mergeWarnings.map((warning) => <p className="warning-text" key={warning}>{warning}</p>)}
        </section>

        {scanSciState && (
          <section className="preview-section">
            <div className="section-title"><Search size={17} /><h2>获取来源</h2></div>
            {scanSciState.status === "checking" && <p className="muted abstract-status">正在核验可获取的 PDF…</p>}
            {scanSciState.status === "found" && (
              <>
                {downloadedUrl && (
                  <div className="source-stack">
                    <DownloadAction
                      url={downloadedUrl}
                      filename={paper.title}
                      downloadDirectory={downloadDirectory}
                      onClick={onDownload}
                      disabled={isDownloading}
                    >
                      <span className="source-chip source-chip--scansci">{scanSciState.source || "下载来源"}</span>
                      <span>{downloadLabel(scanSciState)}</span>
                      <Download size={14} />
                    </DownloadAction>
                  </div>
                )}
                {downloadRoutes.length > 0 && (
                  <div className="source-stack">
                    {downloadRoutes.slice(0, 6).map((route) => (
                      <ExternalAction url={route.url!} key={route.routeId || `${route.source}:${route.url}`}>
                        <span className="source-chip source-chip--scansci">{route.source || "PDF 来源"}</span><span>打开已验证 PDF</span><ArrowUpRight size={14} />
                      </ExternalAction>
                    ))}
                    {!downloadedUrl && verifiedPdfCandidate && (
                      <DownloadAction
                        filename={paper.title}
                        onClick={() => onDownload(activeDownloadRoute)}
                        disabled={isDownloading}
                      >
                        <span className="source-chip source-chip--scansci">{activeDownloadRoute?.source || "下载来源"}</span>
                        <span>{downloadLabel(scanSciState)}</span>
                        {isDownloading ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}
                      </DownloadAction>
                    )}
                  </div>
                )}
                {manualRoutes.length > 0 && (
                  <>
                    <p className="muted abstract-status">手动获取候选</p>
                    <div className="source-stack">
                      {manualRoutes.slice(0, 6).map((route) => (
                        <ExternalAction url={route.url!} key={`${route.source}:${route.url}`}>
                          <span className="source-chip">{route.source || "候选来源"}</span><span>在浏览器中尝试获取</span><ArrowUpRight size={14} />
                        </ExternalAction>
                      ))}
                    </div>
                  </>
                )}
                {downloadRoutes.length === 0 && manualRoutes.length === 0 && (
                  <p className="muted abstract-status">本次未找到可获取的 PDF，可查看出版页面核验。</p>
                )}
              </>
            )}
            {scanSciState.status === "not-found" && <p className="muted abstract-status">已检查 {scanSciState.checkedSources ?? "多个"} 个来源，暂未找到可获取的 PDF。</p>}
            {scanSciState.status === "unavailable" && <p className="muted abstract-status">内部来源引擎尚未就绪。</p>}
            {scanSciState.status === "error" && <p className="muted abstract-status">内部来源引擎暂时失败：{scanSciState.error || "请稍后重试"}</p>}
            {scanSciState.downloadStatus === "error" && <p className="muted abstract-status">本次获取失败：{scanSciState.error || "请重试"}</p>}
          </section>
        )}

      </div>

      <div className="preview-actions">
        {publisherUrl && <ExternalAction className="button button--primary" url={publisherUrl}>查看出版页面 <ExternalLink size={15} /></ExternalAction>}
        {scanSciState?.status === "found" && scanSciUrl && !downloadedUrl && <ExternalAction className="button" url={scanSciUrl}>打开 PDF <ExternalLink size={15} /></ExternalAction>}
        {scanSciState?.status === "found" && verifiedPdfCandidate && !downloadedUrl && <DownloadAction className="button" filename={paper.title} downloadDirectory={downloadDirectory} onClick={() => onDownload(activeDownloadRoute)} disabled={isDownloading}>{downloadLabel(scanSciState)} <Download size={15} /></DownloadAction>}
        {downloadedUrl && <DownloadAction className="button" url={downloadedUrl} filename={paper.title} downloadDirectory={downloadDirectory} onClick={onDownload} disabled={isDownloading}>{downloadLabel(scanSciState)} <Download size={15} /></DownloadAction>}
        {waitingForAccess && <span className="button button--pending">正在整理来源链接 <LoaderCircle className="spin" size={15} /></span>}
        {doiUrl(paper.doi) && <ExternalAction className="button" url={doiUrl(paper.doi)!}>打开 DOI <ExternalLink size={15} /></ExternalAction>}
      </div>
    </aside>
  );
}

export default function App() {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>(defaultFilters);
  const [session, setSession] = useState<SearchSession>();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [history, setHistory] = useState<SearchHistoryEntry[]>(() => loadSearchHistory());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [showSettings, setShowSettings] = useState(false);
  const [providerSettings, setProviderSettings] = useState(() => loadProviderSettings());
  const [defaultDownloadDirectory, setDefaultDownloadDirectory] = useState("");
  const [downloadDirectoryBusy, setDownloadDirectoryBusy] = useState(false);
  const [scanSciResults, setScanSciResults] = useState<Record<string, ScanSciLookupState>>({});
  const [scanSciStatus, setScanSciStatus] = useState<ScanSciConnectionStatus>("disabled");
  const inputRef = useRef<HTMLInputElement>(null);
  const papers = session?.papers ?? [];
  const selectedPaper = papers[selectedIndex];
  const scanSciSelectedId = providerSettings.scansciScope === "selected" ? selectedPaper?.id : undefined;
  const effectiveScanSciStatus: ScanSciConnectionStatus = !session || !providerSettings.scansciEnabled || !providerSettings.scansciAutoSearch
    ? "disabled"
    : scanSciStatus === "disabled" ? "checking" : scanSciStatus;
  const settingsEngineStatus: SearchEngineStatus = !providerSettings.scansciEnabled || !providerSettings.scansciAutoSearch
    ? "disabled"
    : !session ? "idle" : scanSciStatus;

  const successfulProviders = useMemo(
    () => session?.diagnostics.filter((item) => item.status === "success").length ?? 0,
    [session],
  );

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === "Escape") inputRef.current?.focus();
      if (event.key === "ArrowDown" && papers.length) {
        event.preventDefault();
        setSelectedIndex((index) => Math.min(papers.length - 1, index + 1));
      }
      if (event.key === "ArrowUp" && papers.length) {
        event.preventDefault();
        setSelectedIndex((index) => Math.max(0, index - 1));
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [papers.length]);

  useEffect(() => {
    let active = true;
    void getDefaultDownloadDirectory()
      .then((directory) => {
        if (active && directory) setDefaultDownloadDirectory(directory);
      })
      .catch((directoryError) => {
        console.error("Failed to resolve the default download directory", directoryError);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (!session || !providerSettings.scansciEnabled || !providerSettings.scansciAutoSearch) {
      return () => { active = false; };
    }

    const onUpdate = (paperId: string, state: ScanSciLookupState) => {
      if (active) setScanSciResults((current) => ({ ...current, [paperId]: state }));
    };

    void (async () => {
      const connection = await scansciService.checkStatus(providerSettings);
      if (!active) return;
      setScanSciStatus(connection);
      const targets = selectScanSciPapers(session.papers, providerSettings, scanSciSelectedId);
      if (connection !== "ready") {
        targets.forEach((paper) => onUpdate(paper.id, { status: connection === "error" ? "error" : "unavailable" }));
        return;
      }
      await scansciService.discoverPapers(session.papers, providerSettings, onUpdate, scanSciSelectedId);
    })().catch((discoveryError) => {
      if (!active) return;
      setScanSciStatus("error");
      console.error("Internal download discovery failed", discoveryError);
    });

    return () => { active = false; };
  }, [providerSettings, scanSciSelectedId, session]);

  async function runSearch(searchQuery = query) {
    const cleanQuery = searchQuery.trim();
    if (!cleanQuery || loading) return;
    setQuery(cleanQuery);
    setLoading(true);
    setError(undefined);
    setScanSciResults({});
    setScanSciStatus(providerSettings.scansciEnabled && providerSettings.scansciAutoSearch ? "checking" : "disabled");
    try {
      const nextSession = await searchLiterature(cleanQuery, filters);
      const visibleSession = nextSession.rawResultCount === 0
        ? { ...nextSession, papers: [queryFallbackPaper(cleanQuery)], mergedResultCount: 1 }
        : nextSession;
      setSession(visibleSession);
      setSelectedIndex(0);
      setHistory(loadSearchHistory());
      if (!nextSession.rawResultCount) setError(undefined);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "检索失败");
    } finally {
      setLoading(false);
    }
  }

  function updateProviderSettings(changes: Partial<ProviderSettings>) {
    const nextSettings = saveProviderSettings({ ...providerSettings, ...changes });
    setProviderSettings(nextSettings);
    const scanSciKeys: Array<keyof ProviderSettings> = [
      "scansciEnabled",
      "scansciAutoSearch",
      "scansciScope",
      "scansciTopN",
      "scansciTimeoutMs",
      "scansciScihubEnabled",
      "scansciUseTor",
    ];
    if (Object.keys(changes).some((key) => scanSciKeys.includes(key as keyof ProviderSettings))) {
      setScanSciResults({});
      setScanSciStatus(nextSettings.scansciEnabled && nextSettings.scansciAutoSearch ? "checking" : "disabled");
    }
  }

  function resetProviderSettings() {
    const nextSettings = saveProviderSettings({ ...defaultProviderSettings });
    setProviderSettings(nextSettings);
    setScanSciResults({});
    setScanSciStatus(nextSettings.scansciEnabled && nextSettings.scansciAutoSearch ? "checking" : "disabled");
  }

  async function selectDownloadDirectory() {
    if (downloadDirectoryBusy) return;
    setDownloadDirectoryBusy(true);
    try {
      const directory = await chooseDownloadDirectory();
      if (directory) updateProviderSettings({ downloadDirectory: directory });
    } catch (directoryError) {
      console.error("Failed to choose a download directory", directoryError);
      globalThis.alert?.("无法选择保存文件夹，请检查桌面应用权限后重试。");
    } finally {
      setDownloadDirectoryBusy(false);
    }
  }

  async function checkScanSciStatus() {
    if (!providerSettings.scansciEnabled || !providerSettings.scansciAutoSearch) return;
    setScanSciStatus("checking");
    const status = await scansciService.checkStatus(providerSettings);
    setScanSciStatus(status);
  }

  async function downloadPaper(paper: UnifiedPaper, route?: DownloadRoute) {
    const existing = scanSciResults[paper.id];
    const current: ScanSciLookupState | undefined = route && existing
      ? { ...existing, ...route, status: "found", downloadStatus: "idle", error: undefined }
      : existing;
    if (!current || current.status !== "found" || current.downloadStatus === "downloading") return;
    setScanSciResults((states) => ({ ...states, [paper.id]: { ...current, downloadStatus: "downloading", error: undefined } }));
    const result = await scansciService.downloadPaper(paper, providerSettings, current);
    setScanSciResults((states) => ({ ...states, [paper.id]: result }));
  }

  return (
    <div className={`app-shell${showSettings ? " app-shell--settings" : ""}`}>
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark"><Search size={20} /></div>
          <div><strong>ScholarScope</strong><span>全球文献发现 · 技术验证版</span></div>
        </div>
        <div className="header-actions">
          {showSettings ? (
            <button type="button" className="header-back" onClick={() => setShowSettings(false)}>
              <ArrowLeft size={16} />返回搜索
            </button>
          ) : (
            <button
              type="button"
              className="icon-button"
              aria-label="打开设置"
              title="打开设置"
              onClick={() => setShowSettings(true)}
            >
              <Settings2 size={17} />
            </button>
          )}
        </div>
      </header>

      {showSettings ? (
        <SearchSettingsPage
          settings={providerSettings}
          engineStatus={settingsEngineStatus}
          onUpdate={updateProviderSettings}
          onReset={resetProviderSettings}
          onCheckEngine={() => { void checkScanSciStatus(); }}
          defaultDownloadDirectory={defaultDownloadDirectory}
          downloadDirectoryBusy={downloadDirectoryBusy}
          onChooseDownloadDirectory={() => { void selectDownloadDirectory(); }}
        />
      ) : <>
      <section className="search-zone">
        <form className="command-bar" onSubmit={(event) => { event.preventDefault(); void runSearch(); }}>
          {loading ? <LoaderCircle className="spin" size={22} /> : <Search size={22} />}
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入主题、论文标题、DOI 或作者，例如：alkaline zinc deep recess current distribution"
            aria-label="全球文献搜索"
          />
          <kbd>Ctrl K</kbd>
          <button type="submit" disabled={loading || !query.trim()}>搜索</button>
        </form>
        <div className="filter-row">
          <label><span>起始年份</span><input type="number" min="1500" max="2100" value={filters.minYear ?? ""} onChange={(event) => setFilters({ ...filters, minYear: event.target.value ? Number(event.target.value) : undefined })} placeholder="不限" /></label>
          <label><span>结束年份</span><input type="number" min="1500" max="2100" value={filters.maxYear ?? ""} onChange={(event) => setFilters({ ...filters, maxYear: event.target.value ? Number(event.target.value) : undefined })} placeholder="不限" /></label>
          <label><span>最低被引</span><input type="number" min="0" value={filters.minCitations ?? ""} onChange={(event) => setFilters({ ...filters, minCitations: event.target.value ? Number(event.target.value) : undefined })} placeholder="不限" /></label>
          <label className="toggle"><input type="checkbox" checked={filters.openAccessOnly} onChange={(event) => setFilters({ ...filters, openAccessOnly: event.target.checked })} /><span>仅开放获取</span></label>
          <div className="keyboard-hint">↑ ↓ 切换文献 · Esc 返回搜索框</div>
        </div>
      </section>

      {session && (
        <section className="session-bar">
          <div><strong>{session.mergedResultCount}</strong> 条统一结果<span>由 {session.rawResultCount} 条原始记录合并</span></div>
          <div><Clock3 size={14} />{session.cacheHit ? "缓存命中" : formatDuration(session.durationMs)}</div>
          <div><Database size={14} />{successfulProviders}/{primaryProviderCount} 统一引擎可用</div>
          <div className="provider-statuses">
            {session.diagnostics.map((item) => (
              <span className={`provider-status provider-status--${item.status}`} title={item.error} key={item.provider}>
                {item.status === "disabled" ? <MinusCircle size={13} /> : item.status === "success" ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                {sourceNames[item.provider]} · {item.status === "success" ? `${item.resultCount} 条 / ${formatDuration(item.durationMs)}` : item.status === "timeout" ? "超时" : providerFailureLabel(item.error)}
              </span>
            ))}
            <span className={`provider-status provider-status--${effectiveScanSciStatus === "ready" ? "success" : effectiveScanSciStatus === "checking" ? "running" : effectiveScanSciStatus === "disabled" ? "disabled" : "error"}`} title="来源默认在浏览器打开；已验证 PDF 可选择应用内获取">
              {effectiveScanSciStatus === "ready" ? <CheckCircle2 size={13} /> : effectiveScanSciStatus === "disabled" ? <MinusCircle size={13} /> : effectiveScanSciStatus === "checking" ? <LoaderCircle className="spin" size={13} /> : <XCircle size={13} />}
              来源引擎 · {scanSciStatusLabel(effectiveScanSciStatus)}
            </span>
          </div>
        </section>
      )}

      {error && <div className="error-banner"><XCircle size={16} />{error}</div>}

      <main className="workspace">
        <section className="results-panel">
          {loading && !session && (
            <div className="empty-state"><LoaderCircle className="spin" size={34} /><h2>正在检索文献</h2><p>先并行整理元数据，再整理来源链接。</p></div>
          )}
          {!loading && !session && (
            <div className="start-state">
              <div className="start-state__intro"><FileSearch size={36} /><h1>从一个入口查找论文</h1><p>输入题名或 DOI，先查看文献元数据，再从统一来源池中找到可打开链接。</p></div>
              {history.length > 0 && (
                <div className="history-block">
                  <div className="section-title"><History size={17} /><h2>最近检索</h2></div>
                  {history.map((item) => <button type="button" onClick={() => void runSearch(item.query)} key={item.id}><span>{item.query}</span><small>{item.mergedResultCount} 条 · {formatDuration(item.durationMs)}</small></button>)}
                </div>
              )}
            </div>
          )}
          {session && papers.length === 0 && !loading && <div className="empty-state"><FileSearch size={34} /><h2>没有可显示的结果</h2><p>可以减少限定词、关闭“仅开放获取”，或调整检索词后重试。</p></div>}
          {papers.map((paper, index) => <PaperRow paper={paper} active={index === selectedIndex} scanSciState={scanSciResults[paper.id]} onSelect={() => setSelectedIndex(index)} key={`${paper.id}-${index}`} />)}
        </section>
        <PaperPreview
          paper={selectedPaper}
          scanSciState={selectedPaper ? scanSciResults[selectedPaper.id] : undefined}
          downloadDirectory={providerSettings.downloadDirectory}
          onDownload={(route) => { if (selectedPaper) void downloadPaper(selectedPaper, route); }}
        />
      </main>
      </>}
    </div>
  );
}
