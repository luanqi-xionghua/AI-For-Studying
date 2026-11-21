/** 资料检索的默认实例：把真实 client、AI 改写/重排和 localStorage 接上。 */

import { loadAiSettings } from '../ai/settings.mjs'
import { rerankAvailability } from '../ai/materials.ts'
import { materialsClient } from './client.ts'
import { createMaterialsState } from './state.ts'

const complete = (options: any) =>
  import('../ai/complete.ts').then(module => module.complete(options))

export const materials = createMaterialsState({
  client: materialsClient,
  // 改写查询：口语 → 「规范课程名 + 资料类型」；失败就用原话
  rewrite: async (input, signal) => {
    const { rewriteQuery } = await import('../ai/materials.ts')
    return rewriteQuery(input, { signal, complete })
  },
  // 在已召回的候选里重排并写一句理由；模型不生成链接
  rerank: async (input, signal) => {
    const { rerankMaterials } = await import('../ai/materials.ts')
    return rerankMaterials(input, { signal, complete })
  },
  rerankAvailable: () => rerankAvailability(loadAiSettings()),
  storage: typeof localStorage === 'undefined' ? null : localStorage,
  now: () => Date.now(),
})

export const materialsSyncing = () => materials.state.sync.running
