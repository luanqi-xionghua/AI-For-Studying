// 判断“脚本/样式文件没取到”的错误，以及受限的整页刷新。不依赖 Vue：入口 main.ts 也要用。
import { reportClientError } from './error-log.ts'

const CHUNK_ERROR = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading (CSS )?chunk [\w-]+ failed|Failed to load module script/i

/** 是不是“脚本/样式文件没取到”这一类错误（与组件自身代码抛错区分开）。 */
export function isChunkError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '')
  return CHUNK_ERROR.test(message)
}

export const RELOAD_KEY = 'kaizhi:chunk-reload'
export const RELOAD_GAP = 60_000
/** 启动后这段时间内的 chunk 失败视为版本错位，自动整页刷新；之后只给按钮，不打断正在进行的操作。 */
export const AUTO_RELOAD_WINDOW = 90_000

type Store = Pick<Storage, 'getItem' | 'setItem'>
/** 整页刷新，但同一会话 60 秒内最多一次。返回是否真的刷新了。 */
export function reloadOnce(reason: string, options: { storage?: Store; now?: number; reload?: () => void } = {}): boolean {
  const storage = options.storage ?? safeSession()
  const now = options.now ?? Date.now()
  const last = Number(storage?.getItem(RELOAD_KEY) || 0)
  if (storage && now - last < RELOAD_GAP) return false
  try { storage?.setItem(RELOAD_KEY, String(now)) } catch { /* 存不下时仍刷新一次 */ }
  reportClientError('chunk-load', `reload: ${reason}`, { level: 'warn' })
  ;(options.reload ?? (() => location.reload()))()
  return true
}
function safeSession(): Store | undefined { try { return sessionStorage } catch { return undefined } }

/** onError 的决策，单独导出便于测试：继续重试 / 刷新整页 / 显示错误。 */
export function lazyDecision(error: unknown, attempts: number, options: { retries: number; sinceStart: number }): 'retry' | 'reload' | 'fail' {
  if (attempts <= options.retries) return 'retry'
  return isChunkError(error) && options.sinceStart < AUTO_RELOAD_WINDOW ? 'reload' : 'fail'
}
