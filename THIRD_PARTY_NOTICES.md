# 第三方代码与许可

项目自身代码使用根目录的 MIT 许可。以下为桌面版的主要第三方组件。

- PDF.js / pdfjs-dist 6.4.299 用于本地 PDF 阅读。前端构建保留 `vendor/pdfjs/LICENSE`，以及 CMaps、标准字体、色彩和 WebAssembly 资源附带的许可文本。
- KaTeX 0.19.0 用于本地公式排版；MIT 许可在前端构建时复制到 `vendor/KaTeX-LICENSE.txt`。
- 桌面窗口和 WebEngine 来自 PySide6 / Qt；Python 依赖列于 `requirements.txt`。分发二进制前应核对实际打包的组件与各自附带的许可、声明文件。
- Codex CLI、Word、WPS、LibreOffice 均由用户单独安装，不随本项目分发。

桌面版复用 PDF.js 和 KaTeX，另使用 Vue、Mermaid、perfect-freehand 与 Anthropic TypeScript SDK（`@anthropic-ai/sdk`，调用 Claude 接口）。锁定版本及声明许可见 [frontend/package-lock.json](frontend/package-lock.json)：Vue、Mermaid、perfect-freehand 声明为 MIT，`@anthropic-ai/sdk` 声明为 Apache-2.0；`@fontsource-variable/source-serif-4` 包声明为 OFL-1.1。分发这些依赖时应保留各自许可文本。

0.3.1 内置的独立字体文件为 [AnthropicSerif-Variable.woff2](frontend/src/assets/fonts/AnthropicSerif-Variable.woff2)。该文件目录目前没有附带单独的许可文本，来源与授权说明尚需提供者补充；不能用 Source Serif 4 包的许可代替这个独立文件的授权说明。

0.8.0 起为「铅笔草稿」界面风格内置 Long Cang（龙藏体）、Ma Shan Zheng（马善政楷书）、ZCOOL KuaiLe（站酷快乐体）、ZCOOL XiaoWei（站酷小薇体）、Caveat 与 Patrick Hand 六款字体的子集（WOFF2），均采用 SIL Open Font License 1.1；版权声明与许可全文见 [frontend/src/assets/fonts/OFL.txt](frontend/src/assets/fonts/OFL.txt)。

用户在设置中导入的字体保存在其本机文档库，不会加入项目发布包。
