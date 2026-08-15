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
 * Run from the repository root before `desktop:pack`.
 */

import { cpSync, chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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

console.log(`assembled self-contained harness at ${out}`)
