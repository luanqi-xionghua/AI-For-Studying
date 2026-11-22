# 阅迁星穹 Python 桌面版 · 开发交接

**2026-11-21（上海时间）｜仓库：`luanqi-xionghua/AI-For-Studying`（`main`）｜源码版本：`1.1.5`（发布 tag `v1.1.5`；上一个发行版 `v1.1.1`）**

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

**后端 Python 零改动**：`backend/` 下所有文件未修改，SQLite `user_version` 仍为 1，旧备份可继续恢复；没有新增 npm / Python 依赖；本功能实现期间 `VERSION` 与 `frontend/package.json` 的 `version` 保持 1.0.5 不变，发布时统一提升到 1.1.0；`import_documents` 的签名与参数未变。

### 模块清单

- `frontend/src/chat/`：`types.ts`、`history.ts`、`choice.ts`、`storage.ts`、`state.ts`、`index.ts`；页面组件 `components/chat/*`（页面、记忆范围、历史、消息列表、输入栏）与 `components/ui/MarkdownAnswer.vue`
- `frontend/src/memory/`：`types.ts`、`normalize.ts`、`events.ts`、`prompts.ts`、`merge.ts`、`scheduler.ts`、`store.ts`、`summarize.ts`、`engine.ts`、`index.ts`；页面组件 `components/memory/*` 与 `components/ui/ConfirmDialog.vue`
- `frontend/src/shared/storage-gate.ts`：备份前 flush、恢复前 freeze
- 接线：`ai/workspace.ts`（assistant-turn）、`App.vue`（opened / reading / document-removed、引擎启动停止、文档列表同步、侧栏与整页导航）、`library/importer.ts`（学习模式）、`components/settings/SettingsDialog.vue`（备份冻结）、`ai/settings.mjs`（memoryPreset / memoryEffort）、`ai/providers.mjs`（READER_SYSTEM / systemPrefix）、`ai/usage.ts`（chatmode / memory）

### 记忆注入范围（2026-11-20 追加，随 1.1.1 发布）

- 新增 `frontend/src/ai/memory-context.ts`：统一给阅读助手（含文档工具调用）、翻译、快速解释、问题预判取记忆；优先当前文档记忆，没有可注入内容时退回全局记忆；记忆模块未加载/存储异常时静默返回空串，不影响这些功能本身。
- `memory/prompts.ts` 的 `buildInjection` 与 `engine.injectionFor` 增加 `MemoryPurpose`（`chat / assistant / translate / explain / predict`），记忆正文相同，只替换最后一行「使用要求」；注入长度上限仍是 1500 字。
- `App.vue` 在切换当前阅读文档时登记 active document（并排副本按原文档 id），翻译/解释/预判据此取记忆。
- 对话模式的「记忆范围」按钮从页头移到输入栏（`ChatComposer` 的 `scope` 插槽），弹层向上展开；页头保留历史/新对话，状态行不变。
- 翻译缓存 `via` 包含记忆文本，记忆变化会使旧译文缓存失效。
- 新增 `frontend/tests/unit/memory-surfaces.test.mjs`；`memory-prompts` / `memory-engine` 覆盖用途文案。最终前端 **344/344** 通过，构建通过。
- 已随 **1.1.1** 发布（tag `v1.1.1`）；真实模型下「记忆是否真的改变回答风格」仍建议人工验收。

### 学习模式新增两问（2026-11-20 追加，随 1.1.1 发布）

