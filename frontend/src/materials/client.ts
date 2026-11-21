/** 资料检索的本机 RPC：只碰 sdk/python 的 invoke 与 Channel。 */

import { Channel, invoke } from '../sdk/python.ts'
import type {
  MaterialProgress, MaterialSearchResult, MaterialStatus, MaterialSyncResult,
} from './types.ts'

export type { MaterialsClient } from './types.ts'

import type { MaterialsClient } from './types.ts'

export const materialsClient: MaterialsClient = {
  status: () => invoke<MaterialStatus>('material_status'),

  sync(onProgress) {
    const channel = new Channel<MaterialProgress>()
    channel.onmessage = (event) => {
      // 只转发进度；python.ts 见到 end/error 会注销通道，所以后端不会发那两种。
      if (event && (event as MaterialProgress).type === 'progress') onProgress(event)
    }
    return invoke<MaterialSyncResult>('material_sync', { onProgress: channel })
  },

  cancel: () => invoke<{ cancelled: boolean; reason?: 'idle' | 'committing' }>('material_cancel'),

  search: (query, limit) => invoke<MaterialSearchResult>('material_search', { query, limit }),

  open: (id) => invoke<{ opened: true; host: string }>('material_open', { id }),

  clear: () => invoke<{ cleared: true }>('material_clear'),
}
