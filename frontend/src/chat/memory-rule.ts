/**
 * 对话模式的学习记忆写入规则：只看「记忆范围」和「这一轮带没带附件」。
 * 纯函数，没有运行时依赖，Node 单测直接导入。
 */
import type { MemoryScope } from '../memory/types.ts'

/** 这一轮要写的记忆对象。 */
export type LearningTarget = 'doc' | 'global'

/**
 * 这一轮该写哪些学习记忆：
 * - 带附件（图片或文档）的回合一律不写，优先级最高；
 * - 文档 A 的记忆 → 写 A 和全局；
 * - 全局记忆 → 只写全局；
 * - 不使用记忆 → 不写。
 * 真值表见实施清单 §6.1。
 */
export function learningTargets(scope: MemoryScope, hasAttachments: boolean): LearningTarget[] {
  if (hasAttachments) return []
  if (scope.kind === 'doc') return ['doc', 'global']
  if (scope.kind === 'global') return ['global']
  return []
}

/** 附件栏里有东西（文档条目）或这一问带了图片，就算「带附件的回合」。 */
export function hasAttachmentTurn(images: readonly string[] | undefined, docs: readonly unknown[] | undefined): boolean {
  return Boolean(images?.length) || Boolean(docs?.length)
}
