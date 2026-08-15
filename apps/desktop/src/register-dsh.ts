/**
 * Register the bundled `dsh` CLI on the system PATH so the user can run
 * `dsh plugin ...` from any terminal after the app is installed.
 *
 * The harness ships a `dsh` launcher (see scripts/build-harness.mjs) that execs
 * the bundled Node against the CLI entry, so a `dsh` on PATH needs no external
 * Node or pnpm. Registration is platform-specific and best-effort:
 *
 * - **macOS**: symlink the harness `dsh` launcher into `/usr/local/bin` (on PATH
 *   by default). `/usr/local/bin` is root-owned on modern macOS and commonly
 *   not user-writable, so an unwritable primary falls back to the user-writable
 *   `~/.local/bin` and idempotently puts that directory on PATH via the user's
 *   shell profile (`~/.zshrc`, `~/.bash_profile`, `~/.profile`).
 * - **Windows**: write a `dsh.cmd` shim into the harness and register the harness
 *   directory in the user PATH (`HKCU\Environment`).
 *
 * An existing `dsh` that is not ours is always left untouched. The pure helpers
 * (`buildDshCmd`, `appendToUserPath`, `linkDsh`) are testable on any host; the
 * registry write and shell-profile edit run only on their platform.
 * @module @deepseek-ai/dsh-desktop/register-dsh
 */

