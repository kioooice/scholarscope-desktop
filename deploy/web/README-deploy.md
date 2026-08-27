# ScholarScope Linux Web 部署包

这个压缩包不是纯静态网页。Node 进程同时提供网页和 `/api/*` 接口，
OpenResty 必须反向代理到 Node，Python 引擎才能正常工作。

## 1. 上传并解压

在 1Panel 文件中上传压缩包并解压到：

```text
/opt/1panel/apps/openresty/openresty/www/sites/ai.seizemoment.xyz/index
```

压缩包没有外层目录。解压完成后，`app/`、`runtime/`、`data/`、`404.html` 和
`start.sh` 应该直接位于 `index` 目录中。

更新已部署的网站时，请先在临时目录解压和验证 ZIP，再停止
`scholarscope-web.service`，备份并替换 `app/`、`runtime/node/` 和发布脚本。
必须保留 `data/`、`runtime/python/` 和 `config.env`；不要直接在运行目录解压或
用 `git pull` 覆盖服务器。完整的三端同步、验证和回滚策略见源码仓库的
[`docs/three-environment-workflow.md`](https://github.com/kioooice/scholarscope-desktop/blob/main/docs/three-environment-workflow.md)。

## 2. 首次启动

打开 1Panel 终端，执行：

```bash
cd /opt/1panel/apps/openresty/openresty/www/sites/ai.seizemoment.xyz/index
bash start.sh
bash status.sh
```

压缩包内已包含 Linux x64 Node.js。第一次启动会创建 `runtime/python`，
并安装 `scansci-pdf[web]==1.9.0` 和 `mcp<2`。该版本引擎要求 Python 3.11
或更高版本，服务器还需要包含 `venv` 模块；如果创建虚拟环境失败，请在
1Panel 安装对应的 `python3-venv` 后再次执行 `bash start.sh`。

启动脚本默认使用官方 PyPI，不会沿用服务器全局配置的镜像。如果服务器不能
访问 PyPI，或你有可用的内部镜像，先复制配置文件并设置索引：

```bash
cp config.env.example config.env
vi config.env
# 设置 SCHOLARSCOPE_PIP_INDEX_URL=https://你的镜像/simple
```

依赖安装失败时，启动输出会显示检测到的 Python 版本、pip 版本和实际索引地址。
如果此前已经留下不完整的 `runtime/python`，再次执行 `bash start.sh` 会继续安装；
如果该环境的 Python 版本低于 3.11，脚本会自动重建它。

本地监听地址是 `127.0.0.1:5180`（网页）和 `127.0.0.1:5181`（API）。
不要在阿里云安全组或 1Panel 防火墙中开放这两个端口。

## 3. 配置二级域名

在 1Panel 网站设置中保留 HTTPS 证书，并添加反向代理，目标地址填写：

```text
http://127.0.0.1:5180
```

完整配置示例在 `openresty-proxy.conf.example`。不要把网站根目录直接
指向 `app/dist`，否则页面虽然能打开，但搜索和来源定位会因绕过 Node/Python
接口而失败。

## 4. 设置开机自动启动（推荐）

确认 `bash status.sh` 能返回 JSON 后，执行：

```bash
bash install-service.sh
```

该命令会安装并立即启动 `scholarscope-web.service`，服务器重启后也会自动
启动。查看状态和日志：

```bash
systemctl status scholarscope-web.service
journalctl -u scholarscope-web.service -n 100 --no-pager
```

手动管理仍可使用：

```bash
bash stop.sh
bash start.sh
```

## 注意事项

- PDF 会通过访问者浏览器下载，服务器版不能选择访问者电脑上的保存目录。
- `data/` 保存引擎数据、临时 PDF、进程号和日志，请确保运行账号有写权限。
- 这是私有/受控访问版本。公开二级域名前，建议在 1Panel 增加基础认证或
 其他访问控制。
- 如果来源要求浏览器验证或拦截自动请求，应用会返回来源链接；不会绕过
  Cloudflare、验证码或其他访问控制。
