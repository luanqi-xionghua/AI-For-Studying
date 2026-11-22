# 阅迁星穹 · 交接文档（目录结构与文件职责）

> 适用版本：**v1.1.5**（`backend/__init__.py` → `VERSION = "1.1.5"`）
> 对应提交：`v1.1.5`（GitHub `luanqi-xionghua/AI-For-Studying` 的 `main`）
> 文档生成：2026-11-20（2026-11-21 随 1.1.5 更新）
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
| `backend/api/server.py` | 一个桌面实例一个回环监听器：Host/Origin/令牌校验、`POST /api/{cmd}` 命令分派、`/events` WebSocket 事件通道、`/` 静态文件（`frontend/dist`）服务。命令按 GUI / DATA / AI / UPDATE / TEMP / MATERIAL 六类映射到对应服务对象（TEMP：`temp_doc_pick/prepare/read/release`；MATERIAL：`material_status/sync/cancel/search/open/clear`）。 |

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
| `backend/services/tempdocs.py`（1.1.1） | 对话模式的临时文档：原生对话框选中的文件登记成不透明句柄（路径只留在后端）、扩展名/大小/文件头/UTF-8 校验、Word 转 PDF、指纹校验、临时目录与清理、固定错误码（`TEMP_*`，永不含路径）。 |
| `backend/services/material_index.py`（资料检索） | 纯函数层：NFKC 与中文二元组分词、三源记录解析与过滤、按「文件名+大小」合并去重、BM25 内存索引、查询解析（课程简称、意图正则）、置信度闸门、文档库匹配、URL 白名单校验。不做 IO。 |
| `backend/services/materials.py`（资料检索） | `Materials` 服务：独立 `materials.sqlite3`、三源同步（超时/重试/重定向白名单/取消/进度）、索引懒加载、六个命令（`material_status/sync/cancel/search/open/clear`）、`webbrowser.open` 开外链。 |

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
| `frontend/src/ai/usage.ts` | 用量账本：按 kind/model 汇总、按天持久化；1.1.0 新增 `chatmode`/`memory`，资料检索新增 `discover`。 |
| `frontend/src/ai/request-scheduler.mjs` | 全应用请求队列（并发、排队、取消）；只放调度元数据。 |
| `frontend/src/ai/storage-codec.mjs` | 大设置值的 UTF-8 分块与拼回（SQLite 设置值有上限）。 |

### 4.4 src/chat/（对话模式，1.1.0 新增；1.1.1 加附件与附属栏）

| 文件 | 作用 |
| --- | --- |
| `frontend/src/chat/types.ts` | 对话模式类型与上限：会话、消息、记忆范围标记、模型选择、索引、`CHAT_LIMITS`；1.1.1 加附件描述符/标记/引用/进度、`CHAT_ATTACH_LIMITS`（6 张 / 8 MB / 3 份文档 / 超时与预算）。 |
| `frontend/src/chat/history.ts` | 历史裁剪（最后一条必留、最多 12 条/40000 字、首条助手消息去掉）、`wireMessages`（历史引用转纯文本、带图旧消息补文字标记）、标题生成。 |
| `frontend/src/chat/choice.ts` | 对话模式自己的模型选择：localStorage 存取、连接指纹校验、按预设/模型/强度解析与回退。 |
| `frontend/src/chat/storage.ts` | 会话持久化：清单键 + 每会话键、结构归一化（附件/标记/引用/`skipped`）、落库前剥运行时字段与临时文档文件名、超 900 KiB 先丢思考再去较早引用再成对丢旧消息、索引读改写串行化、40 段上限、冻结。 |
| `frontend/src/chat/state.ts` | 对话状态：加载/新建/切换/重命名/删除会话，发送/停止/重新生成，校验，取记忆注入、纯文字回合发 `chat-turn`、带附件回合走编排层并按规则跳过写入，记用量、草稿图片与附件运行时状态、500ms 防抖落库（附件改动立即落库）。 |
| `frontend/src/chat/index.ts` | 默认实例装配：接 `library`/`tempDocs` 存储、懒加载 `streamChat`、`compare` 与文档管道、用量、事件总线、storage-gate；导出 `chat`、`chatBusy`。 |
| `frontend/src/chat/memory-rule.ts`（1.1.1） | `learningTargets(scope, hasAttachments)`：带附件一律不写；文档范围写 doc + global；全局只写 global；不使用记忆不写。 |
| `frontend/src/chat/rail.ts`（1.1.1） | 会话附属栏纯逻辑：标题搜索（忽略大小写与空白）、按更新时间倒序且当前空会话置顶、`kaizhi.chatmode.rail.v1` 收起偏好。 |
| `frontend/src/chat/images.ts`（1.1.1） | 图片采集与预算：5 种位图、单文件 ≤20 MiB、6 张 / 8 MB、压缩成长边 ≤1600 的 data URL（复用框选截图管道）。 |
| `frontend/src/chat/attachments.ts`（1.1.1） | 附件规则：三个按钮的可用性与原因、`hasAttachments`、上下文估算、`perDocLimits` 预算表、`friendlyDocError`/`friendlyTempError`（固定文案、永不含路径）、运行时状态文案。 |
| `frontend/src/chat/compare.ts`（1.1.1） | 带附件回合编排：T1 图片一次调用；T2 单本 `streamDocumentChat`；T3 每本证据笔记（并发 2）+ 合成（只有合成带图）；超时、失败隔离、sourceId 冲突重开会话、用量逐条记。 |
| `frontend/src/chat/citations.ts`（1.1.1） | 证据索引与引用：只收集正文引用过的 `[sourceId]`（≤40）、渲染成〔《书名》第 N 页/行〕、「参考原文」分组、历史纯文本化。 |

