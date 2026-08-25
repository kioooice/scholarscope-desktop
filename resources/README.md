# 内置资源

`engine/worker.py` 是 ScholarScope 的内部文献定位与下载引擎源码。发布工作流会将它放入便携包根目录的 `app/engine`，并将 Node.js 与嵌入式 Python 放入根目录的 `runtime`；用户无需单独运行或配置这些文件。
