import {
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
import { isPlaceholderAbstract } from "./services/abstractLookupService";
import { triggerDownload } from "./services/downloadAction";
import { openExternalUrl } from "./services/externalUrlService";
import { loadSearchHistory, primaryProviderCount, searchLiterature } from "./services/unifiedSearchService";
import { loadProviderSettings, saveProviderSettings } from "./services/providerSettingsService";
import { scansciService, selectScanSciPapers, type ScanSciConnectionStatus } from "./services/scansciService";
import type { SearchFilters, SearchSource } from "./types/athena";
import type { ScanSciLookupState, SearchHistoryEntry, SearchSession, UnifiedPaper } from "./types/search";

const defaultFilters: SearchFilters = {
  disciplines: [],
  openAccessOnly: false,
};

const sourceNames: Record<SearchSource, string> = {
  OpenAlex: "OpenAlex",
  OpenAIRE: "OpenAIRE",
  Crossref: "Crossref",
  "Semantic Scholar": "Semantic Scholar",
  Unpaywall: "Unpaywall",
  arXiv: "arXiv",
  PubMed: "PubMed",
  "Google Scholar": "Google Scholar",
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
    abstract: "暂未返回摘要，正在由内部下载引擎寻找可获取版本。",
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

function DownloadAction({ url, filename, className, onClick, disabled, children }: { url?: string; filename: string; className?: string; onClick?: () => void; disabled?: boolean; children: ReactNode }) {
  function handleClick() {
    triggerDownload(url, filename, onClick);
  }

  return <button className={className} type="button" onClick={handleClick} disabled={disabled || (!url && !onClick)}>{children}</button>;
}

function scanSciLabel(state?: ScanSciLookupState): string | undefined {
  if (!state) return undefined;
  if (state.status === "checking") return "来源检索中";
  if (state.status === "found" && state.downloadStatus === "ready" && state.url?.startsWith("blob:")) return `${state.source || "下载来源"} · PDF 已就绪`;
  if (state.status === "found" && state.downloadStatus === "downloading") return `${state.source || "候选来源"} · 正在获取`;
  if (state.status === "found") return `${state.source || "候选来源"} · 候选来源`;
  if (state.status === "not-found") return "未找到可获取版本";
  if (state.status === "unavailable") return "下载引擎未连接";
  if (state.status === "error") return "下载引擎失败";
  return undefined;
}

function downloadLabel(state?: ScanSciLookupState): string {
  if (state?.downloadStatus === "downloading") return "正在准备 PDF";
  if (state?.downloadStatus === "ready" && state.url?.startsWith("blob:")) return "保存 PDF";
  if (state?.downloadStatus === "error") return "重试获取 PDF";
  return "获取 PDF";
}

type DownloadRoute = Pick<ScanSciLookupState, "source" | "url" | "isPdf" | "routeId">;

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

function PaperPreview({ paper, scanSciState, onDownload }: { paper?: UnifiedPaper; scanSciState?: ScanSciLookupState; onDownload: (route?: DownloadRoute) => void }) {
  if (!paper) {
    return (
      <aside className="preview-panel preview-panel--empty">
        <FileSearch size={34} />
        <h2>选择一条文献</h2>
        <p>右侧会直接显示元数据、摘要、来源和下载按钮。</p>
      </aside>
    );
  }

  const publisherUrl = paper.publisherUrl || paper.sourceUrls.ScholarScope;
  const scanSciUrl = scanSciState?.status === "found" ? scanSciState.url : undefined;
  const waitingForAccess = !scanSciState || scanSciState.status === "checking";
  const downloadedUrl = scanSciState?.downloadStatus === "ready" && scanSciUrl?.startsWith("blob:") ? scanSciUrl : undefined;
  const isDownloading = scanSciState?.downloadStatus === "downloading";
  const canDownloadCandidate = Boolean(downloadedUrl) || scanSciState?.isPdf === true;
  const alternativeRoutes = !downloadedUrl
    ? (scanSciState?.routes ?? []).filter((route) => route.isPdf && route.url && route.routeId && route.routeId !== scanSciState?.routeId).slice(0, 4)
    : [];
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
          </div>
          {paper.mergeWarnings.map((warning) => <p className="warning-text" key={warning}>{warning}</p>)}
        </section>

        {scanSciState && (
          <section className="preview-section">
            <div className="section-title"><Search size={17} /><h2>可获取来源</h2></div>
            {scanSciState.status === "checking" && <p className="muted abstract-status">正在并行检查下载来源…</p>}
            {scanSciState.status === "found" && scanSciUrl && (
              <div className="source-stack">
                {canDownloadCandidate ? (
                  <DownloadAction
                    url={downloadedUrl}
                    filename={paper.title}
                    onClick={onDownload}
                    disabled={isDownloading}
                  >
                    <span className="source-chip source-chip--scansci">{scanSciState.source || "下载来源"}</span>
                    <span>{downloadLabel(scanSciState)}</span>
                    {isDownloading ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}
                  </DownloadAction>
                ) : <p className="muted abstract-status">该候选来源未提供可直接获取的 PDF，请在来源页面查看。</p>}
                {scanSciUrl && !scanSciUrl.startsWith("blob:") && (
                  <ExternalAction url={scanSciUrl}>
                    <span className="source-chip">来源页面</span><span>查看来源</span><ArrowUpRight size={14} />
                  </ExternalAction>
                )}
                {alternativeRoutes.map((route) => (
                  <DownloadAction
                    filename={paper.title}
                    onClick={() => onDownload(route)}
                    disabled={isDownloading}
                    key={route.routeId}
                  >
                    <span className="source-chip source-chip--scansci">{route.source || "备选来源"}</span>
                    <span>改用此来源获取 PDF</span>
                    <Download size={14} />
                  </DownloadAction>
                ))}
              </div>
            )}
            {scanSciState.status === "not-found" && <p className="muted abstract-status">已检查 {scanSciState.checkedSources ?? "多个"} 个下载来源，暂未找到可获取路径。</p>}
            {scanSciState.status === "unavailable" && <p className="muted abstract-status">内部下载引擎尚未就绪。</p>}
            {scanSciState.status === "error" && <p className="muted abstract-status">内部下载引擎暂时失败：{scanSciState.error || "请稍后重试"}</p>}
            {scanSciState.downloadStatus === "error" && <p className="muted abstract-status">本次获取失败：{scanSciState.error || "请重试"}</p>}
          </section>
        )}

      </div>

      <div className="preview-actions">
        {publisherUrl && <ExternalAction className="button button--primary" url={publisherUrl}>查看出版页面 <ExternalLink size={15} /></ExternalAction>}
        {scanSciState?.status === "found" && scanSciUrl && canDownloadCandidate && <DownloadAction className="button" url={downloadedUrl} filename={paper.title} onClick={onDownload} disabled={isDownloading}>{downloadLabel(scanSciState)} <Download size={15} /></DownloadAction>}
        {scanSciState?.status === "found" && scanSciUrl && !canDownloadCandidate && <ExternalAction className="button" url={scanSciUrl}>查看来源 <ExternalLink size={15} /></ExternalAction>}
        {waitingForAccess && <span className="button button--pending">正在寻找可获取版本 <LoaderCircle className="spin" size={15} /></span>}
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
  const [showProviderSettings, setShowProviderSettings] = useState(false);
  const [providerSettings, setProviderSettings] = useState(() => loadProviderSettings());
  const [scanSciResults, setScanSciResults] = useState<Record<string, ScanSciLookupState>>({});
  const [scanSciStatus, setScanSciStatus] = useState<ScanSciConnectionStatus>("disabled");
  const inputRef = useRef<HTMLInputElement>(null);
  const papers = session?.papers ?? [];
  const selectedPaper = papers[selectedIndex];
  const scanSciSelectedId = providerSettings.scansciScope === "selected" ? selectedPaper?.id : undefined;
  const effectiveScanSciStatus: ScanSciConnectionStatus = !session || !providerSettings.scansciEnabled || !providerSettings.scansciAutoSearch
    ? "disabled"
    : scanSciStatus === "disabled" ? "checking" : scanSciStatus;

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

  function updateContactEmail(value: string) {
    const nextSettings = saveProviderSettings({ ...providerSettings, crossrefEmail: value });
    setProviderSettings(nextSettings);
  }

  function updateScanSciSettings(changes: Partial<typeof providerSettings>) {
    const nextSettings = saveProviderSettings({ ...providerSettings, ...changes });
    setProviderSettings(nextSettings);
    setScanSciResults({});
    setScanSciStatus(nextSettings.scansciEnabled && nextSettings.scansciAutoSearch ? "checking" : "disabled");
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
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark"><Search size={20} /></div>
          <div><strong>ScholarScope</strong><span>全球文献发现 · 技术验证版</span></div>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="数据源设置"
            title="数据源设置"
            onClick={() => setShowProviderSettings((visible) => !visible)}
          >
            <Settings2 size={17} />
          </button>
          {showProviderSettings && (
            <div className="provider-settings-popover">
              <strong>当前检索引擎</strong>
              <p>内部下载引擎统一处理元数据和来源定位，多个接口并行兜底，不单独显示某一个接口。</p>
              <label>
                <span>联系邮箱（元数据请求）</span>
                <input
                  type="email"
                  value={providerSettings.crossrefEmail}
                  onChange={(event) => updateContactEmail(event.target.value)}
                  placeholder="可填写真实邮箱以改善元数据请求"
                />
              </label>
              <p>邮箱只保存在本机设置中，用于学术接口请求。</p>
              <label className="popover-toggle">
                <span>自动检查下载来源</span>
                <input
                  type="checkbox"
                  checked={providerSettings.scansciEnabled && providerSettings.scansciAutoSearch}
                  onChange={(event) => updateScanSciSettings({ scansciEnabled: event.target.checked, scansciAutoSearch: event.target.checked })}
                />
              </label>
              <label>
                <span>后台范围</span>
                <select value={providerSettings.scansciScope} onChange={(event) => updateScanSciSettings({ scansciScope: event.target.value as typeof providerSettings.scansciScope })}>
                  <option value="selected">仅当前选中</option>
                  <option value="top">前 N 条结果</option>
                  <option value="all">全部无开放链接结果</option>
                </select>
              </label>
              {providerSettings.scansciScope === "top" && (
                <label>
                  <span>前 N 条</span>
                  <input type="number" min="1" max="50" value={providerSettings.scansciTopN} onChange={(event) => updateScanSciSettings({ scansciTopN: Math.max(1, Math.min(50, Number(event.target.value) || 1)) })} />
                </label>
              )}
              <p>输入题名后先返回元数据，再由内部引擎并行查找来源；找到后提供下载按钮，不会自动下载。</p>
            </div>
          )}
        </div>
      </header>

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
            <span className={`provider-status provider-status--${effectiveScanSciStatus === "ready" ? "success" : effectiveScanSciStatus === "checking" ? "running" : effectiveScanSciStatus === "disabled" ? "disabled" : "error"}`} title="下载引擎只定位来源，点击下载后才获取 PDF">
              {effectiveScanSciStatus === "ready" ? <CheckCircle2 size={13} /> : effectiveScanSciStatus === "disabled" ? <MinusCircle size={13} /> : effectiveScanSciStatus === "checking" ? <LoaderCircle className="spin" size={13} /> : <XCircle size={13} />}
              下载引擎 · {scanSciStatusLabel(effectiveScanSciStatus)}
            </span>
          </div>
        </section>
      )}

      {error && <div className="error-banner"><XCircle size={16} />{error}</div>}

      <main className="workspace">
        <section className="results-panel">
          {loading && !session && (
            <div className="empty-state"><LoaderCircle className="spin" size={34} /><h2>正在检索文献</h2><p>先并行整理元数据，再检查可获取来源。</p></div>
          )}
          {!loading && !session && (
            <div className="start-state">
              <div className="start-state__intro"><FileSearch size={36} /><h1>从一个入口查找论文</h1><p>输入题名或 DOI，先查看文献元数据，再从统一来源池中找到可获取路径。</p></div>
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
          onDownload={(route) => { if (selectedPaper) void downloadPaper(selectedPaper, route); }}
        />
      </main>
    </div>
  );
}
