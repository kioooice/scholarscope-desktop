import {
  CheckCircle2,
  Database,
  Download,
  FolderOpen,
  RefreshCw,
  RotateCcw,
  ServerCog,
  ShieldCheck,
  Timer,
  Wifi,
  XCircle,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ProviderSettings } from "../types/scholarscope";

export type SearchEngineStatus = "idle" | "disabled" | "checking" | "ready" | "unavailable" | "error";

type SettingsTab = "search" | "download" | "privacy";

type SearchSettingsPageProps = {
  settings: ProviderSettings;
  engineStatus: SearchEngineStatus;
  defaultDownloadDirectory: string;
  downloadDirectoryBusy: boolean;
  onUpdate: (changes: Partial<ProviderSettings>) => void;
  onReset: () => void;
  onCheckEngine: () => void;
  onChooseDownloadDirectory: () => void;
};

const settingsTabs: Array<{ id: SettingsTab; label: string; icon: ReactNode }> = [
  { id: "search", label: "检索设置", icon: <Database size={15} /> },
  { id: "download", label: "下载设置", icon: <Download size={15} /> },
  { id: "privacy", label: "本机与隐私", icon: <ShieldCheck size={15} /> },
];

function engineStatusLabel(status: SearchEngineStatus): string {
  if (status === "idle") return "尚未检查";
  if (status === "ready") return "已连接";
  if (status === "checking") return "连接中";
  if (status === "disabled") return "已停用";
  if (status === "unavailable") return "未连接";
  return "连接失败";
}

function EngineStatus({ status }: { status: SearchEngineStatus }) {
  const icon = status === "ready"
    ? <CheckCircle2 size={15} />
    : status === "checking"
      ? <Wifi size={15} />
      : status === "disabled"
        ? <ShieldCheck size={15} />
        : status === "idle"
          ? <ShieldCheck size={15} />
          : <XCircle size={15} />;
  return <span className={`settings-status settings-status--${status}`}>{icon}{engineStatusLabel(status)}</span>;
}

