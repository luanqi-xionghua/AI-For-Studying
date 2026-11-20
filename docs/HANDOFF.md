# 阅迁星穹 Python 桌面版 · 开发交接

**2026-11-19（上海时间）｜仓库：`luanqi-xionghua/AI-For-Studying`（`main`）｜源码版本：`1.0.1`（首个公开发行版为 `v1.0.0`）**

## 接手先看

以 `README.md` 为运行、打包和发布依据，`USAGE.md` 是给使用者的手册。产品只有 Windows 桌面版：使用者从 Releases 下载安装版或免安装版；开发时运行 `Start.cmd`（源码）。不可把可写数据目录指向别的已有书库；默认书库在 `%APPDATA%\com.phydog.reading.python`。

软件名「阅迁星穹」，发行文件用拼音 ASCII 名 `YueqianXingqiong`（GitHub 会把附件名里的中文改成点号）：程序 `YueqianXingqiong.exe`，发布附件 `YueqianXingqiong-X.Y.Z-setup.exe` / `-portable.zip`，标签 `vX.Y.Z`。**数据目录 `com.phydog.reading.python`、`KAIZHI_*` 环境变量、`kaizhi.*` 存储键、`X-Kaizhi-Token`、Qt 内部应用名 `KaizhiPython` 为兼容既有安装保持不变**：已保存的书库、设置和密钥继续可用，不要顺手改掉。

## 1.0.1 启动回归与验证

- 启动对照：同一台 Windows 主机，在独立桌面上交错启动 1.0.0 单文件和 1.0.1 目录版，各三次，使用独立测试数据目录。从创建进程到首次检测到可见的「阅迁星穹」主窗口，中位数分别为 10.63 秒与 1.34 秒。未重置系统磁盘缓存；这是本机抽样，不是冷启动上限，也不是书架可交互时间。
- 外观回归测试在真实 Qt WebEngine 中延迟设置响应，验证默认风格没有挂载、随后第一次挂载就是保存的风格、启动不调用换肤过渡。首次安装保留暖色、旧设置保留玻璃，主动切换仍沿用原动画。

## Windows 发行与更新

