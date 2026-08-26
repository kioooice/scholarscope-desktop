# ScholarScope

ScholarScope 是一个 Windows 便携式桌面论文查找工具，采用类似 Everything 的单入口交互：输入论文题名或 DOI，先查看元数据和可获取来源，再由用户点击下载按钮获取 PDF。

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
- Tauri Windows 桌面窗口，发布版不需要浏览器或命令行入口
- Node 内部 API 与 Python worker，仅作为 EXE 的内部引擎使用
- ScanSci 的来源核心作为内部下载引擎使用，不暴露 ScanSci Web/MCP 页面或独立操作
- Crossref、OpenAlex 等元数据接口只用于统一记录和题名解析，不作为额外下载来源展示，也不会把 Crossref 计为第 14 个来源

## 目录

```text
apps/
  desktop/
    src/                                 React 界面、搜索状态和前端服务
    src-tauri/
      src/
        commands/                        PDF 原生保存命令
        filesystem/                      内置运行时和进程生命周期
    server.mjs                           内部 API 与 Python worker 管理
    package.json                         桌面应用依赖与开发命令
resources/
  engine/worker.py                       内部 Python 引擎与来源定位/下载边界
scripts/
  smoke-test-portable.ps1                打包后启动 EXE 并验证内置引擎
.github/workflows/
  build-windows-portable.yml             手动构建 Windows 便携包
```

前端单元测试与对应服务放在一起，方便改动时一并维护；跨应用或发布验证脚本统一放在根目录 `scripts/`。

## 本地开发

开发机需要 Node.js；Python 不存在时，启动脚本会尝试准备项目自己的隐藏 Python 运行时。

```bash
npm install
npm run dev
```

打开：`http://127.0.0.1:5180/`

这仅用于开发。发布版由 `ScholarScope.exe` 打开桌面窗口，不需要访问本地 Web 地址。

## Windows 便携包

GitHub Actions 生成的 `ScholarScope-portable-win64.zip` 解压后包含：

```text
ScholarScope.exe
app/
  server.mjs
  engine/
runtime/
  node/
  python/
```

这是免安装的绿色便携版：完整解压后直接双击 `ScholarScope.exe`。`app` 保存内部应用模块，`runtime` 保存随包附带的 Node.js 与 Python 运行时；请保持这两个文件夹与 EXE 同目录，不需要单独打开或运行其中的任何文件。

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
- 缓存目前只覆盖当前运行会话，检索历史保存在本机 WebView 存储中。

## 许可证与来源

当前工作树已经收缩为 ScholarScope 的元数据检索、13 来源 PDF 定位、下载和 Windows 便携运行链路；未挂载的 Athena Scholar UI、Agent、AI、图谱、论文库和笔记层已移除。项目仍保留来自 [Athena Scholar](https://github.com/Hazza-uxdev/Athena-Scholar) 的历史派生关系，因此继续遵守 Apache License 2.0 的许可证、归属和修改声明要求。

再分发时请同时保留 [LICENSE](./LICENSE) 和 [NOTICE](./NOTICE)。本项目自己的修改归属于 ScholarScope contributors；依赖包和内置 ScanSci 引擎仍分别受其各自许可证约束。