- `memory/types.ts` 的 `OnboardingAnswers` 增加 `goal`（学习目标，必填，≤100 字）与 `preference`（学习偏好说明，选填，≤200 字）；`note`（补充）上限仍 200 字。旧数据归一化为空串，旧记忆仍可读取。
- 共用表单 `components/memory/OnboardingFields.vue` 增加两个问题与字数计数；`library/importer.ts` 的 `learningReady` / `currentLearningAnswers` 要求目标非空，导入弹窗的「点选择区/拖放」都会在缺目标时拦截并提示。
- 记忆页「补填自评」与编辑表单同步显示/可编辑学习目标与偏好；`DocumentMemoryDetail` 展示这两项，`MemoryEditForm` 的 patch 会写回。
- 归一化、合并证据、两份总结输入、对话/阅读助手等注入文本都包含学习目标与偏好：`normalizeOnboarding`、`applyOnboarding`、`onboardingSummary`、`buildDocumentInput`、`buildGlobalInput`、`buildInjection`。
- 导入弹窗内容区改为可滚动（标题固定，滚轮/滚动条查看下面的问题与列表），学习模式展开后不再溢出窗口底部。
- 测试：`import-learning`（目标必填/截断）、`memory-normalize`、`memory-prompts` 同步更新；前端 **344/344** 通过，构建通过。

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

## 对话模式附件 · 会话附属栏 · 记忆写入规则（2026-11-21，v1.1.5）

依据：`对话模式附件与会话附属栏-实施清单.md`（M0 + M1–M5）。实现期间保持 **1.1.1**、使用 `feature/chat-attachments` 本地分支；发布时统一提升到 **1.1.5**，合入 `main` 并打 tag `v1.1.5`（见下方「1.1.5 发布」）。

### 1.1.5 发布（2026-11-21）

- 内容：对话模式图片附件、文档库附件（单本直答 / 2–3 本对比 + 引用）、临时文档（后端 `tempdocs.py`）、会话附属栏、学习记忆写入规则、界面细节修复、背景动画越界修复。完整说明见 `docs/release-notes-1.1.5.md`，与 GitHub Release `v1.1.5` 的正文一致。
- 兼容：数据目录、`KAIZHI_*` 环境变量、SQLite `user_version = 1`、`chatmode.v1 / memory.v1` 键语义都不变；1.1.1 的书库、记忆、对话记录与备份可直接沿用，新字段对旧版本是可选字段。
- 发布物：`YueqianXingqiong-1.1.5-setup.exe`、`YueqianXingqiong-1.1.5-portable.zip`、`SHA256SUMS.txt`；应用内更新器按 `v1.1.5` 的 `sha256` digest 校验后安装。
- 测试：前端 431/431、后端 47 项（skipped=1）、`vue-tsc`、构建、打包后 `--smoke` / `--harness-smoke` 全部通过。

### 基线（M0，2026-11-21 实跑）

- 分支 `feature/chat-attachments`，基于 `52df48e chore(release): 1.1.1`；工作区干净；与桌面快照 `AI-For-Studying-main` 逐文件一致（264 个文件，仅 CRLF/LF 差异）。
- 前端：`npm.cmd --prefix frontend test` → **344/344 通过**（43 个测试文件，约 12.1s）；`npm.cmd --prefix frontend run build` 通过（`vue-tsc --noEmit` + vite，约 9.5s；`ChatModePage` 24.57 kB / CSS 13.45 kB，`desktop-app` 1,005.57 kB，>500 kB chunk 警告为既有）。
- 后端：`.venv\Scripts\python -m unittest discover -s backend/tests -t .` → **Ran 32 tests，OK (skipped=1)**（约 11.3s；Word 集成用例需本机 Office）。
- 冒烟：`backend\main.py --harness-smoke` 退出码 0；`backend\main.py --smoke` 退出码 0（临时数据目录，未碰真实书库）。
- 日志：`D:\work\logs\m0-*.log`。

### 本次改动范围（M1–M5，按里程碑提交）

