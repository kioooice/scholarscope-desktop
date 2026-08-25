# ScholarScope

ScholarScope 是一个本地 Web 论文查找工具，采用类似 Everything 的单入口交互：输入论文题名或 DOI，先查看元数据和可获取来源，再由用户点击下载按钮获取 PDF。

## 当前范围

- 单搜索框与键盘优先操作
- 内部下载引擎并行整合元数据接口，并复用 ScanSci 来源池定位可获取路径
- 定位阶段只返回来源和路径，不自动下载
- DOI 优先、标准化标题兜底的跨源合并
- 摘要、作者、年份、期刊、被引和主题预览
- 出版页面、DOI、来源页面与 PDF 下载按钮
- 数据源成功、失败、超时、结果数和耗时记录
- 15 分钟会话缓存与最近 12 次检索历史
- Vite 本地 Web 开发预览
- GitHub Actions 仅在手动触发时构建 Windows 便携版压缩包

## 技术结构

- React 19 + TypeScript 6 + Vite 8
- Node 本地 API 与静态 Web 服务
- 内部 Python worker，通过 JSON Lines 与 Node 通信
- ScanSci 的来源核心作为内部下载引擎使用，不暴露 ScanSci Web/MCP 页面、端口或独立操作
- Crossref、OpenAlex 等元数据接口只用于统一记录和题名解析，不作为额外下载来源展示，也不会把 Crossref 计为第 14 个来源

核心文件：

```text
src/App.tsx                              单窗口搜索与预览界面
src/services/unifiedSearchService.ts    统一元数据检索、合并、排序和缓存
src/services/scansciService.ts          内部定位和下载 API 客户端
engine/worker.py                         内部 Python 引擎与来源定位/下载边界
server.mjs                               本地 Web、内部 API 与 worker 管理
```

## 本地运行

开发机需要 Node.js；Python 不存在时，启动脚本会尝试准备项目自己的隐藏 Python 运行时。

```bash
npm install
npm run dev
```

打开：`http://127.0.0.1:5180/`

生产便携包会把 Node.js、Python、引擎依赖和前端文件一起放入压缩包，因此目标 Windows 电脑不需要预装 Python 或 Node.js。

## 质量检查

```bash
npm run build
npm test
npm run lint
```

## GitHub Actions

`.github/workflows/build-windows-portable.yml` 只有 `workflow_dispatch`，不会因为每次提交自动打包。需要发布便携包时，在 GitHub Actions 页面手动运行它。

## 当前限制

- 元数据接口采用并行兜底；题名无法解析到 DOI 时，来源池无法按 DOI 定位。
- 定位请求会复用来源函数的 URL 探测逻辑，但不会写入 PDF；点击下载后才执行实际下载。
- 当前无模糊标题聚类，只合并 DOI 相同或标准化标题完全相同的记录。
- 缓存目前只覆盖当前运行会话，检索历史保存在本机浏览器 localStorage。

## 上游与许可证

本项目基于 [Athena Scholar](https://github.com/Hazza-uxdev/Athena-Scholar) 改造，保留上游 Apache License 2.0。修改版本继续遵守仓库内 [LICENSE](./LICENSE) 的归属与再分发要求。
