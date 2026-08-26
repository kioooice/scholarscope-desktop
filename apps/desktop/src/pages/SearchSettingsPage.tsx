import {
  CheckCircle2,
  Database,
  Download,
  RefreshCw,
  RotateCcw,
  ServerCog,
  ShieldCheck,
  Timer,
  Wifi,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import type { ProviderSettings } from "../types/athena";

export type SearchEngineStatus = "idle" | "disabled" | "checking" | "ready" | "unavailable" | "error";

type SearchSettingsPageProps = {
  settings: ProviderSettings;
  engineStatus: SearchEngineStatus;
  onUpdate: (changes: Partial<ProviderSettings>) => void;
  onReset: () => void;
  onCheckEngine: () => void;
};

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

export function SearchSettingsPage({ settings, engineStatus, onUpdate, onReset, onCheckEngine }: SearchSettingsPageProps) {
  return (
    <main className="settings-page">
      <div className="settings-page__inner">
        <div className="settings-page__intro">
          <div>
            <span className="settings-page__eyebrow">ScholarScope / 设置</span>
            <h1>应用设置</h1>
            <p>检索接口、PDF 来源池和后台服务均在此管理，修改会立即保存在本机。</p>
          </div>
          <button className="settings-reset" type="button" onClick={onReset} title="恢复默认设置">
            <RotateCcw size={15} />恢复默认
          </button>
        </div>

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
            <label className="settings-field">
              <span>Semantic Scholar API Key</span>
              <input
                type="password"
                value={settings.semanticScholarApiKey}
                onChange={(event) => onUpdate({ semanticScholarApiKey: event.target.value })}
                placeholder="可选"
              />
              <small>未填写时使用公共限额。</small>
            </label>
            <label className="settings-field">
              <span>NCBI / PubMed API Key</span>
              <input
                type="password"
                value={settings.ncbiApiKey}
                onChange={(event) => onUpdate({ ncbiApiKey: event.target.value })}
                placeholder="可选"
              />
              <small>提高 PubMed 请求频率限制。</small>
            </label>
            <label className="settings-field">
              <span>Google Scholar 第三方 API Key</span>
              <input
                type="password"
                value={settings.googleScholarApiKey}
                onChange={(event) => onUpdate({ googleScholarApiKey: event.target.value })}
                placeholder="可选"
              />
              <small>为兼容第三方适配器预留。</small>
            </label>
          </div>
        </section>

        <section className="settings-section settings-section--engine">
          <div className="settings-section__topline">
            <SectionHeading
              icon={<ServerCog size={19} />}
              title="PDF 下载引擎"
              detail="按候选队列检查来源，前一个来源失败后自动继续下一个。"
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
              <span><strong>启用下载引擎</strong><small>允许后台连接 13 个来源。</small></span>
              <input type="checkbox" checked={settings.scansciEnabled} onChange={(event) => onUpdate({ scansciEnabled: event.target.checked })} />
            </label>
            <label className="settings-toggle">
              <span><strong>自动检查来源</strong><small>检索完成后自动查找可下载 PDF。</small></span>
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
              <small>下载总时限会按此值自动放宽。</small>
            </label>
          </div>
        </section>

        <section className="settings-section settings-section--footer">
          <div className="settings-footer-icon"><Download size={18} /></div>
          <div>
            <h2>本机数据与隐私</h2>
            <p>接口密钥和下载设置只保存在本机。PDF 会保存到 Windows 的 Downloads 文件夹，论文库和笔记保存在应用数据目录。</p>
          </div>
        </section>
      </div>
    </main>
  );
}
