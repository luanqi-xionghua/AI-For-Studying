# PDF Copilot 浏览器扩展更新日志

浏览器扩展各公开发行版的更新说明，按版本从新到旧排列。

## PDF Copilot v0.3.3

以下为相对于上一公开发行版 **v0.3.2** 的更新。

### 新增与改进

- **默认允许每题按需查看 5 次页图**，由原来的 2 次提高到 5 次。直接提问时自动提供的当前页计入上限，手动截图附件不计入。
- **资源限制可自行调整**：在 **模型与密钥设置 → PDF 资源限制** 中调整页图次数、证据页数、正文字符数、PDF 读取次数、API 检索轮次、搜索扫描页数和搜索时间。设置区默认收起，支持恢复默认与范围校验。
- **每题使用独立预算**：保存设置后从下一题生效，正在回答的问题沿用发送时的限制。API 工具模式、Codex 工具模式与兼容检索模式均按剩余预算提供材料；阅读画布、索引缓存、图片尺寸和传输大小仍保持固定边界。
- 更新安装、升级与资源配置教程，说明各项限制的范围、计算方式和调整示例。

### 修复

- 修复多张较大页图可能因 API 请求状态上限被提前阻止的问题，并更新 Windows 小助手的图片与证据预算，避免仍受旧的两张页图限制。
- 修复扩大搜索扫描范围后，早期命中可能随索引缓存淘汰而丢失的问题；保留当次搜索的最佳命中，并正确报告扫描覆盖范围。
- 改进 Codex 工具结果被拒绝时的及时反馈。旧小助手不支持新资源配置时，明确提示更新助手。

### 下载与升级

推荐下载 Assets 中的 **pdf-copilot-0.3.3.zip**，默认版自带公式排版模块；极简完整包为 **pdf-copilot-lite-0.3.3.zip**。自动生成的 Source code 归档需要构建，不能直接加载。

从 v0.3.2 升级：将新 **extension** 内容覆盖到原加载目录，在浏览器扩展管理页点击 **重新加载**，关闭并重开旧阅读页、侧栏和设置页。**Codex 用户还需运行本版 windows-helper/install.cmd 更新小助手**；仅使用 API Key 的用户无需安装助手。设置页应显示 **v0.3.3**，展开 **PDF 资源限制** 可看到默认页图次数为 **5**。

