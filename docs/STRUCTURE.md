# 阅迁星穹 · 交接文档（目录结构与文件职责）

> 适用版本：**v1.1.0**（`backend/__init__.py` → `VERSION = "1.1.0"`）
> 对应提交：`3345484`（GitHub `luanqi-xionghua/AI-For-Studying` 的 `main`）
> 文档生成：2026-11-20
> 阅读建议：先看第 1、2 节了解全貌，再按目录查具体文件；第 8–12 节是接手后最常用的数据、命令与注意事项。

---

## 1. 软件是什么、怎么跑起来

阅迁星穹是 Windows 桌面 AI 阅读器：本地文档库 + PDF/Markdown 阅读器 + 阅读助手 / 翻译助手 / 快速解释 + 对话模式 / 学习记忆 / 记忆管理。

所有模型请求只走一条链：

```text
Vue 3 前端（Qt WebEngine 里的页面）
      │  本机 HTTP（127.0.0.1 随机端口，X-Kaizhi-Token 鉴权）
      ▼
Python 本机服务（aiohttp + SQLite；PySide6 负责窗口/原生对话框）
      │  WebSocket 通道 + 子进程 stdio
      ▼
DeepSeek Harness（Node.js 子进程，harness/）
      │  HTTPS
      ▼
用户自己配置的模型服务商（Chat Completions / Responses / Anthropic Messages）
```

- 后端**只监听 IPv4 回环地址**，每次启动生成随机令牌；令牌只放在页面 URL 的 `#fragment` 里一次，页面随后存进 `sessionStorage`。
- 书库、设置、凭据、学习记忆、对话模式记录都只在**本机**；凭据可用 Windows DPAPI 加密。
- 前端是「单页应用 + 多个整页视图」：文档库 / 阅读工作区 / 对话模式 / 记忆管理，由 `App.vue` 里的 `page` 状态机切换。

---

## 2. 顶层目录

```text
阅迁星穹/
├─ Start.cmd                 源码环境一键启动（建 .venv、装依赖、构建并启动）
├─ README.md                 项目说明、能力、目录、数据与隐私、更新发布流程
├─ USAGE.md                  用户使用手册（功能、快捷键、数据备份、FAQ）
├─ LICENSE                   MIT
├─ THIRD_PARTY_NOTICES.md    第三方组件与字体授权说明
├─ .gitattributes/.gitignore 换行与生成物忽略规则
├─ backend/                  Python 本机服务（窗口、HTTP/WS、SQLite、Word、更新、Harness 进程）
├─ frontend/                 Vue 3 + TypeScript 前端（Vite 构建）
├─ harness/                  Node 模型运行时（独立 npm 工程，打进安装包）
├─ scripts/                  Windows 打包（PyInstaller 冻结 + NSIS 安装包）与图标/版本资源生成
└─ docs/                     开发交接文档与 README 截图
```

生成物（不入库）：`frontend/node_modules`、`harness/node_modules`、`frontend/dist`、`harness/dist`、`.venv`、`build/`、`dist/`、`*.spec`。

---

## 3. backend/（Python 本机服务）

### 3.1 入口与包

| 文件 | 作用 |
| --- | --- |
| `backend/__init__.py` | 包声明与**唯一版本号** `VERSION`；打包脚本、EXE 版本信息、更新器都读这里。 |
| `backend/main.py` | 进程入口：解析 `--data-dir` / `--smoke` / `--harness-smoke` / `--office`；源码运行与打包后的 EXE 共用。 |
| `backend/requirements.txt` | Python 依赖：aiohttp、PySide6（Qt/WebEngine/PDF）、pywin32、packaging。 |

### 3.2 api/（本机接口层）

| 文件 | 作用 |
| --- | --- |
| `backend/api/__init__.py` | 包说明。 |
| `backend/api/server.py` | 一个桌面实例一个回环监听器：Host/Origin/令牌校验、`POST /api/{cmd}` 命令分派、`/events` WebSocket 事件通道、`/` 静态文件（`frontend/dist`）服务。命令按 GUI / DATA / AI / UPDATE 四类映射到对应服务对象。 |

### 3.3 core/（桌面外壳与 Windows 能力）

| 文件 | 作用 |
| --- | --- |
| `backend/core/__init__.py` | 包说明。 |
| `backend/core/desktop.py` | Qt 应用与窗口；创建 WebEngine 视图、加载本机 URL、拖放文件、原生文件对话框（`Gui` 回调）、`--smoke` 下的自动探针。 |
| `backend/core/windows.py` | Windows 平台能力：DPAPI 凭据加解密、子进程作业对象（保证 Harness/Office 子进程随父进程退出）、文件/窗口相关辅助。 |

### 3.4 runtime/（模型运行时）

| 文件 | 作用 |
| --- | --- |
| `backend/runtime/__init__.py` | 包说明。 |
| `backend/runtime/harness.py` | 管理 DeepSeek Harness 的 Node 子进程：启动、复用、并发上限（8）、请求转发、取消、超时（600s）、token 用量回传。 |

### 3.5 services/（业务服务）

| 文件 | 作用 |
| --- | --- |
| `backend/services/__init__.py` | 包说明。 |
| `backend/services/library.py` | 文档库 SQLite（保持旧 schema 与前端字段名）：文档条目、设置键、索引、导入/移除、备份/恢复、设置读取（含 1 MiB 上限）。 |
| `backend/services/word.py` | Word（.doc/.docx）→ PDF：依次尝试本机 Word、WPS、LibreOffice；带超时、临时目录、缓存与错误分类。 |
| `backend/services/updates.py` | 应用更新：读取 GitHub Release（只认 `vX.Y.Z`）、校验 SHA-256 摘要、下载、静默安装/便携版替换、打开页面。 |

