/** 模拟测试的本机 RPC（只走 sdk 的 invoke，不直连外网）。 */

import { invoke } from '../sdk/python'
import type { ExportOutcome } from './types.ts'

export const examClient = {
  exportMarkdown(markdown: string, title: string): Promise<ExportOutcome> {
    return invoke<ExportOutcome>('exam_export', { markdown, title })
  },
}
