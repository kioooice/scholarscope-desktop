# ScholarScope

ScholarScope 是一个 Windows 优先的桌面文献发现工具。它采用类似 Everything 的单入口交互，同时检索多个开放学术数据源，合并重复记录，并直接展示摘要、来源与合法访问页面。

当前为技术验证版。工作名和视觉品牌并未冻结。

## 当前范围

- 单搜索框与键盘优先操作
- OpenAlex、Crossref、Semantic Scholar 并行检索
- DOI 优先、标准化标题兜底的跨源合并
- 摘要、作者、年份、期刊、被引和主题预览
- 出版页面、DOI 与非 PDF 开放页面跳转
- 数据源成功、失败、超时、结果数和耗时记录
- 15 分钟会话缓存与最近 12 次检索历史
- Windows Tauri 桌面框架

本阶段不下载论文、不绕过付费墙，也不承担参考文献管理、全文库、知识图谱或 AI 问答功能。

## 技术结构

- React 19 + TypeScript 6 + Vite 8
- Tauri 2 + Rust
- OpenAlex：主覆盖与开放获取信息
- Crossref：DOI 与出版元数据核验
- Semantic Scholar：摘要与引用补充，匿名访问可能遇到限流

核心文件：

```text
src/App.tsx                              单窗口搜索与预览界面
src/services/unifiedSearchService.ts    并发检索、合并、排序、缓存与日志
src/services/openAlexService.ts         OpenAlex 适配
src/services/crossrefService.ts         Crossref 适配
src/services/semanticScholarService.ts  Semantic Scholar 适配
src-tauri/src/lib.rs                    桌面网络代理与本地能力
```

## 本地验证

安装依赖：

```bash
npm install
```

运行浏览器开发预览：

```bash
npm run dev
```

运行质量检查：

```bash
npm run build
npm test
npm run lint
```

## Windows 桌面构建

需要：

- Windows 10/11
- Node.js 20+
- Rust/Cargo
- Visual Studio Build Tools（Desktop development with C++）
- Microsoft Edge WebView2 Runtime

构建：

```powershell
npm install
npm run tauri:build
```

安装包输出到：

```text
src-tauri/target/release/bundle/
```

## 当前限制

- Semantic Scholar 无 API Key 时可能返回 429，界面会降级并保留其他来源结果。
- 当前无模糊标题聚类，只合并 DOI 相同或标准化标题完全相同的记录。
- 缓存目前只覆盖当前运行会话，检索历史保存在本机浏览器/桌面 WebView。
- Windows 安装包尚未在本仓库的目标 Windows 环境中完成验证。

## 上游与许可证

本项目基于 [Athena Scholar](https://github.com/Hazza-uxdev/Athena-Scholar) 改造，保留上游 Apache License 2.0。修改版本继续遵守仓库内 [LICENSE](./LICENSE) 的归属与再分发要求。