### 3.6 scripts/（自检脚本）

| 文件 | 作用 |
| --- | --- |
| `backend/scripts/__init__.py` | 包说明。 |
| `backend/scripts/pdf_smoke.py` | `--smoke`：在临时书库导入合成 PDF，走真实 PDF 导入、worker、画布与文字层探针。 |
| `backend/scripts/harness_smoke.py` | `--harness-smoke`：用回环 mock 模型验证 Harness 子进程、事件流、取消与工具回传。 |

### 3.7 tests/（后端单测）

| 文件 | 作用 |
| --- | --- |
| `backend/tests/__init__.py` | 包声明。 |
| `backend/tests/test_backend.py` | 书库/接口/设置/备份恢复/更新选择等核心逻辑。 |
| `backend/tests/test_harness.py` | Harness 子进程：三种协议、取消、工具、图片引用、脱敏与不回落。 |
| `backend/tests/test_import_feedback.py` | 导入进度、Word 失败原因与建议、阶段回报。 |
| `backend/tests/test_desktop_entry.py` | 桌面入口：延迟偏好、无令牌页面提示、原生画布与主题。 |
| `backend/tests/test_word_integration.py` | 真实 Office 转换集成测试（无 Word/WPS/LibreOffice 时跳过）。 |

---

## 4. frontend/（Vue 3 前端）

### 4.1 根与构建

| 文件 | 作用 |
| --- | --- |
| `frontend/index.html` | Vite 入口 HTML（内含首屏内联样式，避免启动闪烁）。 |
| `frontend/package.json` | 前端工程与依赖、脚本：`build`、`test`、`desktop:dev`、`desktop:build`。 |
| `frontend/package-lock.json` | 依赖锁定。 |
| `frontend/vite.config.ts` | Vite 配置：Vue 插件、资源与构建输出（含 PDF worker 等）。 |
| `frontend/tsconfig.json` | TypeScript 严格配置；允许 `.ts` 扩展名导入（Node 直接跑单测依赖此约定）。 |
| `frontend/app-icon.svg` | 应用图标的矢量源。 |
| `frontend/scripts/prepare-assets.mjs` | 构建前把 PDF.js/字体等离线资源拷进 `public/vendor`。 |
| `frontend/scripts/python-desktop.mjs` | `desktop:dev`：构建/启动 Python 桌面外壳的开发辅助脚本。 |
| `frontend/public/` | 静态资源：`app.ico`、`favicon.svg`、`samples/sample.pdf`、`samples/welcome.md`。 |

### 4.2 入口与外壳

| 文件 | 作用 |
| --- | --- |
| `frontend/src/main.ts` | 页面入口：判断是否在桌面壳内，决定加载 `desktop-app.ts` 还是显示「请用桌面程序打开」提示。 |
| `frontend/src/desktop-app.ts` | 桌面版启动：先读设置，再挂载 `App.vue`，安装液态玻璃、工具提示、折射、玻璃动效等全局插件。 |
| `frontend/src/env.d.ts` | Vite / Vue SFC 全局类型声明。 |
| `frontend/src/App.vue` | 外壳与唯一主状态机：文档库/阅读工作区/对话模式/记忆管理；侧栏、顶栏、标签页、导入、右键菜单、快捷键、全局弹窗、引擎启停与事件接线。约 1900 行，是全项目最核心的文件。 |
| `frontend/src/styles.css` | 全局样式：布局、侧栏/顶栏/文档库、按钮与弹窗、整页视图、响应式断点等（约 4250 行）。 |

### 4.3 src/ai/（模型调用与 AI 功能底座）

