/** 模拟测试自己的模型选择：存 localStorage，从不改动阅读助手或对话模式的选择。 */
import type { ChatModelChoice } from '../chat/types.ts'
import { CHATMODE_VERSION } from '../chat/types.ts'
import { normalizeChatChoice } from '../chat/choice.ts'

export const EXAM_CHOICE_KEY = 'kaizhi.exam.choice.v1'

export function loadExamChoice(
  storage: Pick<Storage, 'getItem'> | null | undefined = globalThis.localStorage,
): ChatModelChoice {
  try {
    const raw = storage?.getItem(EXAM_CHOICE_KEY)
    if (!raw) return normalizeChatChoice(null)
    return normalizeChatChoice(JSON.parse(raw))
  } catch {
    return normalizeChatChoice(null)
  }
}

export function saveExamChoice(
  choice: ChatModelChoice,
  storage: Pick<Storage, 'setItem'> | null | undefined = globalThis.localStorage,
): void {
  try {
    storage?.setItem(EXAM_CHOICE_KEY, JSON.stringify({ ...normalizeChatChoice(choice), version: CHATMODE_VERSION }))
  } catch {
    /* 存不下就只在这次有效 */
  }
}

export { resolveChatChoice as resolveExamChoice, pickChatPreset, pickChatModel, pickChatEffort } from '../chat/choice.ts'
