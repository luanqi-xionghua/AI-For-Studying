// 页面侧的错误上报：未捕获异常、未处理的 Promise 拒绝、脚本/样式加载失败、Vue 渲染错误、chunk 加载失败，
// 统一交给桌面后端写进本机滚动日志（<数据目录>/logs/app.log）。只在本机，不联网。
// 上报前先脱敏：去掉会话 token 与本机端口；后端还会再做一遍（API Key、用户目录等）。
// 自身绝不抛错、不递归：发送失败就丢弃。

export type ClientLogKind = 'error' | 'unhandledrejection' | 'chunk-load' | 'resource' | 'vue' | 'recovered' | 'boot' | 'other'
export type ClientLogEntry = { kind: ClientLogKind; level: 'info' | 'warn' | 'error'; message: string; stack?: string; source?: string; line?: number; column?: number; page?: string; info?: string; version?: string }
type Send = (entry: ClientLogEntry) => Promise<unknown>

const MAX_PER_SESSION = 200
const DEDUPE_MS = 10_000
let send: Send | undefined
const queue: ClientLogEntry[] = []
const recent = new Map<string, number>()
let sent = 0

/** 去掉 token、本机 origin，压掉过长的文本。 */
export function sanitize(text: unknown, limit = 2000): string {
  let value = typeof text === 'string' ? text : text instanceof Error ? `${text.name}: ${text.message}` : (() => { try { return JSON.stringify(text) ?? String(text) } catch { return String(text) } })()
  value = value
    .replace(/#desktop=[\w-]+/g, '#desktop=<token>')
    .replace(/https?:\/\/(127\.0\.0\.1|localhost):\d+/g, '')
    .replace(/\b(sk|rk|pk)-[\w-]{8,}/g, '$1-<redacted>')
    .replace(/(bearer\s+)[\w.~+/=-]{6,}/gi, '$1<redacted>')
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

function deliver(entry: ClientLogEntry) {
  if (!send) { if (queue.length < 50) queue.push(entry); return }
  if (sent >= MAX_PER_SESSION) return
  sent++
  try { void send(entry).catch(() => { /* 后端不在了：丢弃 */ }) } catch { /* 同上 */ }
}

/** 记一条。error 可以是 Error、字符串或任意值；extra 里的 info 用来写上下文（组件名、Vue 生命周期等）。 */
export function reportClientError(kind: ClientLogKind, error: unknown, extra: { level?: ClientLogEntry['level']; info?: string; source?: string; line?: number; column?: number } = {}): void {
  try {
    const message = sanitize(error, 1000)
    const key = `${kind}|${message}`
    const now = Date.now()
    if (now - (recent.get(key) ?? 0) < DEDUPE_MS) return
    recent.set(key, now)
    if (recent.size > 200) recent.clear()
    deliver({
      kind, level: extra.level ?? 'error', message,
      stack: error instanceof Error && error.stack ? sanitize(error.stack, 3000) : undefined,
      source: extra.source ? sanitize(extra.source, 300) : undefined,
      line: extra.line, column: extra.column,
      page: typeof location !== 'undefined' ? sanitize(location.pathname, 200) : undefined,
      info: extra.info ? sanitize(extra.info, 300) : undefined,
    })
  } catch { /* 日志永远不影响界面 */ }
}

/** 接上发送通道并挂全局监听；返回卸载函数。启动前积压的条目在这里补发。 */
export function installErrorLog(sender: Send, target: Window = window): () => void {
  send = sender
  for (const entry of queue.splice(0)) deliver(entry)
  const onError = (event: Event) => {
    if (typeof ErrorEvent !== 'undefined' && event instanceof ErrorEvent) {
      reportClientError('error', event.error ?? event.message, { source: event.filename, line: event.lineno, column: event.colno })
      return
    }
    // 捕获阶段才收得到的资源加载失败（<script>、<link>、<img>）：只记脚本和样式。
    const element = event.target as Element | null
    if (element && element !== (target as unknown) && (element.tagName === 'SCRIPT' || element.tagName === 'LINK')) {
      reportClientError('resource', `${element.tagName.toLowerCase()} failed`, { source: (element as HTMLScriptElement).src || (element as HTMLLinkElement).href })
    }
  }
  const onRejection = (event: PromiseRejectionEvent) => reportClientError('unhandledrejection', event.reason)
  // Vite 预加载（import 前的 CSS/依赖 chunk）失败时派发的事件。
  const onPreload = (event: Event) => reportClientError('chunk-load', (event as Event & { payload?: unknown }).payload ?? 'vite:preloadError')
  target.addEventListener('error', onError, true)
  target.addEventListener('unhandledrejection', onRejection)
  target.addEventListener('vite:preloadError', onPreload)
  return () => {
    target.removeEventListener('error', onError, true)
    target.removeEventListener('unhandledrejection', onRejection)
    target.removeEventListener('vite:preloadError', onPreload)
    send = undefined
  }
}

/** 仅供测试：清空内部状态。 */
export function resetErrorLogForTests(): void { send = undefined; queue.length = 0; recent.clear(); sent = 0 }
