/**
 * Renderer preload bridge for the desktop shell. Exposes a narrow, type-safe
 * surface to the loopback SPA: a manual "check for updates" that runs in the
 * main process (Node fetch, no CORS) and returns the latest release info plus a
 * download URL. The renderer stays sandboxed and remote; only this bridge and
 * the update check cross the process boundary.
 * @module @deepseek-ai/dsh-desktop/preload
 */

import { contextBridge, ipcRenderer } from 'electron'

/** The update-check result the SPA's About section renders. */
export interface UpdateCheckResult {
  readonly status: 'up-to-date' | 'update-available' | 'error'
  readonly current: string
  readonly latest?: string | undefined
  readonly notes?: string | undefined
  readonly url?: string | undefined
}

contextBridge.exposeInMainWorld('dshApp', {
  /** Ask the main process for the latest release; resolves the check result. */
  checkUpdate: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('check-update') as Promise<UpdateCheckResult>,
})
