/**
 * 出题进行中的标记：记忆的自动总结看到它会推迟，避免两路模型请求同时跑。
 * 只是一个模块级布尔值，不依赖任何运行时。
 */

let busy = false

export function setExamBusy(on: boolean): void {
  busy = Boolean(on)
}

export function examBusy(): boolean {
  return busy
}
