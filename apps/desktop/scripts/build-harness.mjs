#!/usr/bin/env node
/**
 * Assemble the self-contained harness runtime for the packaged app.
 *
 * The harness's pnpm workspace does not cleanly materialize via `pnpm deploy` or
 * electron-builder's dependency resolution (per-package symlinks to vendored
 * packages, native addons, a separate frontend dist). The only known-good
 * runtime is the repository's own working tree, so this copies the parts the
 * harness needs at the same relative layout — node_modules, vendor, packages,
 * native, apps/cli, apps/web — plus the platform Node binary, into
 * `build/harness`, which electron-builder ships as `extraResources`.
 *
 * The packaged harness must stay fully self-contained: the app is not a mere
 * launcher, it must let users in the most barren environments use dsh entirely
 * through the app. We therefore copy the whole workspace node_modules and then
 * prune a curated, VERIFIED-safe exclusion list (see pruneNodeModules below and
 * `scripts/harness-excludes.json`). Nothing is excluded unless it is provably
 * outside the dsh runtime dependency closure.
 *
 * Run from the repository root before `desktop:pack`.
 */

import { cpSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const out = join(root, 'apps/desktop/build/harness')

// Dirs whose relative layout must be preserved so node_modules symlinks resolve.
const harnessDirs = ['node_modules', 'vendor', 'packages', 'native']
const extraDirs = [['apps/cli', 'apps/cli'], ['apps/web', 'apps/web']]

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'apps'), { recursive: true })
mkdirSync(join(out, 'bin'), { recursive: true })

for (const d of harnessDirs) {
  const src = join(root, d)
  if (existsSync(src)) cpSync(src, join(out, d), { recursive: true })
}
for (const [src, dst] of extraDirs) {
  cpSync(join(root, src), join(out, dst), { recursive: true })
}

// Prune verified-safe build/packaging tooling out of the copied node_modules.
// This is the ONLY sanctioned way to shrink the self-contained runtime: every
// exclusion is validated against the dependency closure of the kept packages
// and refused if any kept package depends on it.
pruneNodeModules(join(out, 'node_modules'))

// Bundle the platform Node binary for the harness child. Windows needs a
// `.exe` extension so both the child spawn and the `dsh.cmd` shim can execute
// it; POSIX uses a bare `node`.
const nodeBin = execFileSync('node', ['-e', 'process.stdout.write(process.execPath)']).toString()
if (!existsSync(nodeBin)) throw new Error(`node executable not found: ${nodeBin}`)
const nodeFile = process.platform === 'win32' ? 'node.exe' : 'node'
cpSync(nodeBin, join(out, 'bin', nodeFile))
chmodSync(join(out, 'bin', nodeFile), 0o755)

// Vendor pnpm so the packaged app can install third-party plugins without pnpm
// on the target machine. npm ships with Node, so use it on the build machine
// (which has network); a failure only disables registry install, never the
// offline bundle install, so warn rather than abort.
try {
  execFileSync('npm', ['install', '--prefix', join(out, 'pnpm'), 'pnpm@11.7.0'], { stdio: 'pipe' })
  console.log('vendored pnpm into harness')
} catch {
  console.warn('could not vendor pnpm; registry plugin install will be unavailable in the packaged app')
}

// A `dsh` launcher so a user can run the bundled CLI from a terminal outside
// the app (`dsh plugin --profile web add <spec>`, …). It execs the bundled node
// against the CLI entry, so the vendored pnpm is picked up automatically and no
// Node/pnpm install is needed on the target. POSIX ships an executable `dsh`
// shell script; Windows ships a `dsh.cmd` shim (the desktop registers the
// harness directory on the user PATH on first launch).
//
// The POSIX launcher resolves its own real path through symlinks before looking
// up `bin/node` and `apps/cli/lib/bin.js`: the desktop registers `dsh` on PATH
// as a symlink into a bin dir, so a bare `dirname "$0"` would resolve to the
// link's directory (no siblings there). `readlink -f` is unavailable on macOS,
// so resolve portably with the readlink loop below. `dsh.cmd` needs no such
// handling because `%~dp0` already expands to the real script location.
if (process.platform === 'win32') {
  writeFileSync(
    join(out, 'dsh.cmd'),
    '@echo off\r\n"%~dp0bin\\node.exe" "%~dp0apps\\cli\\lib\\bin.js" %*\r\n',
  )
} else {
  const dshLauncher = join(out, 'dsh')
  writeFileSync(
    dshLauncher,
    '#!/bin/sh\nSELF="$0"\nwhile [ -h "$SELF" ]; do\n  DIR=$(cd "$(dirname "$SELF")" && pwd)\n  LINK=$(readlink "$SELF")\n  case "$LINK" in /*) SELF="$LINK";; *) SELF="$DIR/$LINK";; esac\ndone\nDIR=$(cd "$(dirname "$SELF")" && pwd)\nexec "$DIR/bin/node" "$DIR/apps/cli/lib/bin.js" "$@"\n',
  )
  chmodSync(dshLauncher, 0o755)
}

/**
 * Remove the curated build/packaging-time packages from a copied pnpm
 * `node_modules`. Safe by construction:
 *
 *   1. Reads `scripts/harness-excludes.json` — a visible, configurable list of
 *      package names + reasons (users add/remove entries without touching the
 *      copy logic).
 *   2. For each exclusion, walks every KEPT `.pnpm/<pkg>@<ver>` entry and checks
 *      whether any kept package symlinks this name as a dependency. If so, the
 *      exclusion is REFUSED (throws) — the runtime must stay whole.
 *   3. If safe, deletes the `.pnpm/<name>@*` entries, the top-level
 *      `node_modules/<name>` link, and any `.bin` shims that pointed into them,
 *      reporting bytes freed per entry and a total.
 */