| 里程碑 | 内容 | 提交 |
| --- | --- | --- |
| M1 | 数据模型（附件描述符/标记/引用/进度、`CHAT_ATTACH_LIMITS`）、落库清洗与引用截断、索引读改写串行化；`learningTargets` 规则、`chat-turn.turnId` 幂等、文档范围同时写 doc + global、全局读失败不覆盖真实记忆 | `99e22ac`、`1469c47` |
| M2 | 会话附属栏（`ChatConversationRail` / `rail.ts`）、重命名、搜索、删除、收起与窄窗口抽屉；删除页头「历史」与 `ChatHistoryPanel`；抽屉焦点归还与搜索后键盘复位 | `1c16089`、`7016731` |
| M3 | 图片附件（采集/压缩/预算、粘贴与拖入、预览条、识图判断与拦截、T1 编排、历史文字标记、拖放提示） | `d9352d1`、`49c1431` |
| M4 | 文档库附件（多选弹层、探测、失效标记、持久化）、T2/T3 对比编排、引用渲染与「参考原文」、每本进度与用量合计、`ai-context` 支持 `descriptor.read` | `5d6c5eb`、`e0438da` |
| M5 | 临时文档后端接口（`tempdocs.py` + `server.py` TEMP 接线 + 14 项后端测试）、前端 `sdk.tempDocs`、上传入口/转换状态/失效占位、删除会话释放句柄、三份文档 | 见 `git log` |

### 后端改动范围（唯一改动）

- 新增 `backend/services/tempdocs.py`：不透明句柄、路径只留在后端、扩展名/大小/文件头/UTF-8 校验、Word 转 PDF、指纹校验、`chat-temp/` 清理、固定错误码（`TEMP_*`，永不含路径）。
- `backend/api/server.py`：`TEMP` 命令组（`temp_doc_pick/prepare/read/release`）、`self.temp = TempDocs(root)`、pick 走原生对话框、prepare 进度通道、`clear()`/`close()` 清理。
- **未改**：`library.py`、`word.py`、`core/desktop.py`、`runtime/harness.py`、`harness/*`。SQLite `user_version` 仍为 1，未新增 npm / Python 依赖。

### 存储字段

- `chatmode.v1.c.<id>` 新增可选字段：会话 `attachments`（≤3，temp 只存「临时文档 N」占位）、`customTitle`；用户消息 `attach`（图片张数 + 本轮文档标记，落库前临时标题匿名化）、`refs`（docs/cites，≤40 条，`snippets` 只在内存）、`progress` 只在内存；图片 data URL 只在内存；`usage.calls` 可选。
- `memory.v1.*`：`MemoryEvent.turnId` 可选，用于重新回答时替换待总结项。
- localStorage 新增 `kaizhi.chatmode.rail.v1`（`{version:1,collapsed}`）。
- 临时文档句柄、真实文件名、转换目录都只在内存/`chat-temp/`，不进 SQLite、不进备份。

### 记忆写入规则（优先级从高到低）

| 记忆范围 \ 本轮 | 无附件且成功 | 带图片或文档 | 失败 / 停止 / 空回答 |
| --- | --- | --- | --- |
| 文档 A | 写 A + 全局 | 不写 | 不写 |
| 全局 | 只写全局 | 不写 | 不写 |
| 不使用记忆 | 不写 | 不写 | 不写 |
| A 已从文档库移除（降级为 none） | 不写 | 不写 | 不写 |

同一 `turnId` 重新回答时只替换待总结项的 answer/at，不追加、不新增证据、不重复计问题数。

### 界面与测试

- 界面走查（临时书库 + CDP 远程调试）：M2 **29/29**、M3 **21/21**、M4 **18/18**、M5 **9/9**；截图 `C:\Users\15076\Desktop\dsh workspace\screenshots\m2-* / m3-* / m4-* / m5-*`。
- 最终回归：前端 `npm test`（427 项）+ `vue-tsc` + `npm run build`；后端 `unittest`（46 项，skipped=1）；`--smoke` / `--harness-smoke` 退出码 0。

### 已知限制（本次）

