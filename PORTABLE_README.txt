ScholarScope Windows 便携版
===========================

使用方法
--------
1. 将压缩包完整解压到一个普通文件夹。
2. 双击 ScholarScope.exe。
3. 输入主题、论文标题、DOI 或作者后开始检索。

运行要求
--------
- Windows 10 或 Windows 11（64 位）
- Microsoft Edge WebView2 Runtime
- 可以访问 OpenAlex、Crossref、OpenAIRE 和 Unpaywall

大多数 Windows 10/11 电脑已经安装 WebView2。如果程序无法启动，请先通过微软官方渠道安装 WebView2 Runtime。

安全说明
--------
- 当前是未签名的技术验证版，Windows 可能显示“未知发布者”。
- 只应运行从本项目私有 GitHub Actions 下载的文件。
- SHA256SUMS.txt 记录了 ScholarScope.exe 的校验值，可用于确认文件在下载后没有发生变化。
- 本程序不会绕过付费墙，也不会自动下载论文全文。

本地数据
--------
搜索历史、设置和后续保存的数据保存在当前 Windows 用户的应用数据目录中，不会写入 ScholarScope.exe 所在目录。

当前限制
--------
- Unpaywall 需要在数据源设置中填写真实联系邮箱；未设置时不会请求该服务。
- 未找到开放版本时会直接提供 CORE、BASE 和 Google Scholar 检索入口；中文文献会显示知网、万方、维普的平台归属入口。
- 本版本没有代码签名、自动更新和安装程序。
