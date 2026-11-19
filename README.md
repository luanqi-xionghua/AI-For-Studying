# 阅迁星穹 · Windows 桌面阅读器（Python 版）

软件原名「开智」，界面、窗口标题与安装包里的显示名已改为「阅迁星穹」。为了让更新器和已有书库照常工作，EXE 文件名 `KaizhiPython.exe`、数据目录 `com.phydog.reading.python` 和 `KAIZHI_*` 环境变量保持不变。

本分支只维护 Windows 桌面程序。Vue 3 / TypeScript 界面由 PySide6 / Qt WebEngine 加载，文件、SQLite 与系统凭据由 Python 后端管理；模型请求由它交给本机 DeepSeek Harness。没有浏览器扩展，也不提供独立网页版；不需安装 Rust 工具链或浏览器助手。

## 启动与构建

已有独立版时，直接运行 `dist\KaizhiPython.exe`，不需要另装 Python 或启动服务。Git 分支提供源码，不包含生成的 EXE。首次在 Windows 从源码启动，需 Python 3.13 x64、Node.js 和 npm（本轮用 Node 26 验证）：

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm.cmd --prefix harness ci
npm.cmd --prefix frontend ci
npm.cmd --prefix frontend run build
.\.venv\Scripts\python.exe run.py
```

配置好后也可以双击 `Start.cmd`。改了前端请重新构建并重启窗口；只改 Python 则重启即可。打开前端网址不会启动阅读器。

```powershell
.\.venv\Scripts\python.exe -m pip install 'PyInstaller>=6.18,<7'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\build-windows.ps1
```

默认只生成桌面 EXE。如需额外生成桌面安装包，安装 NSIS、确认 `makensis.exe` 在 PATH 后给脚本加 `-Installer`。源码、免安装版和安装版使用相同的 Python 版数据目录。

## 文档与本地数据

- 默认数据目录是 `%APPDATA%\com.phydog.reading.python`。不要将 `--data-dir` 或 `KAIZHI_DATA_DIR` 指向原版书库，也不要让两版同时写同一个数据库。
- 文档库记录原文件路径，不复制或删除原文档。设置 → 文档库可以导出 SQLite 备份；恢复会**替换当前书库**，包括进度、书签、分组和 AI 对话，不含原文件和单独加密的 API 密钥。文件移动后可在书卡重新定位，保留原 ID 和阅读记录。
- 需要试读历史书库时，请先退出两版并备份，将 `library.sqlite3` 与存在的 `-wal` / `-shm` 一并复制至**新的空目录**，再运行 `run.py --data-dir "副本的绝对路径"`。如需迁移凭据，单独复制 `credentials`；DPAPI 加密数据须由原 Windows 用户访问。界面偏好不会从旧 WebView 自动迁移。
- PDF、Markdown 可直接阅读。转换 `.doc` / `.docx` 需安装 Word、WPS 或 LibreOffice。翻译、阅读助手、解释、问题预判、压缩均只通过本机 DeepSeek Harness 调用用户选定的模型 API，不再读取 Codex 登录。

## AI：用户自带 API Key

设置 → AI → 新建或编辑模型预设，填写服务商、API 地址、模型 ID 和 Key，保存后可「测试连接」（会产生一次模型请求）。翻译、解释、阅读助手可以共用一个预设，也可分开选择。自定义网关支持 Chat Completions、Responses 或 Anthropic Messages。本机兼容服务可免密；远程须 HTTPS 与显式 Key。模型是否支持页图、工具及推理强度以服务商为准。当前适配器不提供旧的 Fast 优先计费通道。

升级后仍使用原书库，历史对话和可用 API 预设保留；本机 Codex 预设不再使用。**旧密钥不自动转移，请为使用的 API 地址重新输入一次。** 密钥按服务商和完整端点隔离，可只放内存，选「记住」才写 Windows DPAPI；客户端不能读回明文。不会回退到其他账号或服务商。运行时只装载 Harness 的模型服务和多服务商适配器，不加载 Shell、磁盘工具、用户的 Harness 配置或会话日志插件。发给模型的选区、检索证据和截图仍由用户所选服务商接收。

源码模式需要 Node.js（本项目使用 Node 26 x64）和 `npm.cmd --prefix harness ci`。Windows 构建会把锁定的模型运行时及 Node 一并放进 EXE，无需用户另装 Node、dsh 或登录 CLI。默认使用 Node 26.13.0 打包；若更换构建用的 Node，请用 `KAIZHI_NODE_LICENSE` 指向该版本对应的 LICENSE。执行 `run.py --harness-smoke`（打包后对应参数相同）可用合成数据和本机模拟 API 验证，不用真实密钥。

### 后续接入学习功能

生成练习题或解释错题可以复用 `frontend/src/ai/complete.ts` 的单次任务入口：扩展任务用量分类，传入所需选文、提示和取消信号，沿用一个用户预设。需要引用当前 PDF 的问答可复用 `streamDocumentChat`，由阅读器提供本题范围内的只读工具。学习进度、错题和复习安排属于应用数据，不放在 Harness 会话里。当前版本未新增学习界面或自动发送学习材料。

## 关键入口

| 功能 | 位置 |
| --- | --- |
| 启动、窗口、选择文件、拖放与全屏 | `run.py`、`backend/desktop.py` |
| 桌面命令、二进制响应、流式事件与鉴权 | `backend/server.py`、`frontend/src/sdk/python.ts` |
| SQLite、全文检索、备份恢复、重定位 | `backend/library.py` |
| Word 转换、Windows 凭据 | `backend/word.py`、`backend/windows.py` |
| AI 运行时、取消、文档工具回传 | `backend/harness.py`、`harness/runtime.mjs`、`frontend/src/ai/harness.mjs` |
| PDF 连续渲染/选区/索引、AI 文档工具与请求队列 | `frontend/src/reader/core/`、`frontend/src/shared/` |
| 更新筛选、SHA-256 验证与安装 | `backend/updates.py` |

本地服务只监听 IPv4 回环地址。特权请求校验 Host、来源和每次启动生成的令牌，WebSocket 也须认证。同一数据目录不能同时运行两个实例。不要将接口暴露到局域网或公网。

## 验证与更新

先构建前端，再在项目根目录执行：

```powershell
npm.cmd --prefix frontend test
$env:KAIZHI_TEST_OFFICE='1'  # 可选：用本机办公软件转换临时合成文档
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe run.py --smoke
# 打包后：等待 GUI 程序退出，ExitCode 应为 0
(Start-Process .\dist\KaizhiPython.exe -ArgumentList '--smoke' -WindowStyle Hidden -Wait -PassThru).ExitCode
```

`--smoke` 在临时库和独立 Qt 配置中导入合成 PDF，检查 PDF.js Worker、画布、文字层及本地 RPC；不使用真实书库。Python 测试还验证普通网页不能启动桌面界面。

更新器只认 `python-vX.Y.Z` 标签及具有 SHA-256 摘要的 `KaizhiPython-X.Y.Z-portable.exe` / `KaizhiPython-X.Y.Z-setup.exe`；便携版运行文件名为 `KaizhiPython.exe`。默认仓库为 `luanqi-xionghua/AI-For-Reading`，可用 `KAIZHI_RELEASE_REPO` 覆盖。源码模式只提示新版本。推送源码分支不会自动生成 Release。

本轮变更、验收边界和后续事项见 [开发交接](docs/HANDOFF.md)。