| 文件 | 作用 |
| --- | --- |
| `frontend/src/ai/providers.mjs` | 服务商/协议/模型列表；`READER_SYSTEM` 默认 system 前缀；`harnessRequest()` 组装请求；`streamChat()` 入口。 |
| `frontend/src/ai/harness.mjs` | 前端 → Python 的 Harness 调用封装（`ai_start`/`ai_cancel`、流式事件）。 |
| `frontend/src/ai/settings.mjs` | AI 设置与预设：三种（1.1.0 起四种）用途的预设选择、记忆管理预设/强度、归一化、持久化、凭据槽位。 |
| `frontend/src/ai/presets.ts` | 预设的界面显示：标题、说明、模型列表、思考强度名称与回退。 |
| `frontend/src/ai/connection.mjs` | 「测试连接」「获取模型列表」等连接类请求。 |
| `frontend/src/ai/complete.ts` | 单次、非流式模型调用（快速解释、翻译、记忆总结等一次性任务范式）；支持传入 `extraInstructions` 附加记忆。 |
| `frontend/src/ai/workspace.ts` | 阅读助手的工作区状态：多文档/多会话、消息流、发送/停止/重试、分块持久化、上下文裁剪、用量；请求前按当前文档注入学习记忆。 |
| `frontend/src/ai/document-chat.mjs` | 文档问答工具契约（读取当前 PDF、检索、引用）、`streamDocumentChat`、`boundedHistory`；工具规划与最终回答共用注入内容。 |
| `frontend/src/ai/translate.ts` | 翻译助手：翻译请求、流式结果、最近译文与独立模型选择；读取当前文档/全局记忆，记忆变化会让译文缓存失效。 |
| `frontend/src/ai/explain.ts` | 快速解释卡片的状态与请求；读取记忆调整解释深度。 |
| `frontend/src/ai/predict.ts` | 后台「问题预判」小请求：超时、取消、缓存；读取该书记忆来猜下一个问题。 |
| `frontend/src/ai/memory-context.ts` | 记忆注入的统一入口：优先当前文档记忆，没有可注入内容时退回全局记忆；记忆模块异常时静默返回空串；并登记 App 当前的阅读文档。 |
| `frontend/src/ai/greeting.ts` | 阅读助手空态问候、输入框占位语、思考动词（按种子随机、同一会话内稳定）。 |
| `frontend/src/ai/render.ts` | Markdown 渲染：KaTeX 公式、代码高亮、表格/代码块复制按钮、mermaid 图示（`renderDiagrams`）。 |
| `frontend/src/ai/highlight.ts` | 代码语法高亮（highlight.js 常用语言集合）。 |
| `frontend/src/ai/intelligent-ui.ts` | 回答里的 ` ```ui ` 交互块渲染与回传。 |
| `frontend/src/ai/usage.ts` | 用量账本：按 kind/model 汇总、按天持久化；1.1.0 新增 `chatmode`/`memory`。 |
| `frontend/src/ai/request-scheduler.mjs` | 全应用请求队列（并发、排队、取消）；只放调度元数据。 |
| `frontend/src/ai/storage-codec.mjs` | 大设置值的 UTF-8 分块与拼回（SQLite 设置值有上限）。 |

### 4.4 src/chat/（对话模式，1.1.0 新增）

| 文件 | 作用 |
| --- | --- |
| `frontend/src/chat/types.ts` | 对话模式类型与上限：会话、消息、记忆范围标记、模型选择、索引、`CHAT_LIMITS`。 |
| `frontend/src/chat/history.ts` | 历史裁剪（最后一条必留、最多 12 条/40000 字、首条助手消息去掉）、`wireMessages`、标题生成。 |
| `frontend/src/chat/choice.ts` | 对话模式自己的模型选择：localStorage 存取、连接指纹校验、按预设/模型/强度解析与回退。 |
| `frontend/src/chat/storage.ts` | 会话持久化：清单键 + 每会话键、结构归一化、落库前截断（正文 60000/思考 4000/60 条）、超 900 KiB 先丢思考再成对丢旧消息、40 段上限、冻结。 |
| `frontend/src/chat/state.ts` | 对话状态：加载/新建/切换/删除会话，发送/停止/重新生成，校验（16000 字、60 条、150000 字、2 路并发），取记忆注入、发 `chat-turn` 学习事件、记用量、500ms 防抖落库。 |
| `frontend/src/chat/index.ts` | 默认实例装配：接真实 `library` 存储、懒加载 `streamChat`、用量、事件总线、storage-gate；导出 `chat`、`chatBusy`。 |

### 4.5 src/memory/（学习记忆与记忆管理，1.1.0 新增）

| 文件 | 作用 |
| --- | --- |
| `frontend/src/memory/types.ts` | 记忆核心类型与全部上限/存储键：文档记忆、全局记忆、索引、设置、事件、证据、手动约束、范围、注入用途。 |
| `frontend/src/memory/normalize.ts` | 所有记忆数据的归一化与损坏兜底（字段截断、版本/键校验、字节守卫、空记忆工厂）。 |
| `frontend/src/memory/events.ts` | 学习事件总线：`LearningEvent` 六类、同步分发、200 条暂存、异常隔离。 |
| `frontend/src/memory/prompts.ts` | 两份总结系统提示词全文、文档/全局输入构造（白名单 + 长度上限）、JSON 解析与校验、各入口注入模板与用途化「使用要求」、自评文案、相对时间。 |
| `frontend/src/memory/merge.ts` | 合并规则：事件并入、导入自评幂等、总结合并（锁定/置顶/屏蔽）、手动编辑 patch、删条目/证据、解锁、失败退避状态、索引条目。 |
| `frontend/src/memory/scheduler.ts` | 自动更新的触发规则与全部护栏常量（防抖/冷却/间隔/每日上限/补跑/退避/熔断/超时）。 |
| `frontend/src/memory/store.ts` | 记忆键读写：每键串行链、可冻结、900 KiB 守卫、1 MiB 后备、文档 `newer` 版本保护。 |
| `frontend/src/memory/summarize.ts` | 记忆总结的真实模型调用：取「记忆管理」预设、超时/输出上限、用量记 `memory`、设置区只读配置视图。 |
| `frontend/src/memory/engine.ts` | 记忆引擎：收事件、守卫判断、模型总结、失败退避、索引重建/孤儿修剪、手动操作、注入、启停与冻结恢复。 |
| `frontend/src/memory/index.ts` | 默认实例装配：接 `library`/保存失败提示/storage-gate/模型调用；导出 `memoryState` 与页面所需 API。 |

### 4.6 src/components/（界面组件）

#### assistant/ 阅读助手与通用 AI 组件

| 文件 | 作用 |
| --- | --- |
| `AiPane.vue` | 阅读助手面板（约 1400 行）：消息渲染、引用跳转、输入栏、模型按钮、历史、停止/重试、多会话。 |
| `assistant-glyphs.ts` | 阅读助手图标/字形数据。 |
| `AssistantMark.vue` | 助手空态「印记」：内置字形或用户自定义图片。 |
| `CaptureQuickPrompt.vue` | 框选 PDF 区域后的快捷提问卡片。 |
| `ClaudeBurst.vue` | 助手工作时的星芒动画。 |
| `ExplainBody.vue` | 快速解释卡片正文（Markdown/公式/引用）。 |
| `ExplainCard.vue` | 快速解释卡片外壳与定位。 |
| `ExplainNote.vue` | 解释卡片的「记下来」便签。 |
| `ModelPicker.vue` | 模型/思考强度选择抽屉（阅读助手、翻译、对话模式共用）。 |
| `UsagePanel.vue` | 用量面板：按模型/类型汇总、今日、上下文估算。 |

#### chat/ 对话模式页面组件

| 文件 | 作用 |
| --- | --- |
| `ChatModePage.vue` | 对话模式整页：加载/切换会话、记忆范围状态、发送/停止/重新生成、历史与删除确认；记忆范围选择器在输入栏（scope 槽位）。 |
| `MemoryScopePicker.vue` | 记忆范围选择弹层（不使用/全局/某本书 + 搜索）；在输入栏内向上展开。 |
| `ChatHistoryPanel.vue` | 对话历史与「新对话」：列表、范围标记、删除入口。 |
| `ChatMessageList.vue` | 消息列表：空态/无预设空态、思考折叠、Markdown 回答、停止/失败标记、复制/重新生成、自动滚动。 |
| `ChatComposer.vue` | 输入栏：Enter/Shift+Enter、字数与禁用、用量、记忆范围槽位（scope）、模型按钮抽屉、停止/发送、隐私说明。 |

#### memory/ 记忆管理页面组件

| 文件 | 作用 |
| --- | --- |
| `MemoryPage.vue` | 记忆页壳：两个标签页、设置区、列表/详情/编辑、放弃修改确认、清空确认、引擎调用。 |
| `MemorySettingsCard.vue` | 记忆设置区：开关、预设只读、状态行、暂停/重试/停止/恢复、每日计数、隐私说明。 |
| `GlobalMemoryPanel.vue` | 全局记忆：状态、综述/画像/主题/来源/待总结/证据、重新总结/编辑/清空。 |
| `DocumentMemoryList.vue` | 文档记忆列表：搜索、全部/有记忆/未初始化筛选、排序、方向键。 |
| `DocumentMemoryDetail.vue` | 文档记忆详情：未初始化补建、导入自评、综述/画像/问题/阅读行为/证据、编辑/清空/使用。 |
| `MemoryEditForm.vue` | 文档/全局共用的编辑表单（综述、水平、数组、自评），内部用 `diffEdit` 只提交改动。 |
| `MemoryChips.vue` | 可置顶/可删除的条目组。 |
| `OnboardingFields.vue` | 两道四档自评 + 一句话补充（导入弹窗与记忆页共用）。 |

#### layout/ 外壳布局组件

| 文件 | 作用 |
| --- | --- |
| `ClockChip.vue` | 侧栏时钟/计时器/闹钟；展开时用鼓轮选择时间。 |
| `WheelColumn.vue` | 一列可拖动/滚轮/方向键的鼓轮（给 ClockChip 选时/分/秒）。 |
| `ContextMenu.vue` | 通用右键菜单渲染与键盘导航。 |
| `FileTabs.vue` | 阅读标签条：切换/关闭/拖拽换位/右键菜单。 |
| `ManifoldDoodle.vue` | 暖色/铅笔草稿背景上的流形、神经网络、生物物理算法线稿动画。 |

#### library/、reader/、settings/、translate/、ui/、markdown/

| 文件 | 作用 |
| --- | --- |
| `library/ImportDialog.vue` | 「加入文档」弹窗：拖放/选择、逐份进度、学习模式区块与校验。 |
| `reader/PdfReader.vue` | PDF 阅读器：连续滚动、目录、搜索、框选、标记、并排布局入口。 |
| `reader/MarkdownReader.vue` | Markdown 阅读器：渲染、搜索、框选转截图、标记。 |
| `reader/ReaderSearch.vue` | 文档内搜索栏与结果列表。 |
| `reader/SplitPicker.vue` | 并排阅读选择器（最多三份）。 |
| `reader/BookmarkRail.vue` | 右侧书签细条与跳转/重命名/删除。 |
| `reader/ink/InkButton.vue` | 标记工具按钮。 |
| `reader/ink/InkIcon.vue` | 标记工具图标。 |
| `reader/ink/InkPalette.vue` | 标记颜色/粗细面板。 |
| `settings/SettingsDialog.vue` | 设置窗口：外观/阅读/快捷键/AI/更新/文档库六页、保存与备份恢复。 |
| `settings/AiSettings.vue` | 设置 → AI：预设列表、编辑弹窗、「各处默认预设」四行（含记忆管理与思考强度）。 |
| `settings/UpdateCard.vue` | 关于页更新卡片：检查/下载/安装/跳过版本。 |
| `settings/UpdateSettings.vue` | 更新设置行（自动检查开关）。 |
| `translate/TranslatePane.vue` | 翻译助手面板：语言、输入、结果、模型按钮、翻译模式。 |
| `translate/SelectionTranslation.vue` | 选中即译的浮层。 |
| `ui/AppIcon.vue` | 全应用线性图标集（按 name 渲染 SVG path）。 |
| `ui/ConfirmDialog.vue` | 通用危险操作确认框（焦点/ESC/遮罩/Tab 循环）。 |
| `ui/MarkdownAnswer.vue` | 流式 Markdown 回答渲染（90ms 节流、图示、代码复制）；样式与 `AiPane` 的 `.answer-body` 同源。 |
| `markdown/markdown-cjk.ts` | Markdown 中文排版扩展（中文强调等）。 |
| `markdown/markdown-github.ts` | GitHub 风格 Markdown 扩展（表格/任务列表/删除线等）。 |
| `markdown/markdown-math.ts` | KaTeX 公式扩展。 |

### 4.7 src/document/（文档服务与会话）

| 文件 | 作用 |
| --- | --- |
| `ai-context.mjs` | 一次进行中的提问所独占的源文档上下文（AI 提问期间文档不被关闭/替换）。 |
| `map-compat.mjs` | 给旧 Qt WebEngine 补 Map/WeakMap 方法（PDF.js 6 需要）。 |
| `markdown-service.mjs` | Markdown 文档服务：读取、块解析、搜索、渲染数据。 |
| `passwords.mjs` | 加密文档的密码：只在文档标签打开期间留在内存。 |
| `pdf-engine.ts` | PDF.js 6 引擎装配（worker、字体、兼容垫片）。 |
| `pdf-worker.ts` | PDF.js worker 入口。 |
| `session.mjs` | 文档会话：打开/关闭、页码与进度、渲染图片、与 AI 上下文生命周期绑定。 |

### 4.8 src/reader/（PDF 渲染、搜索、选区、标记）

| 文件 | 作用 |
| --- | --- |
| `continuous.mjs` | 连续滚动阅读的页面外壳策略（旧版每页渲染缓冲）。 |
| `core/continuous.mjs` | 连续滚动核心：页面壳、原生滚动、按需挂载渲染页。 |
| `core/document-service.mjs` | 文档服务：打开、渲染页、验证/执行 AI 工具调用（读取当前 PDF）。 |
| `core/geometry.mjs` | PDF viewport、选区、截图裁剪的几何计算。 |
| `core/scroll-layout.mjs` | 连续滚动布局（页间距、并排/缩放后的重排）。 |
| `core/selection.mjs` | 文字选区覆盖层与指针事件。 |
| `core/text-index.mjs` | 文本索引与规范化（NFKC、断词连字）。 |
| `cache-policy.mjs` | 阅读器缓存淘汰策略（保留当前文档）。 |
| `crop.ts` | 框选截图：在 worker/离屏画布编码 PNG，避免卡主线程。 |
| `dark-pages.mjs` | 深色主题下的 PDF 反相滤镜（文字/线条色调曲线）。 |
| `hscroll.ts` | 横向滚动/宽页面适配。 |
| `layout.mjs` | 阅读区的 padding 与可用宽度计算。 |
| `markdown-capture.ts` | 框选 Markdown 区域：原文（公式取 LaTeX）+ 截图。 |
| `markdown-search.ts` | 只搜 Markdown 可见文本（排除 KaTeX 隐藏 MathML）。 |
| `search.mjs` | 纯文本搜索与原文偏移映射（Unicode 规范化后仍能定位）。 |
| `selection-image.ts` | 把选区/元素渲染成截图数据。 |
| `text-selection.ts` | PDF 跨页文本选区与高亮。 |
| `ink/ink.css` | 手写标记层样式。 |
| `ink/layers.ts` | 每页挂 SVG 标记层并管理坐标。 |
| `ink/model.ts` | 标记数据模型：纯几何、存储格式、命中测试。 |
| `ink/store.ts` | 每本文档一份共享的标记存储（并排/多窗口共用、持久化）。 |
| `ink/use-ink.ts` | 标记的 Vue 胶水：模式、工具、持久化、快捷键。 |

### 4.9 src/library/（文档库数据）

| 文件 | 作用 |
| --- | --- |
| `kinds.ts` | 文档类型判断（PDF/Markdown/Word 转成 PDF 后）、标题与图标。 |
| `importer.ts` | 加入文档队列：状态、Word 阶段、失败原因、`enqueue`、`runQueue`；1.1.0 新增学习模式状态与答案 API。 |
| `covers.ts` | 封面：首页预览/自定义图片/默认图标。 |
| `groups.ts` | 分组：创建/改名/删除/分配。 |
| `bookmarks.ts` | 书签数据：增删改查与持久化。 |
| `bookmark-nav.ts` | 按书内位置查找上一个/下一个书签。 |

### 4.10 src/sdk/（前端 ↔ 本机服务通道）

| 文件 | 作用 |
| --- | --- |
| `python.ts` | 底层命令调用、令牌、WebSocket 事件通道、`Channel`、原生打开文件/窗口能力。 |
| `index.ts` | 业务化 RPC：`library.*`、`importDocument`、`selectDocuments`、备份/恢复等。 |
| `types.ts` | `Doc`、`Library` 等与后端字段一致的接口类型。 |
| `updater.ts` | 运行版本、是否可自更新、更新相关 RPC。 |

### 4.11 src/settings/（偏好设置）

| 文件 | 作用 |
| --- | --- |
| `model.ts` | 偏好设置模型：默认值、归一化、主题/外观/字体/快捷键等类型。 |
| `index.ts` | 设置的响应式状态、加载/保存、外观预览与 `useSettings()`。 |
| `background.ts` | 背景图/图库的类型与读取。 |
| `quick-prompts.ts` | 阅读助手快捷提问的默认项与上限。 |

### 4.12 src/shared/（前后端共享契约）

| 文件 | 作用 |
| --- | --- |
| `document-limits.mjs` | 文档数量/字节等用户预算与传输上限。 |
| `document-tools.mjs` | AI 文档工具的共享只读契约（绑定一本已打开的 PDF）。 |
| `provider-config.mjs` | 默认服务商/接口地址/协议等默认连接配置。 |
| `request-queue.mjs` | 请求队列共享配置与归一化。 |
| `storage-gate.ts` | 备份前 flush、恢复前 freeze/unfreeze 的参与者注册表（记忆/对话模式接入）。 |

### 4.13 src/sketch/（铅笔草稿背景动画）

| 文件 | 作用 |
| --- | --- |
| `manifolds.ts` | 流形的参数化线框（多种曲面/纤维化）。 |
| `networks.ts` | 神经网络架构的线稿动画。 |
| `scenes.ts` | 生物/物理/群论/算法等其它草稿画面。 |
| `scene-worker.ts` | 重绘开销大的场景放 Worker（GB300 等）。 |

### 4.14 src/ui/（界面工具库）

| 文件 | 作用 |
| --- | --- |
| `custom-fonts.ts` | 用户导入字体的注册与持久化。 |
| `font-names.ts` | 从字体文件名猜 family/weight/style。 |
| `fullscreen.ts` | 全屏状态与切换。 |
| `glass-contrast.ts` | 液态玻璃可读性：墨色、最小不透明度、照片色调、文字光晕。 |
| `glass-motion.ts` | 玻璃后有运动时控制折射刷新。 |
| `liquid-glass.ts` | 液态玻璃渲染安装（折射/高光等）。 |
| `liquid-selection.ts` | 选中指示器（liquid selection）指令。 |
| `marquee.ts` | 一行放不下的文字悬停跑马灯。 |
| `panel-transition.ts` | 面板收起时保留过渡位置。 |
| `refraction.ts` | 折射透镜效果安装。 |
| `reorder.ts` | iOS 主屏式拖动排序。 |
| `rubber-band.ts` | 空白处拖框多选。 |
| `save-errors.ts` | 右下角「未保存/重试」提示栈。 |
| `timer.ts` | 秒表/倒计时/闹钟计时逻辑。 |
| `tooltip.ts` | 全局 `data-tip` 工具提示。 |
| `updater.ts` | 更新检查的界面侧调度（实际下载/安装在后端）。 |
| `update-select.ts` | 更新版本/资源的界面选择辅助（校验在后端）。 |

### 4.15 src/styles/ 与 src/assets/

| 文件 | 作用 |
| --- | --- |
| `styles/tokens.css` | 设计令牌：颜色、圆角、阴影、动效时长等。 |
| `styles/themes.css` | 四种外观（液态玻璃/新液态玻璃/暖色极简/铅笔草稿）与深浅色变量；整页视图变量。 |
| `styles/crystal.css` | 「新液态玻璃」材质配方。 |
| `styles/liquid-glass.css` | 液态玻璃组件材质与折射相关样式。 |
| `styles/motion.css` | 过渡/动画（含整页 `view` 切换）。 |
| `styles/backdrops.css` | 背景底板/图库样式。 |
| `styles/fonts.css` | 内置字体与文本字体栈。 |
| `styles/select.css` | 原生 select 的统一样式。 |
| `styles/intelligent-ui.css` | 回答里 ` ```ui ` 交互块样式。 |
| `assets/fonts/*.woff2` | 内置字体：AnthropicSerif（界面/回答衬线）、Caveat、LongCang、MaShanZheng、PatrickHand、ZCOOLKuaiLe、ZCOOLXiaoWei 等；`OFL.txt` 为其授权说明。 |
| `assets/capture-cursor.svg` | 框选工具光标。 |
| `assets/smoky-veins.svg`、`white-ripples.svg` | 背景装饰纹理。 |

