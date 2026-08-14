/**
 * DeepSeek Harness desktop shell. The Electron main process is deliberately a
 * thin wrapper: it spawns the real `dsh` CLI running the `web` profile on
 * loopback (an OS-assigned port), parses the readiness URL line the profile
 * prints, and opens a native window at that address. The harness — its Cordis
 * plugins, webserver, static frontend dist, and WebSocket transport — is
 * untouched and runs exactly as `dsh web` would, as a separate Node process.
 *
 * Keeping the harness in its own system-Node child also keeps native addons
 * (e.g. the PTY used by the terminal capability) on the system Node ABI; the
 * Electron main and renderer never load them.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, dialog, BrowserWindow, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron'

import { LOOPBACK_HOST, parseReadyPort } from './ready-port.ts'
import type { UpdateCheckResult } from './preload.ts'

const require = createRequire(import.meta.url)

/**
 * URL of the release manifest hosted on OSS. Override per deployment with
 * DSH_UPDATE_URL. The manifest (releases.json) carries the latest version,
 * release notes, and per-platform installer URLs.
 */
const UPDATE_MANIFEST_URL = process.env.DSH_UPDATE_URL ?? 'https://deepseek.pinesound.cn/updates/releases.json'

/** The renderer's update-check IPC channel. */
const UPDATE_CHANNEL = 'check-update'

/** The renderer's static build-identity IPC channel. */
const APP_INFO_CHANNEL = 'get-app-info'

/** The release manifest published on OSS (`updates/releases.json`). */
interface ReleaseManifest {
  readonly latest: { readonly version: string; readonly date?: string }
  readonly releaseNotes?: string
  readonly platforms: Partial<Record<'mac-arm64' | 'mac-x64' | 'win-x64', { readonly url: string }>>
}

/** User-facing product name (the npm name is the scoped package id). */
const PRODUCT_NAME = 'DeepSeek Harness'

/** Window icon: the branded PNG in build/, resolved from this ES module's URL. */
const APP_ICON = fileURLToPath(new URL('../../build/icon.png', import.meta.url))

/** Renderer preload (compiled to lib/types/preload.js), resolved from this ES module's URL. */
const PRELOAD = fileURLToPath(new URL('./preload.js', import.meta.url))

/**
 * The self-contained harness runtime bundled into the packaged app by
 * electron-builder's `extraResources` (see electron-builder.yml): a copy of the
 * repository's working node_modules plus vendor/packages/native/apps and a
 * bundled Node binary, so the harness child runs on any machine with no
 * external install. In development the harness resolves from the workspace.
 */
function harnessRoot(): string | undefined {
  return app.isPackaged ? join(process.resourcesPath, 'harness') : undefined
}

/**
 * Install a Chinese application menu, replacing Electron's English default.
 * Roles carry the platform behavior (close, quit, zoom, DevTools, …); only the
 * visible labels are localized, so the accelerators stay the system defaults.
 */
function installAppMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
        label: PRODUCT_NAME,
        submenu: [
          { role: 'about', label: `关于 ${PRODUCT_NAME}` },
          { type: 'separator' },
          { role: 'services', label: '服务' },
          { type: 'separator' },
          { role: 'hide', label: `隐藏 ${PRODUCT_NAME}` },
          { role: 'hideOthers', label: '隐藏其他' },
          { role: 'unhide', label: '全部显示' },
          { type: 'separator' },
          { role: 'quit', label: `退出 ${PRODUCT_NAME}` },
        ],
      }] satisfies MenuItemConstructorOptions[]
      : []),
    {
      label: '文件',
      submenu: [
        isMac
          ? { role: 'close', label: '关闭窗口' }
          : { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        ...(isMac
          ? [{ type: 'separator' }, { role: 'front', label: '前置全部窗口' }] satisfies MenuItemConstructorOptions[]
          : []),
      ],
    },
    {
      label: '帮助',
      submenu: [
        { role: 'about', label: `关于 ${PRODUCT_NAME}` },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/**
 * Compare two version strings for "newer". Versions are `0.1.0-rc.N`; the
 * numeric `rc` suffix carries the order, so compare the trailing integer and
 * fall back to a plain string compare for non-rc builds.
 */
function isNewer(latest: string, current: string): boolean {
  const rc = (value: string): number => {
    const match = /rc\.(\d+)$/.exec(value)
    return match === null ? Number.NaN : Number(match[1])
  }
  const lrc = rc(latest)
  const crc = rc(current)
  if (Number.isFinite(lrc) && Number.isFinite(crc)) return lrc > crc
  return latest !== current
}

/** The per-platform download URL from a release manifest. */
function platformDownloadUrl(manifest: ReleaseManifest): string | undefined {
  const key = process.platform === 'win32' ? 'win-x64' : process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64'
  return manifest.platforms[key]?.url
}

/**
 * Fetch the release manifest and compare the latest version against the
 * running app. Returns an update-available result (with the download URL) when
 * a newer release exists; errors surface as `{ status: 'error' }` so the UI
 * never crashes on a transient network miss.
 * @returns the update-check result for the SPA and the startup prompt.
 */
async function checkForUpdate(): Promise<UpdateCheckResult> {
  const current = app.getVersion()
  try {
    const response = await fetch(UPDATE_MANIFEST_URL)
    if (!response.ok) throw new Error(`update manifest HTTP ${response.status}`)
    const manifest = (await response.json()) as ReleaseManifest
    const latest = manifest.latest.version
    if (!isNewer(latest, current)) return { status: 'up-to-date', current }
    return {
      status: 'update-available',
      current,
      latest,
      date: manifest.latest.date,
      notes: manifest.releaseNotes,
      url: platformDownloadUrl(manifest),
    }
  } catch (error) {
    return { status: 'error', current, notes: error instanceof Error ? error.message : String(error) }
  }
}

/** Spawn's node executable: a bundled one when the app is packaged, else PATH. */
function nodeExecutable(): string {
  const harness = harnessRoot()
  if (harness !== undefined) return join(harness, 'bin/node')
  if (process.env.DSH_NODE) return resolve(process.env.DSH_NODE)
  return 'node'
}

/** The dsh CLI entry to spawn: the bundled bin when packaged, else the built bin. */
function dshEntry(): string {
  const harness = harnessRoot()
  if (harness !== undefined) return join(harness, 'apps/cli/lib/bin.js')
  if (process.env.DSH_ENTRY) return resolve(process.env.DSH_ENTRY)
  return require.resolve('@deepseek-ai/dsh/lib/bin.js')
}

/** Open the harness window, wired to a live loopback port. */
function openWindow(url: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    title: PRODUCT_NAME,
    // The window icon matters on Linux/Windows; on macOS the dock and menu bar
    // use the packaged .app icon from electron-builder's build/icon.png.
    ...(existsSync(APP_ICON) ? { icon: APP_ICON } : {}),
    webPreferences: {
      // The UI is a remote SPA served by the harness; keep Node out of it. The
      // preload exposes only the update-check bridge (no direct Node access).
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: PRELOAD,
    },
  })
  void win.loadURL(url)
  return win
}

/** A spawned harness and the window bound to it. */
interface Session {
  child: ChildProcess
  url: string
  window: BrowserWindow
}

let session: Session | undefined

/** Fail loudly in the shell when the harness cannot start. */
function reportFatal(error: unknown): void {
  void dialog.showErrorBox(`${PRODUCT_NAME} 启动失败`, String(error))
  app.exit(1)
}

/** Spawn the web profile and open a window once its URL is known. */
function startSession(): void {
  const entry = dshEntry()
  const harness = harnessRoot()
  const child = spawn(nodeExecutable(), [entry, '--profile', 'web', '--host', LOOPBACK_HOST, '--port', '0'], {
    // Run the harness from its own root so relative path resolution is stable.
    cwd: harness,
    stdio: ['ignore', 'pipe', 'inherit'],
    // The desktop is the trusted surface that opts into plugin install.
    env: { ...process.env, DSH_TELEMETRY_DISABLED: '1', DSH_ALLOW_PLUGIN_INSTALL: '1' },
  })
  let settled = false
  let buffered = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffered += chunk
    // Only a COMPLETE line is trustworthy: the readiness port is not matched
    // until its newline arrives, so a chunk ending mid-number cannot open a
    // window at a truncated port.
    let newline: number
    while ((newline = buffered.indexOf('\n')) !== -1) {
      const line = buffered.slice(0, newline).trimEnd()
      buffered = buffered.slice(newline + 1)
      if (settled) return
      const port = parseReadyPort(line)
      if (port === undefined) continue
      settled = true
      const url = `http://${LOOPBACK_HOST}:${String(port)}`
      session = { child, url, window: openWindow(url) }
      return
    }
  })
  child.on('error', (error) => {
    if (!settled) reportFatal(`Could not start the harness:\n${error.message}`)
  })
  child.on('exit', (code) => {
    if (!settled) {
      settled = true
      reportFatal(`The harness exited before serving (code ${String(code)}). Is the frontend dist built?`)
    } else if (app.isReady()) {
      app.quit()
    }
  })
}

app.whenReady().then(() => {
  installAppMenu()
  // The SPA's About "check for updates" button asks the main process.
  ipcMain.handle(UPDATE_CHANNEL, () => checkForUpdate())
  // The SPA's About reads this build's version from the main process (no network).
  ipcMain.handle(APP_INFO_CHANNEL, () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    productName: PRODUCT_NAME,
  }))
  startSession()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && session !== undefined) {
      session.window = openWindow(session.url)
    }
  })
  // Manual-download update flow: check on startup (and hourly), and when a newer
  // release exists prompt to open the installer URL. No signing, so the user
  // downloads and installs by hand rather than an automatic swap.
  const promptUpdate = async (): Promise<void> => {
    const result = await checkForUpdate()
    if (result.status !== 'update-available' || result.url === undefined) return
    const { response } = await dialog.showMessageBox({
      type: 'info',
      message: `发现新版本 v${result.latest}`,
      detail: result.notes ?? '点击「去下载」获取最新安装包。',
      buttons: ['去下载', '稍后'],
      defaultId: 0,
      cancelId: 1,
    })
    if (response === 0) shell.openExternal(result.url).catch(() => {})
  }
  const checkAt = (delayMs: number): void => {
    setTimeout(() => { promptUpdate().catch(() => {}) }, delayMs)
  }
  checkAt(4000)
  const checkTimer = setInterval(() => { promptUpdate().catch(() => {}) }, 60 * 60 * 1000)
  app.on('will-quit', () => { clearInterval(checkTimer) })
})

app.on('window-all-closed', () => {
  // The harness owns the window lifecycle; on macOS keep the app until the
  // user quits, elsewhere exit when every window is gone.
  if (process.platform !== 'darwin') {
    session?.child.kill()
    app.quit()
  }
})
