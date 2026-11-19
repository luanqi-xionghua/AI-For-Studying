import { invoke, Channel } from './python'
import type { UpdateInfo, UpdateInstaller, UpdateStatus } from '../ui/update-select'
export type { UpdateInfo, UpdateInstaller, UpdateStatus } from '../ui/update-select'
export type DownloadProgress = { downloaded: number; total: number | null }

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try { return await invoke<T>(command, args) }
  catch (error) { throw error instanceof Error ? error : new Error(String(error)) }
}

/** Running version, and whether this copy is an NSIS install that can update itself. */
export async function updateStatus(): Promise<UpdateStatus> {
  return call<UpdateStatus>('update_status')
}

/** Newest desktop release above the running version, or null when up to date. */
export async function checkForUpdate(includePrerelease: boolean): Promise<UpdateInfo | null> {
  return call<UpdateInfo | null>('update_check', { includePrerelease })
}

/** Downloads and SHA-256-verifies the installer; resolves to its local path. */
export async function downloadUpdate(installer: UpdateInstaller, onProgress: (progress: DownloadProgress) => void): Promise<string> {
  const channel = new Channel<DownloadProgress>()
  channel.onmessage = onProgress
  return call<string>('update_download', { url: installer.url, sha256: installer.sha256, onProgress: channel })
}

export async function cancelUpdateDownload(): Promise<void> {
  await call('update_cancel')
}

/** Starts the silent installer and quits; the updated app reopens afterwards. */
export async function installUpdate(path: string): Promise<void> {
  await call('update_install', { path })
}

/** Opens a page of this repository (release page or a linked document) in the browser. */
export async function openRepoPage(url: string): Promise<void> {
  await call('update_open_page', { url })
}
