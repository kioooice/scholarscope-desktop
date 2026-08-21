import {
  ArrowUpRight,
  BookOpenText,
  CheckCircle2,
  Clock3,
  Database,
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
import { abstractLookupService, isPlaceholderAbstract } from "./services/abstractLookupService";
import { containsChineseText, identifyChinesePlatforms } from "./services/chinesePlatformService";
import { openExternalUrl } from "./services/externalUrlService";
import { loadSearchHistory, searchLiterature } from "./services/unifiedSearchService";
import { loadProviderSettings, saveProviderSettings } from "./services/providerSettingsService";
import { openAccessFallbackLinks, unpaywallService } from "./services/unpaywallService";
import type { OpenAccessLookupResult } from "./services/unpaywallService";
import type { SearchFilters, SearchSource } from "./types/athena";
import type { SearchHistoryEntry, SearchSession, UnifiedPaper } from "./types/search";

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

function doiUrl(doi?: string): string | undefined {
  return doi ? `https://doi.org/${doi}` : undefined;
}

function authorLine(paper: UnifiedPaper): string {
  if (!paper.authors.length) return "作者信息缺失";
  const visible = paper.authors.slice(0, 4).join("、");
  return paper.authors.length > 4 ? `${visible} 等` : visible;
}

function SourceChip({ source }: { source: SearchSource }) {
  return <span className="source-chip">{sourceNames[source]}</span>;
}

function shouldShowChinesePlatforms(paper: UnifiedPaper, query: string): boolean {
  return containsChineseText(paper.title) || (containsChineseText(query) && identifyChinesePlatforms(paper).length > 0);
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

function ChinesePlatformChips({ paper, enabled }: { paper: UnifiedPaper; enabled: boolean }) {
  if (!enabled) return null;
  const identified = identifyChinesePlatforms(paper);
  return identified.map((platform) => (
    <span className="source-chip source-chip--chinese" title={`已确认${platform.label}记录`} key={platform.key}>
      {platform.label}记录
    </span>
  ));
}

function PaperRow({ paper, active, onSelect, showChinesePlatforms }: { paper: UnifiedPaper; active: boolean; onSelect: () => void; showChinesePlatforms: boolean }) {
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
        <ChinesePlatformChips paper={paper} enabled={showChinesePlatforms} />
      </div>
    </button>
  );
}

function PaperPreview({ paper, showChinesePlatforms }: { paper?: UnifiedPaper; showChinesePlatforms: boolean }) {
  const [accessLookup, setAccessLookup] = useState<{
    paperId: string;
    status: "idle" | "checking" | "done" | "error";
    result?: OpenAccessLookupResult;
  }>({ paperId: "", status: "idle" });
  const [abstractLookup, setAbstractLookup] = useState<{
    paperId: string;
    status: "idle" | "checking" | "found" | "not-found" | "error";
    abstract?: string;
  }>({ paperId: "", status: "idle" });

  useEffect(() => {
    if (!paper?.doi || !isPlaceholderAbstract(paper.abstract)) return;
    let active = true;
    void abstractLookupService.findByDoi(paper.doi).then((result) => {
      if (!active) return;
      setAbstractLookup({
        paperId: paper.id,
        status: result.status === "found" ? "found" : "not-found",
        abstract: result.abstract,
      });
    }).catch(() => {
      if (active) setAbstractLookup({ paperId: paper.id, status: "error" });
    });
    return () => { active = false; };
  }, [paper?.abstract, paper?.doi, paper?.id]);

  useEffect(() => {
    if (!paper || showChinesePlatforms) return;
    const knownOpenUrl = paper.oaUrl || (paper.isOpenAccess ? paper.pdfUrl : undefined);
    if (knownOpenUrl) return;

    let active = true;
    void unpaywallService.findOpenAccessVersion(paper).then((result) => {
      if (active) setAccessLookup({ paperId: paper.id, status: "done", result });
    }).catch(() => {
      if (active) setAccessLookup({ paperId: paper.id, status: "error" });
    });

    return () => { active = false; };
  }, [paper, showChinesePlatforms]);

  if (!paper) {
    return (
      <aside className="preview-panel preview-panel--empty">
        <FileSearch size={34} />
        <h2>选择一条文献</h2>
        <p>右侧会直接显示元数据、摘要、来源和可访问页面，不在工具内下载全文。</p>
      </aside>
    );
  }

  const publisherUrl = paper.publisherUrl || paper.sourceUrls.OpenAlex || paper.sourceUrls.Crossref || paper.sourceUrls.OpenAIRE || paper.sourceUrls["Semantic Scholar"];
  const knownOpenUrl = paper.oaUrl || (paper.isOpenAccess ? paper.pdfUrl : undefined);
  const fallbackLinks = openAccessFallbackLinks(paper);
  const currentLookup = accessLookup.paperId === paper.id
    ? accessLookup
    : { paperId: paper.id, status: knownOpenUrl || showChinesePlatforms ? "done" as const : "checking" as const };
  const locatedOpenUrl = currentLookup.result?.status === "found" ? currentLookup.result.url : undefined;
  const abstract = abstractLookup.paperId === paper.id && abstractLookup.status === "found"
    ? abstractLookup.abstract ?? paper.abstract
    : paper.abstract;
  const currentAbstractLookup = abstractLookup.paperId === paper.id
    ? abstractLookup
    : { paperId: paper.id, status: paper.doi && isPlaceholderAbstract(paper.abstract) ? "checking" as const : "idle" as const };
  const identifiedChinesePlatforms = identifyChinesePlatforms(paper);

  return (
    <aside className="preview-panel">
      <div className="preview-panel__scroll">
        <div className="preview-kicker">
          <span>{paper.year ?? "年份未知"}</span>
          <span>被引 {paper.citationCount}</span>
          {(paper.isOpenAccess || locatedOpenUrl) && <span className="oa-badge">开放获取</span>}
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
          {currentAbstractLookup.status === "checking" && <p className="muted abstract-status">正在从其他公开元数据源补充摘要…</p>}
          {currentAbstractLookup.status === "found" && <p className="abstract-source">摘要来源：OpenAIRE</p>}
          {currentAbstractLookup.status === "error" && <p className="muted abstract-status">其他公开元数据源暂未提供摘要。</p>}
        </section>

        {(paper.topics.length > 0 || paper.concepts.length > 0) && (
          <section className="preview-section">
            <div className="section-title"><Database size={17} /><h2>主题</h2></div>
            <div className="topic-list">
              {Array.from(new Set([...paper.topics, ...paper.concepts])).slice(0, 10).map((topic) => <span key={topic}>{topic}</span>)}
            </div>
          </section>
        )}

        {showChinesePlatforms && identifiedChinesePlatforms.length > 0 && (
          <section className="preview-section">
            <div className="section-title"><Database size={17} /><h2>中文平台归属</h2></div>
            <div className="source-stack">
              {identifiedChinesePlatforms.map((platform) => (
                <ExternalAction url={platform.recordUrl} key={platform.key}>
                  <span className="source-chip source-chip--chinese">{platform.label}</span>
                  <span>打开已确认记录</span>
                  <ArrowUpRight size={14} />
                </ExternalAction>
              ))}
            </div>
            <p className="muted platform-note">这里只显示已经确认的收录平台；打开后可在你有权限的平台内查看或下载。</p>
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

      </div>

      <div className="preview-actions">
        {publisherUrl && <ExternalAction className="button button--primary" url={publisherUrl}>查看出版页面 <ExternalLink size={15} /></ExternalAction>}
        {!showChinesePlatforms && knownOpenUrl && <ExternalAction className="button" url={knownOpenUrl}>查看开放版本 <ExternalLink size={15} /></ExternalAction>}
        {!showChinesePlatforms && !knownOpenUrl && locatedOpenUrl && <ExternalAction className="button" url={locatedOpenUrl}>查看开放版本 <ExternalLink size={15} /></ExternalAction>}
        {!showChinesePlatforms && !knownOpenUrl && currentLookup.status === "checking" && (
          <span className="button button--pending">正在检查开放版本 <LoaderCircle className="spin" size={15} /></span>
        )}
        {!showChinesePlatforms && !knownOpenUrl && currentLookup.status === "done" && currentLookup.result?.status === "not-found" && (
          <>
            <span className="access-fallback-note">未找到开放版本，继续检索：</span>
            {fallbackLinks.map((link) => <ExternalAction className="button" url={link.url} key={link.provider}>到 {link.provider} 检索 <ExternalLink size={15} /></ExternalAction>)}
          </>
        )}
        {!showChinesePlatforms && !knownOpenUrl && currentLookup.status === "error" && fallbackLinks.map((link) => (
          <ExternalAction className="button" url={link.url} key={link.provider}>到 {link.provider} 检索 <ExternalLink size={15} /></ExternalAction>
        ))}
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
  const inputRef = useRef<HTMLInputElement>(null);
  const papers = session?.papers ?? [];
  const selectedPaper = papers[selectedIndex];

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

  async function runSearch(searchQuery = query) {
    const cleanQuery = searchQuery.trim();
    if (!cleanQuery || loading) return;
    setQuery(cleanQuery);
    setLoading(true);
    setError(undefined);
    try {
      const nextSession = await searchLiterature(cleanQuery, filters);
      setSession(nextSession);
      setSelectedIndex(0);
      setHistory(loadSearchHistory());
      if (!nextSession.rawResultCount) setError("四个主渠道均未返回结果，请调整检索词后重试。");
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
              <strong>当前主搜索链路</strong>
              <p>OpenAlex、Crossref、OpenAIRE；输入 DOI 时再由 Unpaywall 定位合法开放版本。</p>
              <label>
                <span>联系邮箱（Crossref / Unpaywall）</span>
                <input
                  type="email"
                  value={providerSettings.crossrefEmail}
                  onChange={(event) => updateContactEmail(event.target.value)}
                  placeholder="填写真实邮箱后启用 Unpaywall"
                />
              </label>
              <p>Unpaywall 要求使用真实联系邮箱，邮箱只保存在本机设置中。</p>
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
          <div><Database size={14} />{successfulProviders}/4 主渠道可用</div>
          <div className="provider-statuses">
            {session.diagnostics.map((item) => (
              <span className={`provider-status provider-status--${item.status}`} title={item.error} key={item.provider}>
                {item.status === "disabled" ? <MinusCircle size={13} /> : item.status === "success" ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                {sourceNames[item.provider]} · {item.status === "success" ? `${item.resultCount} 条 / ${formatDuration(item.durationMs)}` : item.status === "timeout" ? "超时" : providerFailureLabel(item.error)}
              </span>
            ))}
          </div>
        </section>
      )}

      {error && <div className="error-banner"><XCircle size={16} />{error}</div>}

      <main className="workspace">
        <section className="results-panel">
          {loading && !session && (
            <div className="empty-state"><LoaderCircle className="spin" size={34} /><h2>正在检索四个主渠道</h2><p>结果会合并 DOI、标题、作者、摘要和开放获取信息。</p></div>
          )}
          {!loading && !session && (
            <div className="start-state">
              <div className="start-state__intro"><FileSearch size={36} /><h1>从一个入口查看全球文献记录</h1><p>OpenAlex 负责广覆盖，Crossref 核验出版信息，OpenAIRE 补充摘要；DOI 查询由 Unpaywall 定位合法开放版本。</p></div>
              {history.length > 0 && (
                <div className="history-block">
                  <div className="section-title"><History size={17} /><h2>最近检索</h2></div>
                  {history.map((item) => <button type="button" onClick={() => void runSearch(item.query)} key={item.id}><span>{item.query}</span><small>{item.mergedResultCount} 条 · {formatDuration(item.durationMs)}</small></button>)}
                </div>
              )}
            </div>
          )}
          {session && papers.length === 0 && !loading && <div className="empty-state"><FileSearch size={34} /><h2>没有可显示的结果</h2><p>可以减少限定词、关闭“仅开放获取”，或改用英文关键词。</p></div>}
          {papers.map((paper, index) => <PaperRow paper={paper} active={index === selectedIndex} showChinesePlatforms={shouldShowChinesePlatforms(paper, session?.query ?? "")} onSelect={() => setSelectedIndex(index)} key={`${paper.id}-${index}`} />)}
        </section>
        <PaperPreview paper={selectedPaper} showChinesePlatforms={selectedPaper ? shouldShowChinesePlatforms(selectedPaper, session?.query ?? "") : false} />
      </main>
    </div>
  );
}
