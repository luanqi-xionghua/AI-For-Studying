import { reactive } from 'vue'

export type SaveFailure = {
  id: string
  label: string
  error: string
  retrying: boolean
  retry: () => Promise<void>
}

export const saveFailures = reactive(new Map<string, SaveFailure>())

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function reportSaveFailure(id: string, label: string, error: unknown, retry: () => Promise<void>) {
  const current = saveFailures.get(id)
  saveFailures.set(id, { id, label, error: message(error), retrying: current?.retrying || false, retry })
}

export function clearSaveFailure(id: string) {
  saveFailures.delete(id)
}

export async function retrySave(id: string) {
  const failure = saveFailures.get(id)
  if (!failure || failure.retrying) return
  failure.retrying = true
  try {
    await failure.retry()
    clearSaveFailure(id)
  } catch (error) {
    const current = saveFailures.get(id)
    if (current) current.error = message(error)
  } finally {
    const current = saveFailures.get(id)
    if (current) current.retrying = false
  }
}