### 4.5 src/memory/（学习记忆与记忆管理，1.1.0 新增）

| 文件 | 作用 |
| --- | --- |
| `frontend/src/memory/types.ts` | 记忆核心类型与全部上限/存储键：文档记忆、全局记忆、索引、设置、事件、证据、手动约束、范围、注入用途；导入自评含学习目标（goal ≤100 字，必填）与偏好说明（preference ≤200 字，选填）。 |
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
| `ChatModePage.vue` | 对话模式整页：会话附属栏 + 主列布局、加载/切换/重命名/删除会话、记忆范围状态、附件运行时（文档探测、临时上传与转换、失效标记）、图片草稿、发送/停止/重新生成；记忆范围选择器在输入栏（scope 槽位），附件预览在 attachments 槽位，三个附件按钮在 attach 槽位；窄窗口时附属栏转为抽屉。 |
| `MemoryScopePicker.vue` | 记忆范围选择弹层（不使用/全局/某本书 + 搜索）；在输入栏内向上展开。 |
| `ChatConversationRail.vue`（1.1.1） | 会话附属栏：新建、搜索、切换、行内重命名、删除、回答中标记、相对时间刷新、roving tabindex 与 F2/Delete、常驻与抽屉两形态、收起。 |
| `ChatAttachmentBar.vue`（1.1.1） | 附件预览条：文档 chip（标题、临时标签、转换中/已移除/找不到/已失效）、图片缩略图与预算、不识图警示与「移除全部图片」。 |
| `ChatDocumentPicker.vue`（1.1.1） | 文档库多选弹层：搜索、原生复选框、已附加/缺失不可选、剩余额度、添加 N 份、Esc 关闭。 |
| `ChatMessageList.vue` | 消息列表：空态/无预设空态、思考折叠、Markdown 回答、引用渲染与「参考原文」、每本检索进度、用量合计、停止/失败标记、复制/重新生成、自动滚动。 |
| `ChatComposer.vue` | 输入栏：Enter/Shift+Enter、字数与禁用、用量、记忆范围/附件预览/附件按钮三个槽位、图片粘贴与拖入、模型按钮抽屉、停止/发送、隐私说明（有附件时追加）。 |

#### memory/ 记忆管理页面组件

