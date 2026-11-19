# 阅迁星穹（原「开智」）Python 桌面版 · 开发交接

**2026-11-19（上海时间）｜分支：`main--from-rust-to-python`｜应用版本：`0.10.54`（未发新版本）**

## 接手先看

以本分支的 `README.md` 为运行和打包依据。产品只有 Windows 桌面版：运行 `Start.cmd` 或 `dist\KaizhiPython.exe`。不可把 Python 版的可写数据目录指向历史版本；默认书库仍在 `%APPDATA%\com.phydog.reading.python`。本轮未迁移书库，未改历史项目、原版主分支、浏览器安装或系统注册项。

软件已改名「阅迁星穹」，**只改了显示名**（窗口标题、网页标题、侧栏、界面提示、备份默认文件名、安装包显示名与开始菜单快捷方式）。EXE 文件名 `KaizhiPython.exe`、数据目录、`KAIZHI_*` 环境变量、`kaizhi.*` 存储键、`X-Kaizhi-Token` 等内部标识保持不变：更新器只认 `KaizhiPython-X.Y.Z-*.exe`，已有书库也靠数据目录找到，不要顺手改掉。

## 删除了什么，留下了什么

| 变更 | 接手时要知道的原因 |
| --- | --- |
| 移除整个扩展、浏览器消息 Host、独立 Host 入口、构建/注册/检查脚本及本地旧 Host 产物 | 命令行不再分派扩展消息；桌面打包只产出一个 EXE，NSIS 也只携带桌面程序。历史安装如曾注册助手，本轮不自动注销，以免误动原版配置。 |
| 迁出仍在使用的纯前端模块 | PDF 几何、选区、文本索引与渲染基类在 `frontend/src/reader/core/`；文档工具协议、限流队列及 API 地址校验在 `frontend/src/shared/`。桌面阅读、框选、AI 工具仍使用这些实现，不依赖扩展源码。 |
| 移除旧桌面打包/发布工具和旧 UI 验收脚本 | 删除指向原工具链、旧安装包、浏览器预览或已不存在 fixture 的脚本。桌面验收入口改为真实 Qt `--smoke`；不等于所有旧 UI 场景都已有 Qt 自动化覆盖。 |
| 移除独立网页版 | 不再创建浏览器文档库；无桌面令牌的页面只提示从桌面启动。选文件、拖放、全屏、更新和 AI 请求均由桌面桥接处理。Qt WebEngine 是桌面界面的渲染引擎，不能删除。 |
| AI 全部改用 DeepSeek Harness | 已删除 `backend/codex.py`、`native_*` 和旧 HTTP 代理。阅读助手、翻译等任务统一从 Python 转交本机 Harness，使用用户配置端点的 API Key。Windows 路径、SQLite 格式及数据目录保持不变。 |
| 收敛更新逻辑 | 后端 `backend/updates.py` 是发布版本与附件选择的唯一实现。测试故意放入比 Python 版本号更高的 `desktop-v…` 反例，防止误装历史版本。 |
| 导入统一走「加入文档」队列 | 删除 `library.importDocuments` 和 `importDroppedDocuments`；按钮、Ctrl+O、右键菜单和拖放都交给 `frontend/src/library/importer.ts` 逐份加入。后端 `import_documents` 的批量接口保留，一次传多个路径仍是全有或全无。 |

## 界面改动（11-19 下午）

| 改动 | 行为 | 位置 |
| --- | --- | --- |
| 打开文档时默认开启阅读助手 | 从文档库点开文档或打开新文档时自动打开；已开标签之间切换不强制打开，用户关掉后保持关着 | `frontend/src/App.vue` 的 `showDocument` |
| 修复：退出文档后翻译栏残留 | 翻译助手属于阅读工作区：回文档库时隐藏、回到文档时恢复，关掉最后一个文档时关闭；文档库里 Ctrl+T 与「机翻」不生效 | `App.vue` 的 `translateShown`、`clearWorkspace` |
| 首次安装默认「暖色极简」 | 没有保存过设置**且**文档库为空才算新装，用暖色极简并立即写入设置；已有书的老用户、老设置里缺少界面风格时按液态玻璃处理，外观不变。「恢复默认」回到暖色极简 | `frontend/src/settings/index.ts` 的 `firstRunPreferences`、`model.ts` 的 `LEGACY_UI_STYLE` |
| 「翻译」改为「翻译助手」 | 顶栏按钮与阅读助手同款胶囊；面板标题与提示同步改名（面板宽度 ≤360px 时标题只显示图标，是原有规则） | `App.vue`、`frontend/src/components/TranslatePane.vue` |
| 改名「阅迁星穹」 | 见「接手先看」；`installer.nsi` 改为带 BOM 的 UTF-8，覆盖安装会删除旧的「Kaizhi Python」快捷方式 | `frontend/index.html`、`App.vue`、`backend/desktop.py`、`scripts/installer.nsi` |
| 「加入文档」窗口 | 见下一节 | `frontend/src/components/ImportDialog.vue`、`frontend/src/library/importer.ts` |

## 「加入文档」窗口与 Word 转换反馈

