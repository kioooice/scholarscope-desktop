ScholarScope Windows 便携版
===========================

使用方法
--------
1. 将压缩包完整解压到一个普通文件夹。
2. 保留同目录的 resources 文件夹，不要单独移动 ScholarScope.exe。
3. 双击 ScholarScope.exe。
4. 输入论文题名或 DOI 后开始检索。
5. 找到可获取来源后，点击“下载 PDF”。

运行要求
--------
- Windows 10 或 Windows 11（64 位）
- Microsoft Edge WebView2 Runtime（Windows 11 和大多数 Windows 10 电脑已经自带）
- 可以访问所需的学术接口和文献来源

压缩包已包含 Node.js、Python 和内部下载引擎。它们只作为 ScholarScope.exe 的内部资源使用，不需要安装 Python 或 Node.js，也不需要手动启动任何服务。

安全说明
--------
- 当前是未签名的技术验证版，Windows 可能显示“未知发布者”。
- 只应运行从本项目 GitHub Actions 下载的文件。
- SHA256SUMS.txt 记录了压缩包内文件的校验值，可用于确认文件没有发生变化。
- 本程序不会自动触发下载；找到可获取 PDF 后只提供下载按钮。

本地数据
--------
搜索历史、设置和下载暂存文件保存在当前 Windows 用户的 ScholarScope 应用数据目录中，不会写入压缩包所在文件夹。

当前限制
--------
- 元数据接口采用并行兜底，Crossref 不作为额外下载来源展示。
- 定位阶段不会写入 PDF；用户点击下载按钮后才执行实际下载。
- 本版本没有代码签名、自动更新和安装程序。
