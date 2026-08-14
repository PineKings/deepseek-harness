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
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { app, dialog, BrowserWindow } from 'electron'

import { LOOPBACK_HOST, parseReadyPort } from './ready-port.ts'

const require = createRequire(import.meta.url)

/** Spawn's node executable: a bundled one when the app is packaged, else PATH. */
function nodeExecutable(): string {
  if (process.env.DSH_NODE) return resolve(process.env.DSH_NODE)
  return 'node'
}

/** The dsh CLI entry to spawn: an explicit dev override, else the built bin. */
function dshEntry(): string {
  if (process.env.DSH_ENTRY) return resolve(process.env.DSH_ENTRY)
  return require.resolve('@deepseek-ai/dsh/lib/bin.js')
}

/** Open the harness window, wired to a live loopback port. */
function openWindow(url: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    title: 'DeepSeek Harness',
    webPreferences: {
      // The UI is a remote SPA served by the harness; keep Node out of it.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
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
  void dialog.showErrorBox('DeepSeek Harness failed to start', String(error))
  app.exit(1)
}

/** Spawn the web profile and open a window once its URL is known. */
function startSession(): void {
  const entry = dshEntry()
  const child = spawn(nodeExecutable(), [entry, '--profile', 'web', '--host', LOOPBACK_HOST, '--port', '0'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, DSH_TELEMETRY_DISABLED: '1' },
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
  startSession()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && session !== undefined) {
      session.window = openWindow(session.url)
    }
  })
})

app.on('window-all-closed', () => {
  // The harness owns the window lifecycle; on macOS keep the app until the
  // user quits, elsewhere exit when every window is gone.
  if (process.platform !== 'darwin') {
    session?.child.kill()
    app.quit()
  }
})