import { spawnSync } from 'node:child_process'
import {
  appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Where the `dsh` command should live on macOS (on PATH by default). */
export const MACOS_BIN_DIR = '/usr/local/bin'

/** The user-writable fallback directory on macOS. */
export const MACOS_USER_BIN_DIR = join(homedir(), '.local', 'bin')

/** Outcome of a launcher registration attempt. */
export type DshRegistration =
  | { readonly status: 'registered'; readonly path: string; readonly created: boolean }
  | { readonly status: 'already-present'; readonly path: string }
  | { readonly status: 'skipped' }
  | { readonly status: 'error'; readonly detail: string }

/**
 * Register the `dsh` launcher on PATH for the current platform. No-op on
 * unsupported platforms.
 * @param harnessDir - the packaged harness root (`process.resourcesPath/harness`).
 * @param binDir - the primary macOS bin dir; overridable for tests.
 * @param fallbackDir - the user-writable macOS fallback; overridable for tests.
 * @param ensurePath - put the fallback dir on PATH via the shell profile (macOS only).
 * @returns the registration outcome.
 */
export function registerDshLauncher(
  harnessDir: string,
  binDir: string = MACOS_BIN_DIR,
  fallbackDir: string = MACOS_USER_BIN_DIR,
  ensurePath = true,
): DshRegistration {
  if (process.platform === 'win32') return registerWindowsDsh(harnessDir)
  if (process.platform === 'darwin') return registerDarwinDsh(harnessDir, binDir, fallbackDir, ensurePath)
  return { status: 'skipped' }
}

/** macOS: symlink into the primary dir, falling back to a user-writable dir. */
function registerDarwinDsh(harnessDir: string, binDir: string, fallbackDir: string, ensurePath: boolean): DshRegistration {
  const launcher = join(harnessDir, 'dsh')
  const preferred = linkDsh(launcher, binDir)
  if (preferred.status !== 'error') return preferred
  // The primary is unwritable (root-owned /usr/local/bin on modern macOS):
  // register into a user-writable dir and put that dir on PATH via the shell
  // profile, so `dsh` resolves in a new terminal without admin rights.
  const fallback = linkDsh(launcher, fallbackDir)
  if (fallback.status === 'error') {
    return { status: 'error', detail: `${preferred.detail} and ${fallback.detail}` }
  }
  if (ensurePath) ensureUserDirOnPath(fallbackDir)
  return fallback
}

/**
 * Symlink `launcher` into `binDir`. Idempotent: a link already pointing at our
 * launcher is confirmed (`created: false`); an existing entry that is not ours
 * is left untouched; a created link reports `created: true`.
 */
export function linkDsh(launcher: string, binDir: string): DshRegistration {
  const link = join(binDir, 'dsh')
  let stat
  try {
    stat = lstatSync(link)
  } catch {
    stat = undefined
  }
  if (stat !== undefined) {
    if (stat.isSymbolicLink()) {
      return readlinkSync(link) === launcher
        ? { status: 'registered', path: link, created: false }
        : { status: 'already-present', path: link }
    }
    return { status: 'already-present', path: link }
  }
  if (!existsSync(launcher)) return { status: 'skipped' }
  try {
    mkdirSync(binDir, { recursive: true })
    symlinkSync(launcher, link)
    return { status: 'registered', path: link, created: true }
  } catch (error) {
    return { status: 'error', detail: error instanceof Error ? error.message : String(error) }
  }
}

/** Ensure `dir` is exported on PATH in the user's shell profiles (idempotent). */
function ensureUserDirOnPath(dir: string): void {
  const line = `export PATH="${dir}:$PATH"  # dsh (DeepSeek Harness)`
  for (const rc of ['.zshrc', '.zprofile', '.bash_profile', '.profile']) {
    const path = join(homedir(), rc)
    let content: string
    try {
      content = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    if (content.includes('# dsh (DeepSeek Harness)')) continue
    try {
      appendFileSync(path, `\n${line}\n`)
    } catch {
      // A read-only or otherwise unopenable profile is not fatal.
    }
  }
}

/**
 * Windows: write a `dsh.cmd` shim into the harness and add the harness
 * directory to the user PATH so `dsh` resolves in a new shell.
 */
function registerWindowsDsh(harnessDir: string): DshRegistration {
  const nodeExe = join(harnessDir, 'bin', 'node.exe')
  if (!existsSync(nodeExe)) {
    // The harness was built without a Windows Node (`bin/node.exe`); nothing
    // to shim against.
    return { status: 'skipped' }
  }
  try {
    writeFileSync(join(harnessDir, 'dsh.cmd'), buildDshCmd(), 'utf8')
  } catch (error) {
    return { status: 'error', detail: error instanceof Error ? error.message : String(error) }
  }
  const current = readUserPath()
  if (current === null) return { status: 'error', detail: 'could not read the user PATH' }
  const merged = appendToUserPath(current, harnessDir)
  if (merged === current) return { status: 'registered', path: join(harnessDir, 'dsh.cmd'), created: false }
  return writeUserPath(merged) ? { status: 'registered', path: join(harnessDir, 'dsh.cmd'), created: true } : { status: 'error', detail: 'could not write the user PATH' }
}

/**
 * The Windows `dsh.cmd` shim: run the bundled Node against the CLI entry with
 * the caller's arguments. `%~dp0` resolves to the harness directory.
 */
export function buildDshCmd(): string {
  return '@echo off\r\n"%~dp0bin\\node.exe" "%~dp0apps\\cli\\lib\\bin.js" %*\r\n'
}

/**
 * Merge a directory into a `Path` value, appending it when absent
 * (case-insensitive). Returns the input unchanged when already present.
 * @param path - the existing PATH value.
 * @param dir - the directory to ensure is on PATH.
 * @returns the merged PATH value.
 */
export function appendToUserPath(path: string, dir: string): string {
  const lower = dir.toLocaleLowerCase()
  if (path.split(';').some(part => part.toLocaleLowerCase() === lower)) return path
  return path.endsWith(';') ? `${path}${dir}` : `${path};${dir}`
}

/** Read the current user PATH value (`HKCU\Environment` → `Path`), or null. */
function readUserPath(): string | null {
  const result = spawnSync('reg', ['query', 'HKCU\\Environment', '/v', 'Path'], { encoding: 'utf8' })
  if (result.status !== 0) return null
  const lines = (result.stdout ?? '').split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/.exec(lines[index] ?? '')
    if (match !== null) return match[1] ?? null
  }
  return null
}

/** Overwrite the user PATH value (`HKCU\Environment` → `Path`), preserving expansion. */
function writeUserPath(value: string): boolean {
  const result = spawnSync(
    'reg',
    ['add', 'HKCU\\Environment', '/v', 'Path', '/t', 'REG_EXPAND_SZ', '/d', value, '/f'],
    { encoding: 'utf8' },
  )
  return result.status === 0
}