### 4.16 tests/

#### 单元测试（`frontend/tests/unit/`，43 个文件，`npm test` 运行）

| 文件 | 作用 |
| --- | --- |
| `memory-presets.test.mjs` | 记忆管理预设/强度的归一化、回退、memorySettings。 |
| `memory-normalize.test.mjs` | 记忆数据归一化与损坏兜底。 |
| `memory-events.test.mjs` | 学习事件分发/暂存/异常隔离。 |
| `memory-prompts.test.mjs` | 提示词输入构造、JSON 解析、校验、注入模板。 |
| `memory-merge.test.mjs` | 事件并入、总结合并、手动编辑、删除、失败退避。 |
| `memory-scheduler.test.mjs` | 自动更新触发规则与护栏常量。 |
| `memory-store.test.mjs` | 记忆键读写：串行、冻结、超限、损坏、版本。 |
| `memory-engine.test.mjs` | 引擎端到端（假存储/假模型/手动时钟）：自动/手动总结、失败、取消、冻结、清理、重建、注入用途。 |
| `memory-surfaces.test.mjs` | 源码契约扫描：阅读助手/翻译/解释/预判/文档工具都接记忆读取、记忆范围按钮在输入栏。 |
| `chat-mode.test.mjs` | 历史裁剪、模型选择、会话归一化/截断/上限、冻结。 |
| `chat-state.test.mjs` | 对话状态机：发送/停止/重新生成/并发/损坏/删除/用量/事件。 |
| `import-learning.test.mjs` | 学习模式状态、答案随队列、回调、开关持久化。 |
| `system-prefix.test.mjs` | `READER_SYSTEM` 默认前缀与 `systemPrefix` 覆盖。 |
| `presets.test.mjs` | AI 预设全链路（含记忆字段兼容）。 |
| `settings.test.mjs` | 偏好设置模型、快捷键、外观。 |
| `ai-document.test.mjs` | 文档工具/上下文/检索契约。 |
| `document-search.test.mjs` | PDF 文本搜索与偏移映射。 |
| `connection.test.mjs` | 连接测试/模型列表。 |
| `background.test.mjs` | 背景图库与安全校验。 |
| `glass-contrast.test.mjs` | 玻璃可读性计算。 |
| `ink.test.mjs` | 手写标记几何/存储/命中。 |
| `map-compat.test.mjs` | 旧 WebEngine Map 兼容垫片。 |
| `markdown-github.test.mjs` | GitHub 风格 Markdown 扩展。 |
| `import-queue.test.mjs` | 加入文档队列与去重/校验。 |
| `request-scheduler.test.mjs` | 请求队列并发/取消。 |
| `save-errors.test.mjs` | 未保存提示栈与重试。 |
| `storage-codec.test.mjs` | 分块编码/解码。 |
| `update-select.test.mjs` | 更新版本选择规则（与后端一致）。 |
| `word-kinds.test.mjs` | Word 文档类型与阅读方式。 |
| `reader-cache.test.mjs`、`reader-cache-policy.test.mjs` | 阅读器缓存与淘汰策略。 |
| `reader-layout.test.mjs` | 阅读布局/宽度计算。 |
| `r6-helpers.test.mjs` | 历史需求回归：通用辅助函数。 |
| `r7-reading.test.mjs` | 历史需求回归：阅读体验与组件扫描。 |
| `r8-glass.test.mjs` | 历史需求回归：玻璃样式约束。 |
| `r10.test.mjs` | 历史需求回归：阅读器交互。 |
| `r12-capture.test.mjs` | 历史需求回归：框选截图与 `READER_SYSTEM` 源码断言。 |
| `r13-spread.test.mjs` | 历史需求回归：并排阅读。 |
| `r14-styles.test.mjs` | 历史需求回归：样式与外观约束。 |
| `r15-manifold.test.mjs` | 历史需求回归：流形背景。 |
| `r16-select.test.mjs` | 历史需求回归：选择框选。 |
| `r17-features.test.mjs`、`r18-features.test.mjs` | 历史需求回归：功能清单。 |

