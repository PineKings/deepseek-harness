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
  /** Release date of the newest release (YYYY-MM-DD), when the manifest supplies it. */
  readonly date?: string | undefined
  readonly notes?: string | undefined
  readonly url?: string | undefined
}

/** Static identity of this build, read from the main process (no network). */
export interface AppInfo {
  /** The packaged version (`app.getVersion()`). */
  readonly version: string
  /** Platform the app runs on (`process.platform`). */
  readonly platform: NodeJS.Platform
  /** CPU architecture (`process.arch`). */
  readonly arch: string
  /** User-facing product name. */
  readonly productName: string
}

contextBridge.exposeInMainWorld('dshApp', {
  /** Ask the main process for the latest release; resolves the check result. */
  checkUpdate: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('check-update') as Promise<UpdateCheckResult>,
  /** Ask the main process for this build's static identity (no network). */
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('get-app-info') as Promise<AppInfo>,
})
