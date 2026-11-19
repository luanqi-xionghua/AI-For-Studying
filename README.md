# 开智 · Windows 桌面阅读器（Python 版）

本分支只维护 Windows 桌面程序。Vue 3 / TypeScript 界面由 PySide6 / Qt WebEngine 加载，文件、SQLite、网络请求和系统凭据由 Python 后端管理。没有浏览器扩展，也不提供独立网页版；不需安装 Rust 工具链或浏览器助手。

## 启动与构建

已有独立版时，直接运行 `dist\KaizhiPython.exe`，不需要另装 Python 或启动服务。Git 分支提供源码，不包含生成的 EXE。首次在 Windows 从源码启动，需 Python 3.13 x64、Node.js 和 npm（本轮用 Node 26 验证）：

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
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
- PDF、Markdown 可直接阅读。转换 `.doc` / `.docx` 需安装 Word、WPS 或 LibreOffice。阅读助手可以使用 API 服务或本机已登录的 Codex CLI（可用 `KAIZHI_CODEX_EXE` 指定路径）；不会分发登录凭据。

## 关键入口

| 功能 | 位置 |
| --- | --- |
| 启动、窗口、选择文件、拖放与全屏 | `run.py`、`backend/desktop.py` |
| 桌面命令、二进制响应、流式事件与鉴权 | `backend/server.py`、`frontend/src/sdk/python.ts` |
| SQLite、全文检索、备份恢复、重定位 | `backend/library.py` |
| Word 转换、Windows 凭据 | `backend/word.py`、`backend/windows.py` |
| 网络限流与取消、本机只读 Codex 会话 | `backend/network.py`、`backend/codex.py` |
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
