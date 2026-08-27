# 三端同步与开发方式

ScholarScope 同时维护本地开发环境、GitHub 源码仓库和 Linux Web 服务器。三者
职责不同：源码只在本地和 GitHub 之间同步，服务器只接收经过验证的发布包。

## 职责边界

| 端 | 职责 | 不应承担的职责 |
| --- | --- | --- |
| 本地开发机 | 修改源码、运行针对性检查、构建发布包、保留本次发布记录 | 直接把临时开发目录当作生产环境 |
| GitHub `main` | 可追溯的源码基线、提交历史、Windows 便携包的手动 Actions 构建 | 保存服务器数据、密钥或 Web 发布包 |
| `ai.seizemoment.xyz` 服务器 | 运行已发布的 Web 包，保存运行数据和服务器配置 | 直接编辑业务源码、使用 `git pull` 覆盖运行目录 |

## 哪些内容同步到哪里

| 内容 | 本地 | GitHub | 服务器 |
| --- | --- | --- | --- |
| 应用源码 | 开发和测试 | 提交到 `main` | 仅从发布包中的 `app/` 使用 |
| Web 前端与 Node 运行时 | 构建输入 | 源码和构建脚本 | 发布时替换 `app/` 和 `runtime/node/` |
| Python 引擎运行时 | 本地开发环境 | 不提交虚拟环境 | 保留 `runtime/python/`，除非依赖升级明确要求重建 |
| 运行数据、缓存、日志、已下载文件 | 本地忽略目录 | 不提交 | 保留 `data/` |
| 私有配置与索引地址 | 本地 `.local` 或环境变量 | 不提交 | 保留 `config.env` |
| 发布 ZIP | 本地生成并校验 | 默认不提交 | 上传后在临时目录解压、核验和发布 |

## 日常开发

1. 先同步并确认本地基线：`git pull --ff-only origin main`，再查看 `git status --short`。未跟踪的构建产物、运行数据和临时文件不能混入提交。
2. 修改 React/TypeScript 时，重点范围是 `apps/desktop/src/`；修改来源引擎时，范围是 `resources/engine/worker.py`。Web 包会把该 worker 复制为 `app/engine/worker.py`。
3. 改动后执行与风险相匹配的检查。前端或共享接口通常执行 `npm run lint`、`npm test`；修改 worker 时补充 Python 编译检查。
4. 不需要因为每一处小改动都构建或打包。`npm run build`、便携包构建和 Linux Web 打包只在明确准备交付、部署，或有明确构建要求时执行。
5. 通过检查后提交并推送：`git add ...`、`git commit`、`git push origin main`。生产发布必须对应一个已推送的提交，记录提交短 SHA 和发布包 SHA-256。

## Web 发布顺序

服务器站点根目录固定为：

```text
/opt/1panel/apps/openresty/openresty/www/sites/ai.seizemoment.xyz/index
```

1. 在已推送的源码基线执行 `npm run package:web:linux`，得到 `ScholarScope-web-linux-x64.zip`。
2. 本地校验 ZIP 结构和 SHA-256。包内必须包含 `app/server.mjs`、`app/engine/worker.py`、`app/dist/`、`runtime/node/bin/node` 和启动脚本。
3. 上传 ZIP 到服务器临时目录，在临时发布目录解压并验证文件；不要直接在正在运行的站点根目录解压。
4. 停止 `scholarscope-web.service`，备份当前 `app/`、`runtime/node/` 与发布脚本，然后替换这些发布文件。
5. 保留 `data/`、`runtime/python/` 和 `config.env`。它们分别承载运行数据、已安装 Python 引擎和服务器私有配置，不随普通应用发布覆盖。
6. 确保 `runtime/node/bin/node` 与 shell 脚本具备可执行权限，执行 `systemctl daemon-reload`、`systemctl start scholarscope-web.service`。
7. 先请求服务器本机 `http://127.0.0.1:5180/api/status`，再请求公网 `https://ai.seizemoment.xyz/api/status`。最后用实际 DOI 在网页中验证关键工作流。

OpenResty 只反向代理到 `127.0.0.1:5180`；不能只把 `app/dist` 配为静态网站，否则 `/api/*` 和 Python 引擎不会工作。

## 来源功能的验证口径

来源定位完成后，界面必须将结果分为三组：

- 已验证 PDF：可显示“打开已验证 PDF”与“应用内获取 PDF”。
- 手动获取候选：仅供浏览器尝试，不承诺应用内下载。
- 出版与核验页面：用于查看记录，不作为获取来源。

HTTP 404、`BlobNotFound`、非 PDF 响应和已知失效链接只写入日志，不应显示给用户。外部来源的可用性会变化，因此发布验证关注分类和失败降级是否正确，而不是要求每个来源始终可下载。

## 回滚与故障处理

发布失败时，先恢复刚才备份的 `app/`、`runtime/node/` 与发布脚本，再启动服务；不得删除 `data/`、`runtime/python/` 或 `config.env`。恢复后检查：

```bash
systemctl status scholarscope-web.service
curl http://127.0.0.1:5180/api/status
journalctl -u scholarscope-web.service -n 100 --no-pager
```

如果必须在服务器上紧急修复，应在恢复服务后立即把同一修复回填到本地源码、提交并推送 GitHub，避免三个环境长期分叉。

## 每次发布的最小记录

在提交说明、发布记录或任务说明中保留以下信息：

- Git 提交 SHA
- 发布 ZIP 的 SHA-256
- 部署时间和目标域名
- 本地检查结果
- 服务器本机与公网健康检查结果
- 一条实际检索或关键交互的验证结果
