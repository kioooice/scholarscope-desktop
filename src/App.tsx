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
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { openExternalUrl } from "./services/externalUrlService";
import { loadSearchHistory, searchLiterature } from "./services/unifiedSearchService";
import type { SearchFilters, SearchSource } from "./types/athena";
import type { SearchHistoryEntry, SearchSession, UnifiedPaper } from "./types/search";

const defaultFilters: SearchFilters = {
  disciplines: [],
  openAccessOnly: false,
};

const sourceNames: Record<SearchSource, string> = {
  OpenAlex: "OpenAlex",
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

function PaperRow({ paper, active, onSelect }: { paper: UnifiedPaper; active: boolean; onSelect: () => void }) {
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
      </div>
    </button>
  );
}

function PaperPreview({ paper }: { paper?: UnifiedPaper }) {
  if (!paper) {
    return (
      <aside className="preview-panel preview-panel--empty">
        <FileSearch size={34} />
        <h2>选择一条文献</h2>
        <p>右侧会直接显示元数据、摘要、来源和可访问页面，不在工具内下载全文。</p>
      </aside>
    );
  }

  const publisherUrl = paper.publisherUrl || paper.sourceUrls.OpenAlex || paper.sourceUrls.Crossref || paper.sourceUrls["Semantic Scholar"];
  const openUrl = paper.oaUrl && !paper.oaUrl.toLowerCase().endsWith(".pdf") ? paper.oaUrl : undefined;

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
          <p className={paper.abstract.toLowerCase().startsWith("no abstract") ? "muted" : ""}>{paper.abstract}</p>
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
      </div>

      <div className="preview-actions">
        {publisherUrl && <ExternalAction className="button button--primary" url={publisherUrl}>查看出版页面 <ExternalLink size={15} /></ExternalAction>}
        {openUrl && <ExternalAction className="button" url={openUrl}>查看开放页面 <ExternalLink size={15} /></ExternalAction>}
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
      if (!nextSession.rawResultCount) setError("三个数据源均未返回结果，请调整检索词后重试。");
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "检索失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark"><Search size={20} /></div>
          <div><strong>ScholarScope</strong><span>全球文献发现 · 技术验证版</span></div>
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
          <div><Database size={14} />{successfulProviders}/3 数据源可用</div>
          <div className="provider-statuses">
            {session.diagnostics.map((item) => (
              <span className={`provider-status provider-status--${item.status}`} title={item.error} key={item.provider}>
                {item.status === "success" ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                {sourceNames[item.provider]} · {item.status === "success" ? `${item.resultCount} 条 / ${formatDuration(item.durationMs)}` : item.status === "timeout" ? "超时" : "失败"}
              </span>
            ))}
          </div>
        </section>
      )}

      {error && <div className="error-banner"><XCircle size={16} />{error}</div>}

      <main className="workspace">
        <section className="results-panel">
          {loading && !session && (
            <div className="empty-state"><LoaderCircle className="spin" size={34} /><h2>正在并行检索三个平台</h2><p>结果会合并 DOI、标题、作者和开放获取信息。</p></div>
          )}
          {!loading && !session && (
            <div className="start-state">
              <div className="start-state__intro"><FileSearch size={36} /><h1>从一个入口查看全球文献记录</h1><p>OpenAlex 负责广覆盖，Crossref 核验 DOI 与出版信息，Semantic Scholar 补充摘要和被引数据。</p></div>
              {history.length > 0 && (
                <div className="history-block">
                  <div className="section-title"><History size={17} /><h2>最近检索</h2></div>
                  {history.map((item) => <button type="button" onClick={() => void runSearch(item.query)} key={item.id}><span>{item.query}</span><small>{item.mergedResultCount} 条 · {formatDuration(item.durationMs)}</small></button>)}
                </div>
              )}
            </div>
          )}
          {session && papers.length === 0 && !loading && <div className="empty-state"><FileSearch size={34} /><h2>没有可显示的结果</h2><p>可以减少限定词、关闭“仅开放获取”，或改用英文关键词。</p></div>}
          {papers.map((paper, index) => <PaperRow paper={paper} active={index === selectedIndex} onSelect={() => setSelectedIndex(index)} key={`${paper.id}-${index}`} />)}
        </section>
        <PaperPreview paper={selectedPaper} />
      </main>
    </div>
  );
}