function pruneNodeModules(nmDir) {
  const cfgPath = join(root, 'apps/desktop/scripts/harness-excludes.json')
  if (!existsSync(cfgPath)) return
  const { excludes } = JSON.parse(readFileSync(cfgPath, 'utf8'))
  if (!Array.isArray(excludes) || excludes.length === 0) return

  // De-dupe by name so a duplicate config entry can't double-report or double-count.
  const unique = new Map()
  for (const e of excludes) if (e && e.name && !unique.has(e.name)) unique.set(e.name, e)
  const list = [...unique.values()]

  const pnpmDir = join(nmDir, '.pnpm')
  if (!existsSync(pnpmDir)) return
  const entries = readdirSync(pnpmDir)

  // All packages that will be removed — used to ignore cross-excluded refs
  // during the safety check (a dependency among two removed packages is fine).
  const excludedSet = new Set(list.map((e) => e.name))

  // Package name of a .pnpm entry. Entries look like "name@1.0.0" for a bare
  // package or "@scope+name@1.0.0" for a scoped one, but peer-dependency
  // suffixes add further "@"s (e.g. "dmg-builder@25.1.8_peer@25.1.8"). Parse
  // from the FIRST "@" — the base name never contains one after the version
  // separator — so peer suffixes can't leak into the parsed name.
  const entryPkg = (entry) => {
    const at = entry.indexOf('@')
    if (at === -1) return entry
    if (at === 0) {
      const rest = entry.slice(1) // "@scope+name@ver..." -> "scope+name@ver..."
      const sep = rest.indexOf('@')
      const name = sep === -1 ? rest : rest.slice(0, sep)
      return '@' + name.replace('+', '/')
    }
    return entry.slice(0, at)
  }

  let totalFreed = 0

  for (const ex of list) {
    const name = ex.name
    if (excludedSet.size === 0) continue

    // --- 2. Safety: does any KEPT package depend on this package? ---
    const dependents = []
    for (const entry of entries) {
      const ep = entryPkg(entry)
      if (ep === name || excludedSet.has(ep)) continue // itself or also excluded
      const depDir = join(pnpmDir, entry, 'node_modules')
      if (!existsSync(depDir)) continue
      if (readdirSync(depDir).includes(name)) dependents.push(ep)
    }
    if (dependents.length > 0) {
      throw new Error(
        `[harness-excludes] REFUSING to exclude "${name}": kept packages depend on it ` +
          `(${dependents.join(', ')}). The runtime must stay whole — remove it from ` +
          `${cfgPath} or it is not actually safe to exclude.`,
      )
    }

    // --- 3. Delete the .pnpm store entries for this package ---
    const matching = entries.filter((e) => entryPkg(e) === name)
    for (const m of matching) {
      const p = join(pnpmDir, m)
      const sz = dirSize(p)
      rmSync(p, { recursive: true, force: true })
      totalFreed += sz
      console.log(`  [exclude] ${name} — removed .pnpm/${m} (${fmtSize(sz)})`)
    }

    // --- 4. Delete the top-level link/dir (node_modules/@scope/name too) ---
    const top = join(nmDir, ...name.split('/'))
    if (existsSync(top)) {
      const sz = dirSize(top)
      rmSync(top, { recursive: true, force: true })
      totalFreed += sz
      console.log(`  [exclude] ${name} — removed top-level link (${fmtSize(sz)})`)
    }

    // --- 5. Drop .bin shims that pointed into the removed store entries ---
    removeBinShims(join(nmDir, '.bin'), matching, pnpmDir)
  }

  if (totalFreed > 0) {
    console.log(
      `\n[harness-excludes] freed ${fmtSize(totalFreed)} by excluding ` +
        `${list.map((e) => e.name).join(', ')} (config: ${cfgPath})`,
    )
  }
}

/** Recursive size of a dir or link target. Symlinks are counted as 0 bytes and
 *  never followed (a pnpm store is full of links; following would loop). */
function dirSize(p) {
  let st
  try {
    st = lstatSync(p)
  } catch {
    return 0
  }
  if (st.isSymbolicLink() || st.isFile()) return st.size
  if (!st.isDirectory()) return 0
  let total = 0
  for (const child of readdirSync(p)) total += dirSize(join(p, child))
  return total
}

/** Remove `.bin` shims whose resolved target lives inside any removed store
 *  entry, so no dangling executables remain. */
function removeBinShims(binDir, removedEntries, pnpmDir) {
  if (!existsSync(binDir)) return
  const removedStoreDirs = removedEntries.map((e) => join(pnpmDir, e))
  for (const shim of readdirSync(binDir)) {
    const p = join(binDir, shim)
    let target
    try {
      target = readlinkSync(p)
    } catch {
      continue // not a symlink (e.g. a real .cmd file) — leave it
    }
    const resolved = resolve(binDir, target)
    if (removedStoreDirs.some((d) => resolved.startsWith(d))) {
      rmSync(p, { recursive: true, force: true })
    }
  }
}

/** Human-readable byte size, e.g. "553 MiB". */
function fmtSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${bytes} B`
}

console.log(`assembled self-contained harness at ${out}`)