- **窗口**：上方拖放区（窗口开着时拖入的文件交给它，不再显示整屏遮罩）兼「选择文件」；下方一行小字说明 PDF / Markdown 原生支持、Word 先转为 PDF；再下面逐份列出状态。全部成功时自动关闭并打开第一份；有失败时保留窗口并给出「打开」按钮。窗口没开时拖入纯 PDF / Markdown 仍直接导入，批次里有 Word 或无法加入的文件才自动弹出。转换中可关闭窗口，后台继续。
- **进度**：`import_documents(paths, onProgress=None)` 在 Word 转换时报告 `office` → `libreoffice` → `adding` 步骤；`backend/server.py` 的 `progress` 把它转成 WebSocket 事件通道（与更新下载同一机制），前端 `importDocument` 用 `Channel` 接收。转换工具不报告百分比，所以进度条按时间在每步内逼近上限、只进不退，转换完成才到 100%（`wordProgress`）。
- **失败原因**：`backend/word.py` 的 `--office` 子进程用退出码区分 0 成功 / 2 找不到 Word·WPS / 3 打不开或导出失败（可能有密码或已损坏）/ 4 Word·WPS 正开着别的文档；Word·WPS 超时、LibreOffice 缺失 / 失败 / 超时都会拼进原因。导入校验也改为逐项说明：找不到文件、不支持的扩展名、超出大小、文件头与扩展名不符、Markdown 非 UTF-8。Word 失败时界面附带「先另存为 PDF 再加入」的建议。
- **已知限制**：损坏的 Word 可能让 Word / WPS 停在隐藏对话框上，要等满 `TIMEOUT`（100 秒）才失败，且还没有取消按钮。WPS 超时后可能留下无窗口的后台进程（`wpscloudsvr.exe`、`wps.exe`）。

## 本轮验收

- Windows，Python 3.13.5 / PySide6 6.12.0 / Node 26.13.0 / PyInstaller 6.22.3。
- 前端：`npm.cmd --prefix frontend test` **143/143**（含新增 `import-queue.test.mjs`）；类型检查与 Vite 构建通过。Vue 组件模拟测试（`tests/sim/`）在 Harness 重构时为 16/16，下午未重跑：所需测试依赖不在 `package.json` 里，需要临时安装。
- Python：`unittest discover -s tests` **29 项：28 通过，1 跳过**（可选 Office 测试）。新增 `tests/test_import_feedback.py`（导入错误原因、模拟 Word / LibreOffice 缺失、失败、超时、占用时的原因与进度步骤）和进度事件经 HTTP + WebSocket 送达的测试。另开 `KAIZHI_TEST_OFFICE=1` 时 `tests.test_word_integration` 用本机 Word 真实转换通过。
- Qt：`run.py --smoke` 与最终 `dist\KaizhiPython.exe` 的 `--smoke`、`--harness-smoke` 均返回 0；临时书库导入合成 PDF（经过新的导入队列）。最终 EXE 的 `--office` 能把真实 .docx 转成有效 PDF，EXE 内含 `ImportDialog` 资源，窗口标题为「阅迁星穹」。
- 界面改动和「加入文档」窗口另用本地脚本驱动隐藏的真实 Qt 窗口（临时书库）逐步检查并截图，覆盖：自动打开阅读助手、翻译助手隐藏 / 恢复 / 关闭、新装暖色极简与老用户保持液态玻璃、真实 Word 转换进度、失败原因与建议、打开文档、纯 PDF 拖入不弹窗。这些脚本是一次性的，未纳入仓库。
- 本机构建目录 `dist/` 只有 `KaizhiPython.exe`；源码分支不含 EXE、虚拟环境、依赖缓存、书库、密钥或本地备份。

## 版本控制、恢复与下一步

目标分支原先只有占位 README（`da617d6`）；清理阶段沿用该提交历史，不基于旧主分支，也不推送清理前源码，提交为 `6916ea8`。改动前已在本机保存并校验 303 个源文件的归档。恢复某个已移除文件时，请在独立目录解包比对，不要覆盖正在使用的项目。

**Harness 重构与 11-19 下午的改动尚未提交。** 提交时注意尚未跟踪的新文件：`harness/`（`build.mjs`、`runtime.mjs`、`worker.mjs`、`package.json`、`package-lock.json`、`licenses/`）、`backend/harness.py`、`backend/harness_smoke.py`、`frontend/src/ai/harness.mjs`、`frontend/src/components/ImportDialog.vue`、`frontend/src/library/importer.ts`、`frontend/tests/unit/import-queue.test.mjs`、`tests/test_harness.py`、`tests/test_import_feedback.py`。

AI 打包会一同封装 Node 与 Harness；使用 `scripts/build-windows.ps1 -Test` 可检查打包好的 EXE 是否能独立完成本机模拟模型请求。打包前先关闭正在运行的 `KaizhiPython.exe`，否则无法覆盖 `dist` 里的文件。原来的登录或密钥不会被使用，首次需在设置中重新填入对应端点的 API Key。

下一轮如改 PDF 或 AI，请同时跑前后端单测和 Qt 冒烟，再手工检查并排阅读、框选和长文档滚动；改导入或 Word 转换时再开 `KAIZHI_TEST_OFFICE=1` 跑一次真实转换。建议的后续：给 Word 转换加取消（结束 `--office` / LibreOffice 子进程并清理临时文件），重跑 Vue 组件模拟测试。尚未验收：付费 AI 端到端会话、真实覆盖升级和 NSIS 安装/卸载（本机未发现编译器）。分支上已推送的是**源码**，不是 GitHub Release。正式分发前请补齐 `THIRD_PARTY_NOTICES.md` 标出的独立字体授权说明。