#### 组件模拟测试（`frontend/tests/sim/`，不在 `npm test` 内，需临时安装 vitest/@vue/test-utils/happy-dom 后运行）

| 文件 | 作用 |
| --- | --- |
| `ai-pane.spec.ts` | 阅读助手面板的组件级交互模拟。 |
| `presets-ui.spec.ts` | 设置 → AI 预设界面（含「记忆管理」行与四种用途文案）。 |
| `translate-pane.spec.ts` | 翻译助手面板模拟。 |

---

## 5. harness/（Node 模型运行时）

| 文件 | 作用 |
| --- | --- |
| `harness/package.json` | 独立 npm 工程：依赖 DeepSeek Harness 适配器与 esbuild；`engines.node >=22.19`。 |
| `harness/package-lock.json` | 依赖锁定。 |
| `harness/build.mjs` | 用 esbuild 把运行时/worker 打成 `harness/dist`（随安装包分发）。 |
| `harness/runtime.mjs` | Harness 运行时入口：读取 Python 传来的请求、选适配器、流式转发、工具回传、取消。 |
| `harness/worker.mjs` | 模型请求 worker（被 runtime 调用）。 |
| `harness/licenses/node-v26.13.0.txt` | 随包分发的 Node 许可文本。 |

## 6. scripts/（打包）

