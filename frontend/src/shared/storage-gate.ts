/** 备份前把还没落库的数据写完；恢复前冻结写入，免得把旧的内存状态写进刚恢复的库。 */
export type StorageParticipant = { flush(): Promise<void>; freeze(): void; unfreeze(): void }

const participants = new Set<StorageParticipant>()

export function joinStorageGate(participant: StorageParticipant): () => void {
  participants.add(participant)
  return () => { participants.delete(participant) }
}
export async function flushStorage(): Promise<void> {
  await Promise.allSettled([...participants].map(item => item.flush()))
}
export function freezeStorage(): void {
  for (const item of participants) {
    try { item.freeze() } catch { /* 一个参与者出错不影响其余的 */ }
  }
}
export function unfreezeStorage(): void {
  for (const item of participants) {
    try { item.unfreeze() } catch { /* 同上 */ }
  }
}