1. **Word 转换不能中途取消**：`release` 只打取消标记，chip 会显示「正在取消…」，等本机 Office/LibreOffice 转换结束后才清理临时目录（最长约 200s）。
2. **资源管理器拖入图片不支持**：Qt 只把文件路径交给页面；对话页提示改用「图片」按钮或 Ctrl+V；从浏览器/截图工具拖出的图片数据可以拖放。
3. **真实模型端到端未自动跑**：3 本对比、带图回合、引用页码抽查需要有效 API Key，留给发布前人工验收（S09/S10/S12/S17–S19）。
4. **加密 PDF**：文档库里的加密 PDF 必须在本次运行内先在阅读器里解锁；临时文档的加密 PDF 直接拒绝并提示另存无密码副本。
5. **扫描件**：只在「附加时探测第一页有没有文字」；识图模型可读，不识图模型直接标错误并提示换模型。
6. **全局总结重复计入**：文档范围的问答会同时进入「A 的总结来源」和「全局待总结」，这是决策 6 的预期行为，额度护栏不变。
7. **首屏不加载 pdf.js**：`pdf-engine` 仍是独立 chunk，对话页 chunk 里只有动态导入引用；M4 的 `pdf-engine` 预览警告属既有结构（`providers.mjs` 在 `settings.mjs` 里本来就有静态引用）。
8. **回退**：按里程碑 `git revert` 即可；数据层不迁移、不升版本，旧版会把新字段静默丢弃（正文/标题保留）。撤回 M5 后如残留 `chat-temp/` 需要手动删除。



## 资料检索（三源公开资料目录，待发布 1.2.0）

侧栏新增与「对话模式」「记忆管理」并列的整页「资料检索」：缓存 OpenISE、SYSU-Exam、破壁计划（arxiv.jaison.ink）三个公开来源的资料目录，在本机按课程与意图做 BM25 检索；文档库里已有的书排在最前、网络结果标「你已有」；配置了 AI 预设时由模型在候选集内重排并各写一句理由；结果只给外链，点开交给系统默认浏览器。

### 模块清单

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 后端（纯函数） | `backend/services/material_index.py` | NFKC 与中文二元组分词、三源记录解析与过滤、按「文件名+大小」合并去重、BM25 索引、查询解析（课程简称、意图正则、课程边界规则）、置信度闸门、文档库匹配、URL 白名单 |
| 后端（服务） | `backend/services/materials.py` | 独立 `materials.sqlite3`、三源同步（显式 30s 超时、3 次退避重试、重定向白名单、可取消、WebSocket 进度）、索引懒加载、六个命令、`webbrowser.open` 开外链 |
| 后端（接线） | `backend/api/server.py` | `MATERIAL` 命令组、`start()` 建实例、`api()` owner 链、`clear()`/`close()` 取消与收尾 |
| 前端 | `frontend/src/materials/{types,client,state,index}.ts` | 契约、RPC、状态机、默认装配 |
| 前端 | `frontend/src/components/materials/{MaterialsPage,MaterialResultRow}.vue` | 整页与结果行 |
| 前端 | `frontend/src/ai/materials.ts` | 重排提示词、序列化、解析校验、超时/超长中止 |
| 接线 | `App.vue`（6 处）、`AppIcon.vue`（1 行）、`sdk/python.ts`（1 处）、`ai/usage.ts`（2 行）、`ai/complete.ts`（2 行） | 页面入口、图标、通道注销、`discover` 用量、`systemPrefix` 透传 |

### 后端改动范围

- 只**新增**两个 service 文件与一个测试文件；`server.py` 六处接线。
- **未改动**：`library.py`、`word.py`、`updates.py`、`tempdocs.py`、`core/*`、`runtime/*`、`main.py`、`requirements.txt`、`harness/*`。`library.sqlite3` 的 schema 与 `user_version` 仍为 1，只被只读调用 `list_documents()`。
- **无新依赖**：分词、BM25、SQLite 全部用标准库 + 已有 aiohttp。
- 数据文件：`<数据目录>/materials.sqlite3`（WAL），独立于书库，不进备份，损坏时改名 `.corrupt` 并自动重建。
- 外部访问：`api.github.com`、`arxiv.jaison.ink`；`allow_redirects=False` 且手动跟随只在白名单内，UA 为 `YueqianXingqiong-Materials/<版本>`，不带 Cookie/Authorization。
- 开外链：`material_open` 只收条目 id，URL 从本机索引取，再过 `validate_open_url`（https、主机白名单、无 userinfo、端口空/443、无 fragment）。资料页**不使用 `<a>`**（`desktop.py` 的 `acceptNavigationRequest` 会把任意 http 链接交给系统打开）。

