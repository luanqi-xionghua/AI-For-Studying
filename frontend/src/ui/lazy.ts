// 懒加载组件的统一包装：加载态、自动重试、失败兜底与整页刷新。
// 1.2.8 Bug 1：升级后页面若仍是旧版入口，它请求的懒加载 chunk 在新版目录里已不存在（404），
// defineAsyncComponent 没有任何兜底时只剩一片空白、也不留痕迹。这里把每个懒加载组件都包一层：
// 先自动重试；chunk 失败且发生在启动后不久（版本错位的典型时机）就整页刷新一次（会话内 60 秒限一次，
// 防止刷新死循环）；再不行就显示可操作的错误卡片，并写进本机日志。
import { defineAsyncComponent, h, type AsyncComponentLoader, type Component } from 'vue'
import { reportClientError } from './error-log.ts'
import { isChunkError, lazyDecision, reloadOnce } from './chunk-reload.ts'
export { isChunkError, lazyDecision, reloadOnce } from './chunk-reload.ts'

export type LazyVariant = 'page' | 'overlay' | 'quiet'
type LazyOptions = { name: string; variant?: LazyVariant; retries?: number; timeout?: number; /** overlay 用：失败卡片上的「关闭」，让外层把对话框状态复位。 */ dismiss?: () => void }

function LoadingState(variant: LazyVariant) {
  return { name: 'LazyLoading', render: () => h('div', { class: ['lazy-state', `lazy-${variant}`], role: 'status', 'aria-live': 'polite' }, [h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('p', '正在加载…')]) }
}
function ErrorState(variant: LazyVariant, name: string, dismiss?: () => void) {
  return {
    name: 'LazyError',
    props: { error: { type: null, default: undefined } },
    render(this: { error?: unknown }) {
      const card = h('div', { class: ['lazy-state', 'lazy-error', `lazy-${variant}`], role: 'alert' }, [
        h('strong', `${name}没能加载出来`),
        h('p', isChunkError(this.error) ? '界面文件没有读到，常见于刚升级完。重新加载界面通常就能恢复，文档与设置不受影响。' : '加载时出了错，已记录到本机日志。可以重新加载界面再试。'),
        h('div', { class: 'lazy-actions' }, [
          dismiss ? h('button', { type: 'button', class: 'lazy-dismiss', onClick: dismiss }, '关闭') : null,
          h('button', { type: 'button', class: 'lazy-reload', onClick: () => location.reload() }, '重新加载界面'),
        ]),
      ])
      return variant === 'overlay' ? h('div', { class: 'lazy-backdrop' }, [card]) : card
    },
  }
}

const started = typeof performance !== 'undefined' ? performance.timeOrigin : Date.now()
/** 带兜底的 defineAsyncComponent。page：占满所在区域；overlay：居中卡片（对话框类）；quiet：不显示任何东西（菜单、背景动画）。 */
export function lazy<T extends Component>(loader: AsyncComponentLoader<T>, options: LazyOptions): T {
  const variant = options.variant ?? 'page', retries = options.retries ?? 2
  return defineAsyncComponent({
    loader,
    delay: 200,
    timeout: options.timeout ?? 30_000,
    loadingComponent: variant === 'quiet' ? undefined : LoadingState(variant),
    errorComponent: variant === 'quiet' ? undefined : ErrorState(variant, options.name, options.dismiss),
    onError(error, retry, fail, attempts) {
      const decision = lazyDecision(error, attempts, { retries, sinceStart: Date.now() - started })
      if (decision === 'retry') { setTimeout(retry, 400 * attempts); return }
      reportClientError('chunk-load', error, { info: `${options.name} after ${attempts} attempts` })
      if (decision === 'reload' && reloadOnce(options.name)) return
      fail()
    },
  }) as T
}