| 文件 | 作用 |
| --- | --- |
| `scripts/build-windows.ps1` | Windows 发布构建总入口：`-Test` 跑测试与打包后冒烟；`-Installer` 生成 NSIS 安装包；`-Release` 生成 `dist/release` 三件套（setup.exe、portable.zip、SHA256SUMS.txt）。 |
| `scripts/freeze.ps1` | 调用 PyInstaller 冻结 Python + 前端 dist + harness dist。 |
| `scripts/installer.nsi` | NSIS 安装包脚本（升级覆盖、运行时目录所有权标记）。 |
| `scripts/make-icon.py` | 由 `frontend/app-icon.svg` 生成 `app.ico`。 |
| `scripts/make-version-info.py` | 由 `VERSION` 生成 PyInstaller 的版本资源。 |
| `Start.cmd` | 源码环境一键启动：建 `.venv`、装依赖、构建前端/harness、启动桌面程序。 |

## 7. docs/ 与顶层文档

| 文件 | 作用 |
| --- | --- |
| `docs/HANDOFF.md` | 开发交接：版本状态、发布流程、1.1.0 模块/存储键/护栏/基线/已知限制。 |
| `docs/images/*.jpg` | README 截图：加入文档、文档库、阅读助手、导入转换。 |
| `README.md` | 项目说明：能力、架构、目录、启动、数据隐私、发布流程。 |
| `USAGE.md` | 使用手册：第一次使用、文档库/阅读/助手/对话模式/记忆管理/设置、快捷键、备份、FAQ。 |
| `THIRD_PARTY_NOTICES.md` | 第三方组件/字体授权。 |
| `LICENSE` | MIT。 |