function SectionHeading({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="settings-section__heading">
      <span className="settings-section__icon">{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function SearchSettings({ settings, engineStatus, onUpdate, onCheckEngine }: Pick<SearchSettingsPageProps, "settings" | "engineStatus" | "onUpdate" | "onCheckEngine">) {
  return (
    <>
      <section className="settings-section">
        <SectionHeading
          icon={<Database size={19} />}
          title="元数据检索"
          detail="用于检索论文题名、作者、摘要和引用信息。"
        />
        <div className="settings-field-grid">
          <label className="settings-field">
            <span>学术接口联系邮箱</span>
            <input
              type="email"
              value={settings.crossrefEmail}
              onChange={(event) => onUpdate({ crossrefEmail: event.target.value })}
              placeholder="name@example.com"
            />
            <small>用于 Crossref 等接口的请求标识，可留空。</small>
          </label>
        </div>
      </section>

      <section className="settings-section settings-section--engine">
        <div className="settings-section__topline">
          <SectionHeading
            icon={<ServerCog size={19} />}
            title="来源与 PDF 引擎"
            detail="默认提供来源链接；已验证 PDF 可选择应用内获取，并按队列继续尝试。"
          />
          <div className="settings-status-actions">
            <EngineStatus status={engineStatus} />
            <button className="settings-check" type="button" onClick={onCheckEngine} disabled={engineStatus === "checking" || !settings.scansciEnabled || !settings.scansciAutoSearch}>
              <RefreshCw size={13} />检查连接
            </button>
          </div>
        </div>
        <div className="settings-toggle-grid">
          <label className="settings-toggle">
            <span><strong>启用来源引擎</strong><small>允许后台检查 13 个来源并整理链接。</small></span>
            <input type="checkbox" checked={settings.scansciEnabled} onChange={(event) => onUpdate({ scansciEnabled: event.target.checked })} />
          </label>
          <label className="settings-toggle">
            <span><strong>自动检查来源</strong><small>检索完成后自动查找并整理来源链接。</small></span>
            <input type="checkbox" checked={settings.scansciAutoSearch} onChange={(event) => onUpdate({ scansciAutoSearch: event.target.checked })} />
          </label>
          <label className="settings-toggle">
            <span><strong>启用 Sci-Hub 来源</strong><small>作为候选来源参与队列尝试。</small></span>
            <input type="checkbox" checked={settings.scansciScihubEnabled} onChange={(event) => onUpdate({ scansciScihubEnabled: event.target.checked })} />
          </label>
          <label className="settings-toggle">
            <span><strong>通过 Tor 访问 Sci-Hub</strong><small>需要本机已运行 Tor 服务。</small></span>
            <input type="checkbox" checked={settings.scansciUseTor} onChange={(event) => onUpdate({ scansciUseTor: event.target.checked })} />
          </label>
        </div>
        <div className="settings-field-grid settings-field-grid--engine">
          <label className="settings-field">
            <span>后台检查范围</span>
            <select value={settings.scansciScope} onChange={(event) => onUpdate({ scansciScope: event.target.value as ProviderSettings["scansciScope"] })}>
              <option value="selected">仅当前选中结果</option>
              <option value="top">前 N 条结果</option>
              <option value="all">全部结果</option>
            </select>
            <small>范围越大，后台网络请求越多。</small>
          </label>
          {settings.scansciScope === "top" && (
            <label className="settings-field">
              <span>前 N 条结果</span>
              <input type="number" min="1" max="50" value={settings.scansciTopN} onChange={(event) => onUpdate({ scansciTopN: Math.max(1, Math.min(50, Number(event.target.value) || 1)) })} />
              <small>可设置 1 到 50 条。</small>
            </label>
          )}
          <label className="settings-field">
            <span><Timer size={14} />单来源检查超时</span>
            <div className="settings-input-with-unit">
              <input type="number" min="5" max="60" step="1" value={Math.round(settings.scansciTimeoutMs / 1000)} onChange={(event) => onUpdate({ scansciTimeoutMs: Math.max(5_000, Math.min(60_000, (Number(event.target.value) || 5) * 1_000)) })} />
              <span>秒</span>
            </div>
            <small>来源检查和可选应用内获取会按此值分配时限。</small>
          </label>
        </div>
      </section>
    </>
  );
}

function DownloadSettings({ settings, defaultDownloadDirectory, downloadDirectoryBusy, onUpdate, onChooseDownloadDirectory }: Pick<SearchSettingsPageProps, "settings" | "defaultDownloadDirectory" | "downloadDirectoryBusy" | "onUpdate" | "onChooseDownloadDirectory">) {
  const effectiveDirectory = settings.downloadDirectory || defaultDownloadDirectory || "便携包目录（桌面版自动解析）";
  const usingDefault = !settings.downloadDirectory;

  return (
    <section className="settings-section">
      <SectionHeading
        icon={<Download size={19} />}
        title="应用内 PDF 保存位置"
        detail="仅在选择应用内获取 PDF 后，桌面版会使用这里的文件夹。"
      />
      <div className="settings-path-row">
        <div className="settings-path-display" title={effectiveDirectory}>
          <FolderOpen size={17} />
          <span>{effectiveDirectory}</span>
        </div>
        <div className="settings-path-actions">
          <button className="settings-check" type="button" onClick={onChooseDownloadDirectory} disabled={downloadDirectoryBusy}>
            <FolderOpen size={14} />{downloadDirectoryBusy ? "正在选择…" : "选择文件夹"}
          </button>
          <button className="settings-check" type="button" onClick={() => onUpdate({ downloadDirectory: "" })} disabled={usingDefault || downloadDirectoryBusy}>
            <RotateCcw size={14} />恢复便携包默认
          </button>
        </div>
      </div>
      <p className="settings-path-note">
        {usingDefault ? "当前使用便携包默认目录：即 ScholarScope.exe 所在文件夹。" : "当前使用自定义目录。恢复默认后将保存到 ScholarScope.exe 所在文件夹。"}
      </p>
      <p className="settings-path-note">目录选择只保存在本机；如果目录不存在，保存 PDF 时会自动创建。</p>
    </section>
  );
}

function PrivacySettings() {
  return (
    <section className="settings-section settings-section--footer">
      <div className="settings-footer-icon"><ShieldCheck size={18} /></div>
      <div>
        <h2>本机数据与隐私</h2>
        <p>检索配置和下载目录只保存在本机浏览器存储中。通过应用内获取的 PDF 会保存到下载设置显示的文件夹；桌面版默认使用便携包中 ScholarScope.exe 所在的目录。</p>
      </div>
    </section>
  );
}

export function SearchSettingsPage({ settings, engineStatus, defaultDownloadDirectory, downloadDirectoryBusy, onUpdate, onReset, onCheckEngine, onChooseDownloadDirectory }: SearchSettingsPageProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("search");

  return (
    <main className="settings-page">
      <div className="settings-page__inner">
        <div className="settings-page__intro">
          <div>
            <span className="settings-page__eyebrow">ScholarScope / 设置</span>
            <h1>应用设置</h1>
            <p>检索接口、来源链接和可选的应用内保存行为均在此管理，修改会立即保存在本机。</p>
          </div>
          <button className="settings-reset" type="button" onClick={onReset} title="恢复默认设置">
            <RotateCcw size={15} />恢复默认
          </button>
        </div>

        <nav className="settings-tabs" aria-label="设置分类" role="tablist">
          {settingsTabs.map((tab) => (
            <button
              aria-controls={`settings-panel-${tab.id}`}
              aria-selected={activeTab === tab.id}
              className={`settings-tab${activeTab === tab.id ? " settings-tab--active" : ""}`}
              id={`settings-tab-${tab.id}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              type="button"
            >
              {tab.icon}<span>{tab.label}</span>
            </button>
          ))}
        </nav>

        {activeTab === "search" && (
          <div id="settings-panel-search" role="tabpanel" aria-labelledby="settings-tab-search">
            <SearchSettings settings={settings} engineStatus={engineStatus} onUpdate={onUpdate} onCheckEngine={onCheckEngine} />
          </div>
        )}
        {activeTab === "download" && (
          <div id="settings-panel-download" role="tabpanel" aria-labelledby="settings-tab-download">
            <DownloadSettings settings={settings} defaultDownloadDirectory={defaultDownloadDirectory} downloadDirectoryBusy={downloadDirectoryBusy} onUpdate={onUpdate} onChooseDownloadDirectory={onChooseDownloadDirectory} />
          </div>
        )}
        {activeTab === "privacy" && (
          <div id="settings-panel-privacy" role="tabpanel" aria-labelledby="settings-tab-privacy">
            <PrivacySettings />
          </div>
        )}
      </div>
    </main>
  );
}
