// Release selection, asset verification and installation live in backend/updates.py.
export const REPO_PAGE = 'https://github.com/luanqi-xionghua/AI-For-Reading'

export type UpdateInstaller = { name: string; url: string; size: number; sha256: string; kind: 'setup' | 'portable' }
export type UpdateInfo = {
  version: string
  tag: string
  name: string
  notes: string
  publishedAt: string | null
  htmlUrl: string
  prerelease: boolean
  /** null: no verifiable installer, the UI links to the release page instead. */
  installer: UpdateInstaller | null
}
export type UpdateStatus = { current: string; installed: boolean }

function isPageUnder(address: string, prefix: string): boolean {
  if (typeof address !== 'string' || address.length > 2048 || /[\u0000-\u001f\u007f"^% ]/.test(address)) return false
  let url: URL
  try { url = new URL(address) } catch { return false }
  const path = new URL(prefix).pathname
  return url.protocol === 'https:' && url.host === 'github.com' && !url.username && !url.password && !url.search && !url.hash
    && (url.pathname === path || url.pathname.startsWith(`${path}/`))
}

/** Any page of this repository, e.g. a README linked from release notes. */
export function isRepoPage(url: string): boolean { return isPageUnder(url, REPO_PAGE) }

/** Auto checks are quiet: a skipped version is not offered again unless checked manually. */
export function shouldOffer(info: UpdateInfo | null, skipped: string | null, manual: boolean): boolean {
  return !!info && (manual || info.version !== skipped)
}
