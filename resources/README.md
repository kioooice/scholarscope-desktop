# 内置资源

`engine/worker.py` 是 ScholarScope 的内部文献定位与下载引擎源码。发布工作流会将它放入便携包根目录的 `app/engine`，并将 Node.js 与嵌入式 Python 放入根目录的 `runtime`；用户无需单独运行或配置这些文件。

该目录只包含 ScholarScope 当前运行链路所需的内部引擎资源，不是独立的上游应用或插件包。