| 文件 | 作用 |
| --- | --- |
| `MemoryPage.vue` | 记忆页壳：两个标签页、设置区、列表/详情/编辑、放弃修改确认、清空确认、引擎调用。 |
| `MemorySettingsCard.vue` | 记忆设置区：开关、预设只读、状态行、暂停/重试/停止/恢复、每日计数、隐私说明。 |
| `GlobalMemoryPanel.vue` | 全局记忆：状态、综述/画像/主题/来源/待总结/证据、重新总结/编辑/清空。 |
| `DocumentMemoryList.vue` | 文档记忆列表：搜索、全部/有记忆/未初始化筛选、排序、方向键。 |
| `DocumentMemoryDetail.vue` | 文档记忆详情：未初始化补建、导入自评（含学习目标/偏好）、综述/画像/问题/阅读行为/证据、编辑/清空/使用。 |
| `MemoryEditForm.vue` | 文档/全局共用的编辑表单（综述、水平、数组、自评），内部用 `diffEdit` 只提交改动。 |
| `MemoryChips.vue` | 可置顶/可删除的条目组。 |
| `OnboardingFields.vue` | 学习模式共用表单：两道四档自评 + 学习目标（必填）+ 学习偏好（选填）+ 一句补充（选填），带字数与聚焦校验。 |

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
| `library/ImportDialog.vue` | 「加入文档」弹窗：拖放/选择、逐份进度、学习模式区块与校验；内容区可滚动，学习模式展开后仍能看到底部问题。 |
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
| `importer.ts` | 加入文档队列：状态、Word 阶段、失败原因、`enqueue`、`runQueue`；1.1.0 新增学习模式状态与答案 API（两道自评 + 学习目标必填 + 偏好/补充选填）。 |
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
| `import-learning.test.mjs` | 学习模式状态、两题 + 学习目标必填校验、答案随队列、回调、开关持久化。 |
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
| `materials-state.test.mjs`（资料检索） | 状态机：未同步、坏的本地存储、空查询、查询竞态、最近搜索、同步进度、连点、取消、写库阶段取消、失败横幅、重排可用性/生效/失败/条数门槛、错误文案、清空。 |
| `materials-rerank.test.mjs`（资料检索） | 候选序列化、提示词、解析与校验（越界/重复/非整数/代码块/去链接）、超时与超长中止、调用参数、可用性判断。 |
| `materials-surfaces.test.mjs`（资料检索） | 源码约束：不直连外网、无 `<a>`/`v-html`、App 接线、通道与用量登记、`complete.ts` 原文保留、`state.ts` 不依赖 sdk/设置/模型、无 `:global(x) .y`。 |

#### 组件模拟测试（`frontend/tests/sim/`，不在 `npm test` 内，需临时安装 vitest/@vue/test-utils/happy-dom 后运行）

| 文件 | 作用 |
| --- | --- |
| `ai-pane.spec.ts` | 阅读助手面板的组件级交互模拟。 |
| `presets-ui.spec.ts` | 设置 → AI 预设界面（含「记忆管理」行与四种用途文案）。 |
| `translate-pane.spec.ts` | 翻译助手面板模拟。 |

---

### 4.17 src/materials/ 与 components/materials/（资料检索）

| 文件 | 作用 |
| --- | --- |
| `frontend/src/materials/types.ts` | 前端契约：状态/结果/进度类型、`MATERIALS_LIMITS`、来源与意图标签、`friendlyMaterialError` 错误码映射、`MaterialsClient` 接口。纯类型与纯函数。 |
| `frontend/src/materials/client.ts` | 六个 `material_*` 命令的 RPC 封装；`sync` 用 `Channel` 只转发 `type==='progress'` 的事件。 |
| `frontend/src/materials/state.ts` | `createMaterialsState(deps)`：响应式状态、`view`/`displayed`/`banner` 派生值、同步与取消、查询竞态（`epoch`）、AI 重排（中止/缓存/降级）、最近搜索持久化。不 import sdk/设置/模型。 |
| `frontend/src/materials/index.ts` | 默认实例装配：真实 client、动态 `import('../ai/materials')` 与 `complete`、`loadAiSettings()`、`localStorage`。 |
| `frontend/src/components/materials/MaterialsPage.vue` | 资料检索整页：页头状态与同步按钮、⋯ 菜单（清空/重新同步/来源说明）、横幅、搜索框、九种视图状态、文档库组与网络资料组、AI 排序开关。 |
| `frontend/src/components/materials/MaterialResultRow.vue` | 单行结果：格式标签、标题按钮、你已有、元信息、AI 理由、主链接与镜像、复制、在文档库打开。 |
| `frontend/src/ai/materials.ts` | 资料检索的 AI 层：`REWRITE_SYSTEM` + `parseRewrite` + `rewriteQuery`（把口语改写成「规范课程名 + 资料类型」，失败抛错由调用方回落到原查询）、`RERANK_SYSTEM`、候选序列化、消息构造、解析校验、`applyRerank`、`rerankMaterials`（超时/超长中止）、`rerankAvailability`。 |
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
  - credentials：DPAPI 加密的 API 凭据。
  - `materials.sqlite3`（资料检索）：三源公开资料目录的缓存，含 `-wal`/`-shm`；损坏时改名 `.corrupt`。不进备份，可随时删除重建。

  - `desktop-port.txt`：本机服务端口（保持 origin 稳定）。
  - `chat-temp/<handle>/`（1.1.1）：临时文档里 Word 转出的 PDF；启动、页面断开、退出、删除会话或移除 chip 时清理，不进备份。
