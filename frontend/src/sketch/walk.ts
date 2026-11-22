/**
 * 二十面体随机游走的推进逻辑（从 scenes.ts 的「走遍二十面体」画面里抽出来，方便单测）。
 *
 * `env.t` 是画面开始以来的毫秒数。窗口最小化 / 被隐藏 / 系统休眠时动画的 rAF 会暂停，
 * 恢复后 `env.t` 可能一下跳几分钟到几小时，`floor(t / 2800)` 随之涨到几百上千。
 * 如果直接同步补跑这么多步，渲染线程会被占满、界面卡死。
 * 这里沿用 lorenz / life 两个画面的做法：跳变时只补最近 40 步。
 */

export type WalkState = {
  /** 已经走过的顶点（只保留最后一小段用于绘制）。 */
  walk: number[]
  /** 每条边走的是 a 还是 b 方向。 */
  word: string[]
  /** 已推进的步数（绝对计数，不能用 walk.length 代替：数组会被裁剪）。 */
  done: number
}

export const STEP = 2800
export const CATCH_UP = 40

/** 把随机游走推进到 targetSteps；时间跳变时只补最近 CATCH_UP 步。 */
export function advanceWalk(
  state: WalkState,
  targetSteps: number,
  next: number[],
  flip: number[],
  random: () => number = Math.random,
): void {
  if (targetSteps - state.done > CATCH_UP) state.done = targetSteps - CATCH_UP
  while (state.done < targetSteps) {
    const here = state.walk[state.walk.length - 1]!
    const useFlip = state.word[state.word.length - 1] !== 'a' && random() < .45
    state.walk.push(useFlip ? flip[here]! : next[here]!)
    state.word.push(useFlip ? 'a' : 'b')
    state.done += 1
    if (state.walk.length > 40) { state.walk.splice(0, 20); state.word.splice(0, 20) }
  }
}

/** 根据画面时间计算目标步数。 */
export function stepsAt(elapsed: number): number {
  return Math.floor(Math.max(0, elapsed) / STEP)
}
