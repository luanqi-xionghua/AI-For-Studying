# 阅迁星穹
新一代AI For Reading 文档阅读器

基于开源PDF阅读器的重开发

内置claude code sdk 与 codex agent sdk

---

# 开智

开智是一款 Windows PDF / Markdown 阅读与管理工具，结合本地文档库、并排阅读、手写标记和 AI 文档问答，提供可自定义底板与字体的液态玻璃界面。文档库、阅读进度、设置和对话记录都保存在本机。

| 产品 | 最新正式版 | 下载与说明 |
| --- | --- | --- |
| 开智 Windows 桌面版 | **0.10.54** | [下载](https://github.com/graohene10-spec/pdf-copilot/releases/tag/desktop-v0.10.54) · [使用说明](USAGE.md) · [更新日志](docs/CHANGELOG.md) |
| PDF Copilot 浏览器扩展 | **v0.3.3** | [下载](https://github.com/graohene10-spec/pdf-copilot/releases/tag/v0.3.3) · [扩展说明](extension/README.md) · [扩展教程](extension/docs/USER_GUIDE.md) |

浏览器扩展是同仓库维护的独立产品，版本号分别管理；开智前端复用了扩展中的 PDF 阅读、文档检索与请求队列模块。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 阅读与管理 | PDF / Markdown 文档库、标签、收藏、阅读进度、文档内搜索和全屏；可把多个文件拖入窗口加入文档库。 |
| Word 文档 | .docx 与老式 .doc 加入时用本机的 Word、WPS 或 LibreOffice 转成 PDF，之后按 PDF 阅读、标记和提问；原文件不动。 |
| 并排与同书多开 | 最多三栏并排，PDF / Markdown 可混合；同一本书可在右侧再开一份，各自浏览不同位置，共用对话与标记。 |
| 框选与标记 | PDF 和 Markdown 均支持框选提问、钢笔、荧光笔、划线、橡皮和撤销；标记随段落布局调整，自动保存在本机。 |
| 书签与缩放 | `Alt + B` 添加书签，`Ctrl + ↑ / ↓` 跳转；Markdown 支持整篇缩放，PDF 超宽时可拖动底部横向滚动条。 |
| AI 服务 | DeepSeek、OpenAI、Claude、Kimi、智谱 GLM、通义千问、自定义接口或本机 Codex；支持选文、截图、原文检索、引用跳转、多会话和历史对话。 |
| 阅读助手 | 回车发送、`Ctrl + Enter` 换行；分段式思考强度、侧边对话、斜杠命令、「猜你想问」、机翻栏。 |
| 液态玻璃 | 透明度、模糊程度与边缘高光连续可调，支持光线折射、可读性补偿和底图取色；切换底板可先预览再采用。 |
| 外观与字体 | 六套底板预设、本机图片与助手形象，内置 Anthropic Serif 西文字体，也可导入自己的字体。 |
| 应用内更新 | 安装版和免安装版支持下载、SHA-256 校验、安装并重启。 |

完整的功能说明与快捷键见 [USAGE.md](USAGE.md)。

## 技术架构

```text
开智（Windows 桌面程序，Tauri 2 + 系统 WebView2）
  -> frontend/  Vue 3 + TypeScript + Vite 前端
     -> 阅读器：PDF.js 连续阅读、Markdown（markdown-it / KaTeX / Mermaid）、手写标记
     -> 阅读助手：多服务商流式问答、文档上下文检索、并发请求队列
     -> 界面：液态玻璃、底板与字体、设置、更新卡片
  -> Tauri IPC（invoke 命令；可调用的命令清单见 backend/permissions/workspace.toml）
  -> backend/   Rust 后端
     -> db.rs / files.rs      文档库、阅读进度与本地文件（SQLite）
     -> word.rs               Word（.docx / .doc）转 PDF：本机 Word / WPS（PowerShell COM）或 LibreOffice
     -> credentials.rs        API Key 本机保存（Windows DPAPI 加密）
     -> http_stream.rs        AI 接口的流式 HTTP 请求
     -> native_bridge.rs      ↔ native-host/PdfCopilotHost.exe（C#）↔ 本机 Codex CLI
     -> updater.rs            GitHub Release 检查、下载、校验与安装
```

主要技术：

- 前端：Vue 3、TypeScript、Vite 7、PDF.js、markdown-it、KaTeX、Mermaid、highlight.js、perfect-freehand
- 后端：Rust（最低 1.90）、Tauri 2、rusqlite、reqwest、tokio
- 本机小助手：C#（.NET Framework 4.x，Windows 自带编译器即可构建）
- 打包：NSIS 安装包 + 免安装 ZIP，GitHub Actions 自动发布

## 项目结构

```text
kaizhi/
  frontend/                开智前端：Vue 3 + TypeScript + Vite
    src/
      App.vue              主界面
      ai/                  AI 服务适配、流式传输、翻译、预测与用量
      components/          界面组件（阅读器、阅读助手、设置、更新卡片等）
      document/            文档会话与 AI 上下文
      library/             文档库、书签、封面与分组
      reader/              PDF / Markdown 阅读、搜索、框选、手写标记（ink/）
      sdk/                 前端与后端（Tauri / 浏览器预览）的统一接口
      settings/            偏好设置模型与快捷键
      sketch/              铅笔草稿风格的背景画面
      styles/ ui/ assets/  主题样式、液态玻璃与界面工具、字体与图片
    public/                图标与示例文档（vendor/ 为构建时生成的离线 PDF.js 资源）
    scripts/               tauri.mjs、离线资源准备、打包与发布附件整理
    tests/
      unit/                单元测试（npm test）
      e2e/                 Playwright 界面检查与正式程序原生检查
  backend/                 开智后端：Tauri 2 + Rust
    src/                   lib.rs 注册命令；db / files / credentials / http_stream / native_bridge / updater
    capabilities/          窗口权限
    permissions/           自定义命令的权限声明
    icons/                 应用图标（source/ 为原始设计稿）
    windows/hooks.nsh      NSIS 安装钩子
    resources/             打包进安装包的小助手副本（构建时生成）
    native-host/           C# Codex 小助手源码，bin/ 为编译产物（开智与扩展共用）
    tauri.conf.json        Tauri 配置
    Cargo.toml             Rust 依赖
  extension/               PDF Copilot 浏览器扩展（独立产品）
    src/                   扩展本体（manifest.json）
    scripts/               构建、检查、打包、安装 / 卸载小助手
    tests/                 unit/ 单元测试、e2e/ 浏览器验收、fixtures/ 合成 PDF 夹具
    docs/                  扩展教程、架构、测试记录与更新日志
  docs/                    开智文档：更新日志、升级、隐私、构建发布、小助手协议、调研笔记
  scripts/                 build-host.ps1（编译小助手）、build-windows.ps1（一键构建）、release-notes.mjs
  .github/workflows/       桌面版自动发布流程
  USAGE.md                 开智使用说明与快捷键
```

## 本地启动

普通用户直接下载发行包即可，以下步骤供开发者使用。

### 1. 准备环境

Windows 上需要：

- Node.js 22（与 CI 一致）
- Rust MSVC 工具链（最低 1.90）、Microsoft C++ Build Tools 与 Windows SDK
- WebView2 运行时（Windows 10/11 一般已自带）
- .NET Framework 4.x 编译器 `csc.exe`（Windows 自带，用于编译 Codex 小助手）

### 2. 编译 Codex 小助手

在仓库根目录：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-host.ps1
```

产物为 `backend/native-host/bin/PdfCopilotHost.exe`，后续构建会把它复制进 `backend/resources/` 一起打包。

### 3. 安装前端依赖并准备离线资源

```powershell
cd frontend
npm ci
node scripts/prepare-assets.mjs
```

### 4. 启动开发模式

```powershell
npm run desktop:dev
```

这会先启动 Vite 开发服务器（`http://127.0.0.1:1420`），再编译并打开桌面程序。只想在浏览器里预览界面时可运行 `npm run dev`；浏览器预览的文档库保存在 IndexedDB，与桌面程序的 SQLite 不共用，Codex 与自动更新只在桌面程序中可用。

> 后端不在 Tauri 默认的 `src-tauri/` 位置，而是与前端并列的 `backend/`。`frontend/scripts/tauri.mjs` 会通过 `TAURI_APP_PATH` / `TAURI_FRONTEND_PATH` 告诉 Tauri CLI 两边的位置，所以请始终通过 `npm run tauri -- <命令>`、`npm run desktop:dev`、`npm run desktop:build` 调用，不要直接运行 `npx tauri`。

### 5. 构建安装包

```powershell
npm run desktop:build      # 生成 backend/target/release/bundle/nsis/ 下的安装包
npm run package:desktop    # 整理安装版与免安装版到 frontend/release/
```

也可以在仓库根目录运行 `scripts\build-windows.ps1`（加 `-Test` 会先跑测试）。发布附件整理、版本号同步与自动发布流程见[构建与发布说明](docs/RELEASING.md)。

## 测试

```powershell
cd frontend
npm test                   # 前端单元测试（tests/unit）
npm run test:rust          # Rust 测试（cargo test，需先运行 prepare-assets）
node tests/e2e/<脚本名>.mjs  # 界面检查，需要 Playwright 与 Edge，报告写入 frontend/artifacts/
```

浏览器扩展的测试在 `extension/` 中运行 `npm test`，验收脚本见 [extension/docs/ACCEPTANCE.md](extension/docs/ACCEPTANCE.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [USAGE.md](USAGE.md) | 开智使用说明、AI 服务配置、快捷键 |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | 开智各版本更新日志 |
| [docs/UPDATING.md](docs/UPDATING.md) | 升级与备份 |
| [docs/PRIVACY.md](docs/PRIVACY.md) | 桌面版隐私与数据保存 |
| [docs/RELEASING.md](docs/RELEASING.md) | 版本同步、构建与自动发布 |
| [docs/native-host.md](docs/native-host.md) | Codex 小助手协议与安装 |
| [docs/research/](docs/research/) | 液态玻璃文字对比度调研 |
| [extension/README.md](extension/README.md) | 浏览器扩展说明 |

## 许可

项目自身代码采用 [MIT](LICENSE)。PDF.js、KaTeX、字体等第三方资源说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