- **SQLite settings 键**（1.1.0 新增粗体）：
  - 既有：文档/设置/对话相关键（保持旧语义不变）。
  - **`memory.v1.index` / `memory.v1.global` / `memory.v1.doc.<docId>` / `memory.v1.settings`**
  - **`chatmode.v1.index` / `chatmode.v1.c.<conversationId>`**（1.1.1 起这两个键的值里可能带 `attachments` / `customTitle` / 消息的 `attach` / `refs` / `skipped`，全部是可选字段，版本号仍为 1）
- **localStorage 键**：`paperdesk.ai.settings.v1`（新增 `memoryPreset` / `memoryEffort`）、**`kaizhi.chatmode.choice.v1`**、**`kaizhi.import.learning.v1`**、**`kaizhi.chatmode.rail.v1`**（1.1.1 会话附属栏收起状态）、**`kaizhi.materials.v1`**（资料检索：最近搜索、AI 排序开关、优先镜像）。
- **护栏常量**（`frontend/src/memory/scheduler.ts`）：每 3 轮总结、静默 45s、同书冷却 10min、全局冷却 15min、请求间隔 60s、遗留 30min、每日 40 次、超时 90s、失败退避 5/30min、连续 3 次暂停 30min、输出上限 12000 字。
- **兼容性**：SQLite `user_version` 仍为 1；`import_documents` 参数未变；未新增 npm/Python 依赖。1.1.1 的后端改动只有新增 `backend/services/tempdocs.py` 与 `server.py` 的 TEMP 命令接线，`library.py` / `word.py` / `desktop.py` / `runtime/harness.py` / `harness/*` 未动。

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

## 模拟测试（1.2.3）

- **前端**：`frontend/src/exam/`（types / slots / validate / scoring / storage / choice / activity / markdown / client / state / index）、`frontend/src/ai/exam.ts`（提示词与 1+4 次调用）、`frontend/src/components/exam/`（ExamPage / ExamSetupPanel / ExamQuestionCard / ExamResultPanel）。
- **后端**：`backend/services/exams.py`（文件名、校验、原子写入、加入文档库）；`backend/api/server.py` 的 `exam_export` 分支与 `self.exams`；`backend/core/desktop.py` 的 `select_exam_export` 原生对话框。路径不出后端，`select_exam_export` 不在 `server.GUI` 里。
- **存储键**：`exam.v1.index`、`exam.v1.<examId>.meta`、`exam.v1.<examId>.a`、`exam.v1.<examId>.q.<slot>`（单值 ≤ 900 KiB，最多 20 套）；模型选择在 `localStorage['kaizhi.exam.choice.v1']`。不新建表，`library.sqlite3` 的 schema 与 `user_version`（1）不变。
- **记忆**：`LearningEvent` 新增 `quiz-result`，证据 kind 新增 `quiz`；`applyQuizResult` / `applyGlobalQuiz` 以 `exam:<examId>` 与 `qz-…` 幂等；两份总结提示词要求写明「自评」。
- **测试**：`exam-slots` / `exam-validate` / `exam-scoring` / `exam-storage` / `exam-state` / `exam-prompts` / `exam-markdown` / `exam-surfaces` / `exam-progress` / `memory-quiz` / `memory-quiz-engine`，以及 `backend/tests/test_exams.py`。
- **1.2.6**：`exam/progress.ts`（失败批次从 `meta.batches` 恢复、出题区阶段文案，纯函数）；`exam/notify.ts`（页面卸载时断开提示、下次挂载补发）。`ai/exam.ts` 新增 `examMaxTokens`（开了思考就把出题的 `maxTokens` 提到 16 384 / 32 768，只对 deepseek / openai / anthropic / glm）、收尾调用（工具循环没有给出 JSON 时用已读原文发一次不带工具的 `streamChat`，`evidencePack` / `buildFinishMessage`）、按轮累加的用量回报，以及默认关闭的调试记录（`localStorage['kaizhi.exam.debug.v1'] = '1'` 时控制台输出 `[exam-debug]`）。`ModelPicker.vue` 新增 `confirmPlacement`（默认 `presets` 不变；模拟测试用 `footer`，确定按钮在抽屉右下角）。选项改为 `role="button"` 的 `div`。
