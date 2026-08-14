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

import { cpSync, chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs'
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

// Bundle the platform Node binary for the harness child.
const nodeBin = execFileSync('node', ['-e', 'process.stdout.write(process.execPath)']).toString()
if (!existsSync(nodeBin)) throw new Error(`node executable not found: ${nodeBin}`)
cpSync(nodeBin, join(out, 'bin/node'))
chmodSync(join(out, 'bin/node'), 0o755)

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

console.log(`assembled self-contained harness at ${out}`)