[逐步安装与使用教程](https://github.com/graohene10-spec/pdf-copilot/blob/v0.3.3/docs/USER_GUIDE.md) · [资源限制教程](https://github.com/graohene10-spec/pdf-copilot/blob/v0.3.3/docs/RESOURCE_LIMITS.md) · [功能介绍](https://github.com/graohene10-spec/pdf-copilot/blob/v0.3.3/README.md)

## PDF Copilot v0.3.2

以下为相对于上一公开发行版 **v0.2.3** 的更新。

### 新增与改进

- **AI 按需获取 PDF 上下文**：增强阅读器可让 AI 查目录、搜索术语/公式编号、读取相关段落，并在需要时核对页图。回答提供可点击的原文证据，区分物理 PDF 页码和文档页标签。
- **无需截图即可提问当前页**：没有手动附件时，增强模式自动附发送时的完整当前 PDF 页图；浏览器自带阅读器附当前可见区域。已有选文/截图时使用附件，避免重复附整页。文字模型在增强模式改读当前页文字，无文字层时提示切换图片模型。
- **自动上下文默认开启**，保留用户主动关闭的偏好，并在侧栏/临时窗口同步。输入区提示将提供什么；只有点击发送才会准备页面，翻页本身不会上传。历史图片不自动重发，读取和页图均有预算限制。
- **回复字号可调**：默认 17，支持 14–24；点击 A− / A+ 调整，点击数字恢复默认，文字/代码/公式一起缩放，偏好保存并跨窗口同步。
- **界面更简洁**：侧栏模型配置折叠显示，输入区集中截图与发送，自动页图预览默认收起；统一阅读器工具栏、目录、书签和夜间配色。
- **Codex PDF 工具支持**：小助手可处理当前文档的只读检索/读页请求；不支持动态工具的连接可尝试兼容检索模式。停止、清空或换文档时取消读取，避免旧结果串入新问题。

### 修复

- 修复从 `file:///` PDF 切入增强阅读器时可能出现的 `Unexpected server response (0)`：点击打开时补齐缺失的可选本地读取授权，已有授权直接复用。
- 改进本地文件缺失、授权拒绝及加载失败的提示与清理。截图授权不足时停止请求并给出操作方法；准备页图期间停止，不会迟到上传。

### 下载与升级

推荐下载 Assets 中的 **pdf-copilot-0.3.2.zip**；默认版自带公式排版模块。极简完整包为 **pdf-copilot-lite-0.3.2.zip**。自动生成的 Source code 归档需要构建，不能直接加载。

从 v0.2.3 升级：将新 **extension** 内容覆盖到原加载目录，点击浏览器扩展管理页 **重新加载**，关闭并重开旧阅读页/侧栏。**Codex 用户运行本版 windows-helper/install.cmd 更新小助手**；API Key 用户无需安装助手。设置页应显示 **v0.3.2**。

[逐步安装与使用教程](https://github.com/graohene10-spec/pdf-copilot/blob/v0.3.2/docs/USER_GUIDE.md) · [功能介绍](https://github.com/graohene10-spec/pdf-copilot/blob/v0.3.2/README.md) · [隐私与权限](https://github.com/graohene10-spec/pdf-copilot/blob/v0.3.2/PRIVACY.md)

## PDF Copilot v0.2.3

轻量的 Windows Edge / Chrome PDF 阅读扩展，附带可选 Codex 小助手。保留浏览器原有 PDF 阅读方式，并提供支持连续滚动、直接框选和页码引用的 PDF.js 增强阅读器。

### 下载与安装

推荐 **pdf-copilot-0.2.3.zip**：包含扩展、内置 KaTeX 公式模块与字体、可选 Windows 小助手、教程和许可。无需为公式安装任何额外环境。**pdf-copilot-lite-0.2.3.zip** 为公式显示原文的极简版。

另提供扩展独立包、助手独立包、可构建源码包、SHA256SUMS.txt 和发行版体积对照。两个发行版使用相同扩展 ID，选择一种即可。

1. 解压完整包，打开 edge://extensions 或 chrome://extensions，开启开发人员模式。
2. 加载包含 manifest.json 的 **extension** 文件夹，并固定扩展图标。
3. 打开侧栏“设置”，配置 DeepSeek / OpenAI API Key；或安装 windows-helper/install.cmd 后选择 Codex 本机登录。
4. 打开 PDF，使用侧栏提问、截图框选，或切换增强阅读器。

[详细功能与安装教程](https://github.com/graohene10-spec/pdf-copilot/blob/main/README.md) · [使用教程](https://github.com/graohene10-spec/pdf-copilot/blob/main/docs/USER_GUIDE.md) · [隐私说明](https://github.com/graohene10-spec/pdf-copilot/blob/main/PRIVACY.md)

### 本版修复

- 修复含文档链接的 PDF 页初始化失败，恢复内部链接与框选。
- 页面仍在渲染时，框选会等待完成再显示预览，并取消已经过期的选区。
- 取消文字选择后，不再保留旧文字附件入口。
- 翻页后继续保留框选模式提示。
- 取消加密 PDF 密码输入后，正确显示取消提示并允许继续打开文档。

侧栏快捷键为普通“打开 AI 侧栏”命令，建议 Ctrl + Shift + 7；增强阅读器建议 Ctrl + Shift + 8。未设置时可在浏览器扩展快捷键页手动分配。升级后需重新加载扩展，并关闭重开旧阅读器页。

### 验证与限制

57 项单元测试通过；1 项真实元数据测试默认跳过，另用真实 Edge Native Messaging 检查通过。隔离 Edge 的 26 组阅读验收通过，覆盖高 DPI、目录/内链、连续滚动、书签、慢渲染、正反向框选和加密 PDF。完整/极简公式和等待状态使用本机模拟服务验证。真实 Codex 极小合成文字与图片问答各通过一次；未向模型发送个人 PDF。

本版为侧载初版，尚未上架商店，小助手 EXE 尚未签名。真实浏览器快捷键/原生 PDF 右键菜单跨环境、DeepSeek/OpenAI API 真实推理、全新电脑安装卸载等仍需进一步实测。[完整测试记录](https://github.com/graohene10-spec/pdf-copilot/blob/main/docs/QA_REPORT.md)

应用不主动保存截图文件；系统交换文件、浏览器行为和服务商处理政策不属于绝不落盘保证。Codex 需要 Windows 原生 CLI 0.159.2 或更新版本，登录由 Codex 自身管理。
