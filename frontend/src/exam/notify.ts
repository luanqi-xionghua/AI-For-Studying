/**
 * 模拟测试的提示转发：页面挂载时接上 App 的 notify，卸载时断开。
 *
 * 出题在页面卸载后仍在后台跑（切到别的页、打开原书都会卸载 ExamPage），
 * 这时 Vue 的 emit 已经不再派发，提示会被悄悄丢掉。断开期间先存最近几条，
 * 下次挂载时补发；同时不再持有已卸载组件的回调。
 */

export const NOTIFY_BACKLOG = 3

export function createNotifyRelay(limit: number = NOTIFY_BACKLOG) {
  let handler: ((text: string) => void) | null = null
  let backlog: string[] = []

  function set(next: ((text: string) => void) | null): void {
    handler = typeof next === 'function' ? next : null
    if (!handler || !backlog.length) return
    const pending = backlog
    backlog = []
    for (const text of pending) handler(text)
  }

  function notify(text: string): void {
    const value = String(text ?? '')
    if (!value) return
    if (handler) {
      handler(value)
      return
    }
    backlog = [...backlog.filter(item => item !== value), value].slice(-Math.max(1, limit))
  }

  return { set, notify, attached: () => handler !== null, pending: () => [...backlog] }
}