---

## 8. 数据、存储键与护栏（接手必看）

- **数据目录**：默认 `%APPDATA%\com.phydog.reading.python`；可用 `--data-dir` 或 `KAIZHI_DATA_DIR` 覆盖（不要指向正在使用的真实书库）。
  - `library.sqlite3`：文档条目、设置键、索引、封面等。
  - `web/`、`web-cache/`：Qt WebEngine 的 localStorage/缓存（页面偏好、对话模式模型选择等）。
  - `credentials`：DPAPI 加密的 API 凭据。
  - `desktop-port.txt`：本机服务端口（保持 origin 稳定）。
- **SQLite settings 键**（1.1.0 新增粗体）：
  - 既有：文档/设置/对话相关键（保持旧语义不变）。
  - **`memory.v1.index` / `memory.v1.global` / `memory.v1.doc.<docId>` / `memory.v1.settings`**
  - **`chatmode.v1.index` / `chatmode.v1.c.<conversationId>`**
- **localStorage 键**：`paperdesk.ai.settings.v1`（新增 `memoryPreset` / `memoryEffort`）、**`kaizhi.chatmode.choice.v1`**、**`kaizhi.import.learning.v1`**。
- **护栏常量**（`frontend/src/memory/scheduler.ts`）：每 3 轮总结、静默 45s、同书冷却 10min、全局冷却 15min、请求间隔 60s、遗留 30min、每日 40 次、超时 90s、失败退避 5/30min、连续 3 次暂停 30min、输出上限 12000 字。
- **兼容性**：后端 Python 零改动；SQLite `user_version` 仍为 1；`import_documents` 参数未变；未新增 npm/Python 依赖（1.0.5 → 1.1.0）。

## 9. 运行、构建、测试命令

