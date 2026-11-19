# 开智 Python 桌面版 · 开发交接

**2026-11-19（上海时间）｜分支：`main--from-rust-to-python`｜应用版本：`0.10.54`（未发新版本）**

## 接手先看

以本分支的 `README.md` 为运行和打包依据。产品只有 Windows 桌面版：运行 `Start.cmd` 或 `dist\KaizhiPython.exe`。不可把 Python 版的可写数据目录指向历史版本；默认书库仍在 `%APPDATA%\com.phydog.reading.python`。本轮未迁移书库，未改历史项目、原版主分支、浏览器安装或系统注册项。

## 删除了什么，留下了什么

| 变更 | 接手时要知道的原因 |
| --- | --- |
| 移除整个扩展、浏览器消息 Host、独立 Host 入口、构建/注册/检查脚本及本地旧 Host 产物 | 命令行不再分派扩展消息；桌面打包只产出一个 EXE，NSIS 也只携带桌面程序。历史安装如曾注册助手，本轮不自动注销，以免误动原版配置。 |
| 迁出仍在使用的纯前端模块 | PDF 几何、选区、文本索引与渲染基类在 `frontend/src/reader/core/`；文档工具协议、限流队列及 API 地址校验在 `frontend/src/shared/`。桌面阅读、框选、AI 工具仍使用这些实现，不依赖扩展源码。 |
| 移除旧桌面打包/发布工具和旧 UI 验收脚本 | 删除指向原工具链、旧安装包、浏览器预览或已不存在 fixture 的脚本。桌面验收入口改为真实 Qt `--smoke`；不等于所有旧 UI 场景都已有 Qt 自动化覆盖。 |
| 移除独立网页版 | 不再创建浏览器文档库；无桌面令牌的页面只提示从桌面启动。选文件、拖放、全屏、更新和 AI HTTP 均由桌面桥接处理。Qt WebEngine 是桌面界面的渲染引擎，不能删除。 |
| 保留本机 Codex 与旧库兼容 | `backend/codex.py` 和 `native_*` 桌面命令用于本机阅读助手，不是浏览器 Host。Windows 路径兼容、SQLite 格式和 Python 版数据目录保持不变。 |
| 收敛更新逻辑 | 后端 `backend/updates.py` 是发布版本与附件选择的唯一实现。测试故意放入比 Python 版本号更高的 `desktop-v…` 反例，防止误装历史版本。 |

## 本轮验收

- Windows，Python 3.13.5 / PySide6 6.12.0 / Node 26.13.0 / PyInstaller 6.22.3。
- `npm.cmd --prefix frontend test`：**155 项通过**。Python `unittest` 开启 `KAIZHI_TEST_OFFICE=1`：**19 项通过**，包括临时 Word 转 PDF、数据库备份/恢复、重定位、下载校验、无令牌页面不挂载应用。
- 前端类型检查及 Vite 构建通过；`run.py --smoke` 和新生成的 `dist\KaizhiPython.exe --smoke` 均返回 0：临时库导入合成 PDF，检查画布和文字层。验证不需要打开用户文档。
- 从 Git 暂存区导出干净源码（不带任何本地依赖或生成物），重新执行 npm ci、前端构建、155 项前端测试及源码 Qt 冒烟，均通过。
- 本机构建目录 `dist/` 只有 `KaizhiPython.exe`；源码分支不含 EXE、虚拟环境、依赖缓存、书库、密钥或本地备份。

## 版本控制、恢复与下一步

目标分支原先只有占位 README（`da617d6`）；本轮沿用该提交历史，不基于旧主分支，也不推送清理前源码。改动前已在本机保存并校验 303 个源文件的归档。恢复某个已移除文件时，请在独立目录解包比对，不要覆盖正在使用的项目。

下一轮如改 PDF 或 AI，请同时跑前后端单测和 Qt 冒烟，再手工检查并排阅读、框选和长文档滚动。尚未验收：付费 AI 端到端会话、真实覆盖升级和 NSIS 安装/卸载（本机未发现编译器）。本次上传为**源码分支**，不是 GitHub Release。正式分发前请补齐 `THIRD_PARTY_NOTICES.md` 标出的独立字体授权说明。