| 项 | 做法 |
| --- | --- |
| 版本号 | 只在 `backend/__init__.py` 的 `VERSION` 改；EXE 版本信息（`scripts/make-version-info.py`）、安装包（`makensis /DVERSION`）、更新器都从这里读 |
| 图标 | `scripts/make-icon.py` 把 `frontend/public/favicon.svg` 渲染成 `frontend/public/app.ico`（16–256 px）；用于 EXE、安装包和窗口 / 任务栏（`backend/core/desktop.py` 设置 `setWindowIcon`） |
| 安装包 | `scripts/installer.nsi`（NSIS 3，Modern UI 2，简体中文）：欢迎页、MIT 许可页、可选桌面快捷方式、选择目录、完成后可运行。按用户安装到 `%LOCALAPPDATA%\Programs\YueqianXingqiong`，不要管理员权限；登记到「设置 → 应用」（HKCU Uninstall 键，含版本、发布者、图标、大小）；附带 `LICENSE.txt` 与 `THIRD_PARTY_NOTICES.md`；程序在运行时会等它关闭。卸载保留书库与设置，并在确认页说明数据位置 |
| 应用内更新 | `backend/services/updates.py`：仓库 `AI-For-Studying`，标签 `vX.Y.Z`（兼容旧的 `python-vX.Y.Z`），附件名见上，校验 GitHub 记录的 SHA-256。安装版以 `/S` 静默安装到原目录（`InstallDirRegKey`），完成后自动重新打开；目录便携版使用同一已验证 setup 的 `/S /PORTABLE` 模式原地更新，不写注册表或快捷方式。旧单文件用户手动迁移一次 |
| 构建 | `scripts\build-windows.ps1 -Test -Release`：测试 → 打包 → 打包后冒烟 → NSIS → `dist\release\`（setup、portable、`SHA256SUMS.txt`）。找不到 `makensis` 时会看 NSIS 默认安装目录 |
| 未做 | 没有代码签名证书，首次运行可能出现 SmartScreen 提示（README / USAGE 已说明）。Anthropic Serif 字体与阅读助手按钮的菊花图标按用户决定原样保留，授权由用户负责（见 `THIRD_PARTY_NOTICES.md`） |

历史验收（1.0.0 发行文件本身）：静默安装到临时目录后，四个文件齐全；「应用」列表显示阅迁星穹 1.0.0、发布者与大小；开始菜单快捷方式存在；EXE 属性的产品名与版本正确；安装完自动重新打开，窗口标题为「阅迁星穹」（用临时书库）；正常关闭后静默卸载，程序、注册表项、快捷方式都已移除，用户数据保留。

## 删除了什么，留下了什么

| 变更 | 接手时要知道的原因 |
| --- | --- |
| 移除整个扩展、浏览器消息 Host、独立 Host 入口、构建/注册/检查脚本及本地旧 Host 产物 | 命令行不再分派扩展消息；只有桌面程序入口；从 1.0.1 起其依赖目录随安装包和 ZIP 一并交付。历史安装如曾注册助手，本轮不自动注销，以免误动既有安装的配置。 |
| 迁出仍在使用的纯前端模块 | PDF 几何、选区、文本索引与渲染基类在 `frontend/src/reader/core/`；文档工具协议、限流队列及 API 地址校验在 `frontend/src/shared/`。桌面阅读、框选、AI 工具仍使用这些实现，不依赖扩展源码。 |
| 移除旧桌面打包/发布工具和旧 UI 验收脚本 | 删除指向原工具链、旧安装包、浏览器预览或已不存在 fixture 的脚本。桌面验收入口改为真实 Qt `--smoke`；不等于所有旧 UI 场景都已有 Qt 自动化覆盖。 |
| 移除独立网页版 | 不再创建浏览器文档库；无桌面令牌的页面只提示从桌面启动。选文件、拖放、全屏、更新和 AI 请求均由桌面桥接处理。Qt WebEngine 是桌面界面的渲染引擎，不能删除。 |
| AI 全部改用 DeepSeek Harness | 已删除 `backend/codex.py`、`native_*` 和旧 HTTP 代理。阅读助手、翻译等任务统一从 Python 转交本机 Harness，使用用户配置端点的 API Key。Windows 路径、SQLite 格式及数据目录保持不变。 |
| 收敛更新逻辑 | 后端 `backend/services/updates.py` 是发布版本与附件选择的唯一实现。测试故意放入比 Python 版本号更高的 `desktop-v…` 反例，防止误装历史版本。 |
| 导入统一走「加入文档」队列 | 删除 `library.importDocuments` 和 `importDroppedDocuments`；按钮、Ctrl+O、右键菜单和拖放都交给 `frontend/src/library/importer.ts` 逐份加入。后端 `import_documents` 的批量接口保留，一次传多个路径仍是全有或全无。 |

## 目录结构整理（仿照 ZhiPath）

11-19 晚按 `ZhiPath-main` 的目录习惯整理：Python 的入口、依赖和测试都收进 `backend/`，后端按职责分层；前端组件按业务分子目录；根目录只留说明、启动脚本和各子工程。全部用 `git mv`，文件历史可用 `git log --follow` 追溯。**行为没有变化**：前后端测试、Qt 冒烟、真实 Word 转换和打包后的 EXE 均重新验证。

| 原位置 | 现位置 |
| --- | --- |
| `run.py` | `backend/main.py`（源码运行 `python backend\main.py`；文件开头把项目根目录放进 `sys.path`，打包时 PyInstaller 加 `--paths .`） |
| `requirements.txt` | `backend/requirements.txt` |
| `tests/` | `backend/tests/`（运行：`python -m unittest discover -s backend/tests -t .`） |
| `backend/server.py` | `backend/api/server.py` |
| `backend/desktop.py`、`backend/windows.py` | `backend/core/` |
| `backend/harness.py` | `backend/runtime/harness.py` |
| `backend/library.py`、`word.py`、`updates.py` | `backend/services/` |
| `backend/pdf_smoke.py`、`harness_smoke.py` | `backend/scripts/` |
| `frontend/src/components/*`（30 个平铺文件） | `components/assistant/`、`translate/`、`reader/`（含 `ink/`）、`library/`、`settings/`、`layout/`、`markdown/`、`ui/` |
| — | 新增 `USAGE.md`（使用手册）和 `docs/images/`（README 截图） |

`harness/` 是独立的 Node 工程，和 `frontend/` 一样留在根目录。打包产物名、数据目录、环境变量都没变。改结构时注意三处按文件位置计算的路径：`backend/main.py` 的 `ROOT`、`backend/runtime/harness.py` 找 `harness/` 的 `parents[2]`、`backend/services/word.py` 启动 `--office` 子进程用的 `backend/main.py`。前端组件之间、测试到组件的相对路径由一次性脚本按旧位置逐条换算，`tests/unit/r7-reading.test.mjs` 也改为递归扫描组件目录。

## 界面改动（11-19 下午）

| 改动 | 行为 | 位置 |
| --- | --- | --- |
| 打开文档时默认开启阅读助手 | 从文档库点开文档或打开新文档时自动打开；已开标签之间切换不强制打开，用户关掉后保持关着 | `frontend/src/App.vue` 的 `showDocument` |
| 修复：退出文档后翻译栏残留 | 翻译助手属于阅读工作区：回文档库时隐藏、回到文档时恢复，关掉最后一个文档时关闭；文档库里 Ctrl+T 与「机翻」不生效 | `App.vue` 的 `translateShown`、`clearWorkspace` |
| 首次安装默认「暖色极简」 | 没有保存过设置**且**文档库为空才算新装，用暖色极简并立即写入设置；已有书的老用户、老设置里缺少界面风格时按液态玻璃处理，外观不变。「恢复默认」回到暖色极简 | `frontend/src/settings/index.ts` 的 `firstRunPreferences`、`model.ts` 的 `LEGACY_UI_STYLE` |
| 「翻译」改为「翻译助手」 | 顶栏按钮与阅读助手同款胶囊；面板标题与提示同步改名（面板宽度 ≤360px 时标题只显示图标，是原有规则） | `App.vue`、`frontend/src/components/translate/TranslatePane.vue` |
| 发行名「阅迁星穹」 | 见「接手先看」；`installer.nsi` 改为带 BOM 的 UTF-8，覆盖安装会清掉旧版快捷方式 | `frontend/index.html`、`App.vue`、`backend/core/desktop.py`、`scripts/installer.nsi` |
| 「加入文档」窗口 | 见下一节 | `frontend/src/components/library/ImportDialog.vue`、`frontend/src/library/importer.ts` |

## 「加入文档」窗口与 Word 转换反馈

- **窗口**：上方拖放区（窗口开着时拖入的文件交给它，不再显示整屏遮罩）兼「选择文件」；下方一行小字说明 PDF / Markdown 原生支持、Word 先转为 PDF；再下面逐份列出状态。全部成功时自动关闭并打开第一份；有失败时保留窗口并给出「打开」按钮。窗口没开时拖入纯 PDF / Markdown 仍直接导入，批次里有 Word 或无法加入的文件才自动弹出。转换中可关闭窗口，后台继续。
- **进度**：`import_documents(paths, onProgress=None)` 在 Word 转换时报告 `office` → `libreoffice` → `adding` 步骤；`backend/api/server.py` 的 `progress` 把它转成 WebSocket 事件通道（与更新下载同一机制），前端 `importDocument` 用 `Channel` 接收。转换工具不报告百分比，所以进度条按时间在每步内逼近上限、只进不退，转换完成才到 100%（`wordProgress`）。
- **失败原因**：`backend/services/word.py` 的 `--office` 子进程用退出码区分 0 成功 / 2 找不到 Word·WPS / 3 打不开或导出失败（可能有密码或已损坏）/ 4 Word·WPS 正开着别的文档；Word·WPS 超时、LibreOffice 缺失 / 失败 / 超时都会拼进原因。导入校验也改为逐项说明：找不到文件、不支持的扩展名、超出大小、文件头与扩展名不符、Markdown 非 UTF-8。Word 失败时界面附带「先另存为 PDF 再加入」的建议。
- **已知限制**：损坏的 Word 可能让 Word / WPS 停在隐藏对话框上，要等满 `TIMEOUT`（100 秒）才失败，且还没有取消按钮。WPS 超时后可能留下无窗口的后台进程（`wpscloudsvr.exe`、`wps.exe`）。

## 本轮验收

- Windows，Python 3.13.5 / PySide6 6.12.0 / Node 26.13.0 / PyInstaller 6.22.3。
- 前端：`npm.cmd --prefix frontend test` **143/143**（含新增 `import-queue.test.mjs`）；类型检查与 Vite 构建通过。Vue 组件模拟测试（`tests/sim/`）在 Harness 重构时为 16/16，下午未重跑：所需测试依赖不在 `package.json` 里，需要临时安装。
- Python：`unittest discover -s backend/tests -t .` **29 项：28 通过，1 跳过**（可选 Office 测试）。新增 `backend/tests/test_import_feedback.py`（导入错误原因、模拟 Word / LibreOffice 缺失、失败、超时、占用时的原因与进度步骤）和进度事件经 HTTP + WebSocket 送达的测试。另开 `KAIZHI_TEST_OFFICE=1` 时 `backend.tests.test_word_integration` 用本机 Word 真实转换通过。
- Qt：`backend\main.py --smoke` 与最终 `dist\YueqianXingqiong.exe` 的 `--smoke`、`--harness-smoke` 均返回 0；临时书库导入合成 PDF（经过新的导入队列）。最终 EXE 的 `--office` 能把真实 .docx 转成有效 PDF，EXE 内含 `ImportDialog` 资源，窗口标题为「阅迁星穹」。
- 界面改动和「加入文档」窗口另用本地脚本驱动隐藏的真实 Qt 窗口（临时书库）逐步检查并截图，覆盖：自动打开阅读助手、翻译助手隐藏 / 恢复 / 关闭、新装暖色极简与老用户保持液态玻璃、真实 Word 转换进度、失败原因与建议、打开文档、纯 PDF 拖入不弹窗。这些脚本是一次性的，未纳入仓库。
- 源码仓库不含 EXE、虚拟环境、依赖缓存、书库、密钥或本地备份；发行文件只在 GitHub Releases。

## 版本控制、恢复与下一步

目标分支原先只有占位 README（`da617d6`）；清理阶段沿用该提交历史，不基于旧主分支，也不推送清理前源码，提交为 `6916ea8`。改动前已在本机保存并校验 303 个源文件的归档。恢复某个已移除文件时，请在独立目录解包比对，不要覆盖正在使用的项目。

**发行仓库是 `luanqi-xionghua/AI-For-Studying` 的 `main`。** 它在仓库自带的 Initial commit 之上合入了原 `AI-For-Reading` 的完整历史（`6916ea8` 清理 → `0ea9f1b` Harness 重构与 11-19 下午的改动 → `5d304a8` 目录结构整理 → 1.0.0 发行改造），所以 `git log --follow` 能追到旧文件。`AI-For-Reading` 的 `main--from-rust-to-python--my-own` 停在 `5d304a8`，不含发行改造。新增的 Node 工程 `harness/`（含 `package-lock.json` 与 `licenses/`）必须随源码提交；`harness/node_modules`、`harness/dist`、`frontend/dist`、`dist/` 是生成物，不入库。

AI 打包会一同封装 Node 与 Harness；使用 `scripts/build-windows.ps1 -Test` 可检查打包好的 EXE 是否能独立完成本机模拟模型请求。打包前先关闭正在运行的阅迁星穹，否则无法覆盖 `dist` 里的文件。首次使用需在设置中填入对应端点的 API Key。

下一轮如改 PDF 或 AI，请同时跑前后端单测和 Qt 冒烟，再手工检查并排阅读、框选和长文档滚动；改导入或 Word 转换时再开 `KAIZHI_TEST_OFFICE=1` 跑一次真实转换。建议的后续：给 Word 转换加取消（结束 `--office` / LibreOffice 子进程并清理临时文件），重跑 Vue 组件模拟测试。尚未验收：付费 AI 端到端会话、从 1.0.0 升到下一版的真实在线更新（需要先发布更高版本）、在没有装过开发环境的干净 Windows 上安装。`THIRD_PARTY_NOTICES.md` 标出的独立字体授权说明仍待补齐。

## 对话模式 · 记忆管理 · 学习模式

**后端 Python 零改动**：`backend/` 下所有文件未修改，SQLite `user_version` 仍为 1，旧备份可继续恢复；没有新增 npm / Python 依赖；`backend/__init__.py` 的 `VERSION` 与 `frontend/package.json` 的 `version` 仍为 1.0.5；`import_documents` 的签名与参数未变。

### 模块清单

- `frontend/src/chat/`：`types.ts`、`history.ts`、`choice.ts`、`storage.ts`、`state.ts`、`index.ts`；页面组件 `components/chat/*`（页面、记忆范围、历史、消息列表、输入栏）与 `components/ui/MarkdownAnswer.vue`
- `frontend/src/memory/`：`types.ts`、`normalize.ts`、`events.ts`、`prompts.ts`、`merge.ts`、`scheduler.ts`、`store.ts`、`summarize.ts`、`engine.ts`、`index.ts`；页面组件 `components/memory/*` 与 `components/ui/ConfirmDialog.vue`
- `frontend/src/shared/storage-gate.ts`：备份前 flush、恢复前 freeze
- 接线：`ai/workspace.ts`（assistant-turn）、`App.vue`（opened / reading / document-removed、引擎启动停止、文档列表同步、侧栏与整页导航）、`library/importer.ts`（学习模式）、`components/settings/SettingsDialog.vue`（备份冻结）、`ai/settings.mjs`（memoryPreset / memoryEffort）、`ai/providers.mjs`（READER_SYSTEM / systemPrefix）、`ai/usage.ts`（chatmode / memory）

### 存储键

SQLite `settings` 表：`memory.v1.index`、`memory.v1.global`、`memory.v1.doc.<docId>`、`memory.v1.settings`、`chatmode.v1.index`、`chatmode.v1.c.<conversationId>`。
`localStorage`：`paperdesk.ai.settings.v1`（新增 `memoryPreset` / `memoryEffort`）、`kaizhi.chatmode.choice.v1`、`kaizhi.import.learning.v1`。
所有键满足后端 `[a-zA-Z0-9._-]{1,100}`，单值写入前按 900 KiB 守卫（后端硬上限 1 MiB）。

### 额度护栏（定义在 `memory/scheduler.ts`，单测直接断言）

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `TURNS_PER_SUMMARY` | 3 | 每 3 条待总结问答触发一次 |
| `SUMMARY_DEBOUNCE_MS` | 45s | 最后一条事件后的静默时间 |
| `DOC_COOLDOWN_MS` | 10min | 同一本书两次自动总结的最小间隔 |
| `GLOBAL_COOLDOWN_MS` | 15min | 全局记忆两次自动总结的最小间隔 |
| `REQUEST_GAP_MS` | 60s | 任意两次自动记忆请求的最小间隔 |
| `LEFTOVER_AGE_MS` | 30min | 不足 3 条的遗留问答最迟多久后总结 |
| `AUTO_DAILY_CAP` | 40 | 每天自动记忆请求硬上限（文档 + 全局合计） |
| `REQUEST_TIMEOUT_MS` | 90s | 单次记忆请求超时 |
| `RETRY_BACKOFF_MS` | [5min, 30min] | 同一对象第 1、2 次失败后的重试等待；第 3 次起不再自动重试 |
| `BREAKER_FAILURES` / `BREAKER_PAUSE_MS` | 3 / 30min | 连续失败 3 次暂停自动更新 |
| `OUTPUT_CHAR_CAP` | 12000 | 模型输出超过则中止并判失败 |

### 基线（M0，本次实施前实跑）

- 前端：`npm.cmd --prefix frontend test` → **144/144 通过**；`npm.cmd --prefix frontend run build` 通过
- 后端：`unittest discover -s backend/tests -t .` → **Ran 32 tests，OK (skipped=1)**（Word 集成需本机 Office）
- 最终回归：前端 **340/340 通过**（30 个既有 + 12 个新增测试文件）；构建通过；后端仍 **32 OK (skipped=1)**；`backend\main.py --smoke` 退出码 0

### 已知限制

1. 后端没有列键接口（`server.py` 白名单只有 get/set/delete），索引或对话清单损坏时只能按文档 id / 已知会话 id 探测；库里已不存在的文档记忆键会成为无害孤儿，对话清单损坏时旧会话键无法找回（最多 40 段）。
2. 全局记忆没有「更新版本」标志（对话与文档记忆有）：更新版本写入的全局记忆在旧版本里按空处理，存在被旧版本覆盖的理论风险。
3. 重启后若 `globalStale=false` 且 `global.pending` 里还有待总结的全局问答，调度器不会主动读全局记忆（为保持「启动只读两个键」的取舍）；下一次全局事件或文档记忆更新会补上。
4. `MarkdownAnswer.vue` 复制了 `AiPane.vue` 的 `.answer-body` 样式（约 40 行）；两处改动需同步。
5. 对话模式的 `dark/appearance` 在页面挂载时取当前主题，切换主题后要等下一次消息重绘才更新图示外观。
6. 移除文档后 `ai.conversations.v1.<docId>`（阅读助手的分块对话）仍会残留，这是既有行为，本次未动。
7. 第 12.12 节的手工场景仍需人工验收：2026-11-20 已用临时书库（`D:\work\test-data`）和 QtWebEngine 远程调试完成 **55 项界面自动走查**（导航/空态/无预设、阅读→对话→记忆→返回阅读、记忆建立/编辑锁定/清空、导入学习模式校验、四种外观与深浅色切换），截图保存在开发机 `C:\Users\15076\Desktop\dsh workspace\screenshots`。走查发现并修复 2 个界面缺陷（新建空会话被误判为损坏记录、记忆页标签按钮被全局分段控件样式压成竖排）。真实模型端到端（自动/手动记忆总结、用量面板）、原生文件选择框导入、备份导出/恢复仍建议发布前人工验收。