### 实测数据（2026-11-21）

| 来源 | 原始 | 过滤后 | 合并后主条目 |
| --- | --- | --- | --- |
| OpenISE | 2988 blob | 1608 | 1549 |
| SYSU-Exam | 376 | 301（含 12 个图片目录折叠） | 247 |
| 破壁计划 materials | 5303 | 2641 | 998 |
| 破壁计划 packages | 199 | 188 | 188 |
| 合计 | — | 4738 | **2982** |

索引构建约 90 ms，单次检索 2–10 ms。真实同步约 81 s（57 个请求）。

### 基线（本次实施后实跑）

- 后端：`unittest discover -s backend/tests -t .` → 67 项，其中资料检索 26 项全过；环境性失败 11 项（缺 `harness/dist`、缺 PySide6、缺 DPAPI），与本次改动无关。
- 前端：`npm test` → **468 项全部通过**（原有 431 + 新增 37）。
- 前端构建：`npm run build` 通过，`MaterialsPage` 独立 chunk 约 31.6 kB。
- 未跑：Qt 真机走查（本机没装 PySide6，无法启动桌面壳）；发布前需按方案 §12.4 人工过一遍四种外观。

### 已知限制（本次）

1. **不下载、不预览、不加入文档库**：只给外链。破壁计划的下载接口需要登录，所以产品上不承诺能直接拿到文件。
2. **只索引目录，不索引正文**：能回答「有没有这份资料」，不能回答「哪份资料里讲了某个定理」。
3. **不上后台定时同步**：只有用户点「同步/更新索引」才联网；索引超过 7 天只在页面上提示。
4. **破壁计划是个人站点**：接口没有稳定性承诺，字段或分页行为变化会表现为「部分来源没有连上」，旧索引照常可用。
5. **GitHub 未认证限速 60 次/小时**：一次同步只用 2 次，并强制 60 秒冷却；被限流时只保留 GitHub 的旧数据。
6. **AI 重排只在已召回候选内排序**：模型不生成链接；失败、超时、输出超长都静默回落到本地顺序，不弹提示。
7. **`category` 元数据不可用**：实测 88.6% 是 `other` 或空，所以意图判断完全走标题正则。
8. **回退**：只新增文件 + 少量接线，按里程碑 `git revert` 即可；旧版本程序会忽略 `materials.sqlite3`，`localStorage['kaizhi.materials.v1']` 留着无害。

### 1.2.0 增补：查询改写（AI 辅助的第一步）

- 位置：`frontend/src/ai/materials.ts`（`REWRITE_SYSTEM` / `parseRewrite` / `rewriteQuery`）+ `materials/state.ts` 的 `submit()`（`rewriteForSearch`）。
- 时机：`prefs.aiRerank` 为真、`rerankAvailable().ok` 为真、查询长度 ≥ 2 时，先调一次小模型（`kind:'discover'`、`fast:true`、阅读助手预设）把口语改写成「规范课程名 + 资料类型」。
- 兜底：改写失败/超时（8s）/输出为空/越界，一律回落到原查询；改写后 `found=false` 时用原话再搜一次，原话有结果就以原话为准。
- 展示：`state.search.rewritten` 非空时，页面在搜索框下方显示「已按「…」检索」。
- 接口开关：页面上的「AI 排序」改名为「AI 辅助」，一处开关同时管改写与重排。
- 测试：`materials-rerank.test.mjs` 增 5 项（解析、空输出、截断、调用参数、超时中止）；`materials-state.test.mjs` 增 4 项（改写生效、失败回落、改写无结果回落、无预设不改写）。

## 模拟测试（1.2.3）