```powershell
# 一键源码启动（自动建 .venv/装依赖/构建/启动）
.\Start.cmd

# 手动启动（源码）
.\.venv\Scripts\python.exe backend\main.py --data-dir D:\work\test-data

# 前端单测 / 构建
npm.cmd --prefix frontend test
npm.cmd --prefix frontend run build

# 后端单测
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -t . -v

# 冒烟
.\.venv\Scripts\python.exe backend\main.py --smoke
.\.venv\Scripts\python.exe backend\main.py --harness-smoke

# 发布构建（PyInstaller + NSIS + 三件套）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-windows.ps1 -Test -Release
```

## 10. 1.1.0 新增功能 → 文件索引

| 功能 | 前端 | 后端/其他 |
| --- | --- | --- |
| 对话模式 | `chat/*`、`components/chat/*`、`components/ui/MarkdownAnswer.vue`、`App.vue`（page 状态机/侧栏/顶栏/引擎启动） | 存储走 `backend/services/library.py` 的设置键；请求走 `backend/runtime/harness.py`。 |
| 记忆管理 | `memory/*`、`components/memory/*`、`components/ui/ConfirmDialog.vue`、`shared/storage-gate.ts`、`App.vue`（同步文档/事件/移除清理） | 无后端改动。 |
| 学习模式 | `library/importer.ts`、`components/library/ImportDialog.vue`、`App.vue`（addPaths） | 无后端改动。 |
| 设置里的记忆管理预设 | `ai/settings.mjs`、`ai/presets.ts`、`components/settings/AiSettings.vue` | — |
| system 前缀可定制 | `ai/providers.mjs`（`READER_SYSTEM` / `systemPrefix`） | — |
| 用量新增两类 | `ai/usage.ts` | — |
| 阅读助手/阅读进度接入记忆 | `ai/workspace.ts`（assistant-turn）、`App.vue`（opened/reading） | — |
| 备份恢复冻结 | `components/settings/SettingsDialog.vue`、`shared/storage-gate.ts`、`memory/index.ts`、`chat/index.ts` | — |

## 11. 维护注意事项与已知坑

1. **文件编码**：仓库里除 `backend/__init__.py`、`frontend/package*.json`、`docs/HANDOFF.md` 外，部分 Windows 脚本（`scripts/build-windows.ps1`、`scripts/installer.nsi`）原本带 UTF-8 BOM，改动时不要随手去掉；反过来，`package.json`/`package-lock.json` **不能带 BOM**（Vite/JSON 解析会失败）。用支持无 BOM 的编辑器保存。
2. **`App.vue` 是最大单文件**（约 1900 行）：改外壳行为时注意 `page`/`active`（阅读器挂起语义）、`withMemory()` 懒加载、`settingsVersion`、引擎启停；模板里多处行号在 `docs/HANDOFF.md` 有记录但可能漂移，按函数/文案搜。
3. **Markdown 样式重复**：`components/ui/MarkdownAnswer.vue` 的 `.markdown-answer` 样式来自 `components/assistant/AiPane.vue` 的 `.answer-body`（约 40 行），两处需要同步。
4. **`.vue` 单测文件扫描约束**：`r7-reading.test.mjs` 会扫描组件源码，禁止 `:global(x) .y` 这类写法；新增组件样式请用 scoped 或普通选择器。
5. **源码文本断言**：`r12-capture.test.mjs` 断言 `providers.mjs` 含「说人话」且不含「清楚区分原文」，改 system 文案时注意。
6. **单测环境**：前端测试直接在 Node 里跑 `.ts`（靠 Node 类型擦除），`import type` 必须单独写；不要用构造函数参数属性/枚举等 Node 无法擦除的语法。
7. **索引/清单损坏**：后端没有列键接口，记忆索引按文档 id 探测重建；对话清单损坏时旧会话键无法找回（最多 40 段）。全局记忆没有 newer 版本标志，跨版本回退有理论覆盖风险。
8. **重启后的全局待总结**：若 `globalStale=false` 且全局 `pending` 非空，调度器不会主动读全局记忆（保持启动只读两个键），下一次全局事件/文档记忆更新会补上。
9. **移除文档**只清理学习记忆；`ai.conversations.v1.<docId>`（阅读助手对话）仍按旧行为保留。
10. **构建环境**：发布需要 `.venv` 内安装 PyInstaller（本次用 6.22.3）与本机 NSIS（`makensis.exe`）；构建脚本会跑 `harness ci`、前端构建、前后端测试、打包后两项冒烟。
11. **网络/凭据**：更新检查访问 GitHub；内网/受限网络下 `/api/update_check` 可能返回 400，应用会静默忽略。Git 推送用的凭据在 `gh` keyring 中，`gh auth setup-git` 配好 credential helper。
12. **不要提交**：`node_modules`、`.venv`、`dist`、`build`、`frontend/dist`、`harness/dist`、`*.sqlite3`、真实书库副本（均在 `.gitignore` 中）。

## 12. 交接检查清单

- [ ] 能按第 9 节命令跑起源码版（临时数据目录）
- [ ] 前端 340 项、后端 32 项测试通过
- [ ] 知道 `backend/__init__.py` 的 `VERSION` 是唯一版本号来源
- [ ] 知道本机服务令牌/端口/静态文件由 `backend/api/server.py` 管
- [ ] 知道 `frontend/src/App.vue` 是导航与接线的中心
- [ ] 知道 1.1.0 新功能的文件边界（第 10 节）
- [ ] 知道数据目录、SQLite 键与 localStorage 键（第 8 节）
- [ ] 改动 `MarkdownAnswer` / `AiPane` 样式时两处同步
- [ ] 打包前先关掉正在运行的阅迁星穹，避免 `dist` 被占用
