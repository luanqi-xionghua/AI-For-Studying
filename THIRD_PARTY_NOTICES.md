# 第三方代码与许可
# 作者:乱崎凶华
项目自身代码使用根目录的 MIT 许可。以下为桌面版的主要第三方组件。

- PDF.js / pdfjs-dist 6.4.299 用于本地 PDF 阅读。前端构建保留 `vendor/pdfjs/LICENSE`，以及 CMaps、标准字体、色彩和 WebAssembly 资源附带的许可文本。
- KaTeX 0.19.0 用于本地公式排版；MIT 许可在前端构建时复制到 `vendor/KaTeX-LICENSE.txt`。
- 桌面窗口和 WebEngine 来自 PySide6 / Qt；Python 依赖列于 `backend/requirements.txt`。分发二进制前应核对实际打包的组件与各自附带的许可、声明文件。
- Word、WPS、LibreOffice 均由用户单独安装，不随本项目分发。
- 发布用的安装包由 NSIS（zlib/libpng 许可）生成；安装目录里附带本项目的 `LICENSE.txt` 和本文件。PySide6 / Qt 按 LGPL-3.0 使用，未修改其源码。

桌面版复用 PDF.js 和 KaTeX，另使用 Vue、Mermaid、perfect-freehand。锁定版本及声明许可见 [frontend/package-lock.json](frontend/package-lock.json)：Vue、Mermaid、perfect-freehand 声明为 MIT；`@fontsource-variable/source-serif-4` 包声明为 OFL-1.1。分发这些依赖时应保留各自许可文本。

0.3.1 内置的独立字体文件为 [AnthropicSerif-Variable.woff2](frontend/src/assets/fonts/AnthropicSerif-Variable.woff2)。该文件目录目前没有附带单独的许可文本，来源与授权说明尚需提供者补充；不能用 Source Serif 4 包的许可代替这个独立文件的授权说明。

0.8.0 起为「铅笔草稿」界面风格内置 Long Cang（龙藏体）、Ma Shan Zheng（马善政楷书）、ZCOOL KuaiLe（站酷快乐体）、ZCOOL XiaoWei（站酷小薇体）、Caveat 与 Patrick Hand 六款字体的子集（WOFF2），均采用 SIL Open Font License 1.1；版权声明与许可全文见 [frontend/src/assets/fonts/OFL.txt](frontend/src/assets/fonts/OFL.txt)。

用户在设置中导入的字体保存在其本机文档库，不会加入项目发布包。

AI 模型调用使用 DeepSeek Harness 的 `@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-llm-pi-ai` 与 Cordis，不分发用户登录凭据。依赖版本见 `harness/package-lock.json`。构建脚本在 `harness/dist/licenses/` 收集模型运行时与 Node.js 的许可文本并随 EXE 分发。

## 上游项目：pdf-copilot（MIT）

本项目（阅迁星穹）是在 [graohene10-spec/pdf-copilot](https://github.com/graohene10-spec/pdf-copilot) 的基础上重写并扩展而来。上游是 Edge / Chrome 的轻量 PDF 阅读与 AI 对话扩展（附可选的 Windows Codex 小助手）；本项目是 Windows 桌面阅读器：桌面外壳、本机 Python 服务、阅读器、助手与界面均为重写，同时沿用了原有的产品思路与部分实现。

上游以 MIT 许可发布，版权声明为 `Copyright (c) 2026 PDF Copilot contributors`。按 MIT 许可要求，本项目随包的 `LICENSE`（安装版内为 `LICENSE.txt`）保留了该版权行与完整许可文本；上游许可原文另存为仓库根目录的 [LICENSE-pdf-copilot](LICENSE-pdf-copilot)。