- **模块**：`frontend/src/exam/` 状态机与数据层；`frontend/src/ai/exam.ts` 提示词与调用；`frontend/src/components/exam/` 四个组件；`backend/services/exams.py` 导出服务。
- **后端改动范围**：新增 `services/exams.py`；`api/server.py` 加 import、`EXAM` 常量、`self.exams`、`exam_export()` 与 `api()` 分支；`core/desktop.py` 加 `select_exam_export` 分支。`library.py` / `word.py` / `tempdocs.py` / `materials*.py` / `updates.py` / `runtime/*` / `harness/*` / `main.py` / `requirements.txt` 未改，SQLite schema 与 `user_version` 未变。
- **存储键**：`exam.v1.*`；`kaizhi.exam.choice.v1`（localStorage）。备份 / 恢复沿用现有机制，试卷在 `settings` 表里随书库一起走。
- **测试基线**：前端 **578 项**（1.2.2 为 484），后端 **88 项**（73 + 15）。
- **已知限制**：
  1. 真实模型走查（方案 §13.3 前三行）尚未完成：开发副本没有 API Key，只验证到「打开原书 → 读到证据 → 模型请求停在缺少 Key」。发版前应在一台有 Key 的机器上各出一套。
  2. `memory-engine` 的 `quiz-result` 分支没有单独的引擎用例，覆盖靠 `memory-quiz`（normalize / merge / prompts 纯函数）。
  3. 导出用的是后端原生「另存为」，人工走查（只读目录、U 盘、同名）留给发版前；HTTP 层与文件层已有 `test_exams.py` 覆盖。

### 1.2.6（2026-11-22）

- **真实模型出题**：deepseek-flash 思考「中」（实际回退为 high）0/20 的根因与修复见 `docs/bug-report-1.2.6.md` A 节。应用外对照 16 次请求 + 开发副本真机整卷 30 次请求（按工具轮计）；真机 20/20（第 2 批靠收尾调用救回），交卷、结果页、导出 md、写记忆都走过。
- **bug-report 摘要**（共 16 条：11 条代码修复、均带单测，1 条文档修正，其余为补测试 / 确认 / 待观察）：
  - 严重：A 出题 0/20——最后一轮思考吃掉输出上限、工具轮用尽后模型把工具调用标记当正文 → `examMaxTokens` + 收尾调用。
  - 高：N1 交卷后不能展开答案、不能给大题自评（大题永远 0 分）；C2 失败批次刷新后丢失，且部分成功时单批重试按钮本来就不可达。
  - 中：C1 失败后残留「正在准备出题…」；C4 选项 Markdown 放在 `<button>` 里。
  - 低：C3 导出确认文案；C5 卸载后提示丢失；N2 用量从未回报；N3 / N4 重试与停止的状态残留；N5 评分要点「1. 1.」。
  - 未修 / 待观察：C6 记忆 pending「替换」分支重复写一次（内容幂等，影响可忽略）；C7 只读目录导出未走查；N7 自动化中各出现一次、无法复现的提示与跳页。
- **改动范围**：`frontend/src/ai/exam.ts`、`frontend/src/exam/{state,scoring,index,progress,notify}.ts`、`frontend/src/components/exam/{ExamPage,ExamSetupPanel,ExamQuestionCard}.vue`、`frontend/src/components/assistant/ModelPicker.vue`（新增 `confirmPlacement`，默认值保持原行为）。后端只改 `backend/__init__.py` 的版本号；harness、document-chat、providers、complete、schema 均未改，未新增依赖。
- **测试基线**：前端 **612 项**（新增 33 项：`exam-prompts` 12、`exam-state` 7、`exam-progress` 4、`exam-surfaces` 5、`exam-scoring` 1、`memory-quiz-engine` 4），后端 **88 项**。
- **调试**：`localStorage.setItem('kaizhi.exam.debug.v1', '1')` 打开出题调试记录，用 CDP `Runtime.consoleAPICalled` 读 `[exam-debug]` 行；用完删掉这个键。
- **已知限制**：deepseek-v4-pro 思考「低 / 高」没有做整卷实测，单批可能逼近 240 秒超时；N7 待观察。
