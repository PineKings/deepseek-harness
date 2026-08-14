/**
 * Pure helpers behind the plugin-inventory install/uninstall Remotes.
 *
 * Offline bundle install composes an already-shipped optional bundle into the
 * profile's `dsh.profile.bundles` — a writable profile-manifest mutation with
 * no network or package manager. Registry install runs pnpm against the
 * writable profile directory via a bundled Node + vendored pnpm, then
 * reconciles the bundle layer list exactly as `dsh plugin add` does. All
 * functions are dependency-free of Cordis so they unit-test without a context.
 * @module @deepseek-ai/dsh-plugin-inventory/install
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  readProfileManifest,
  reconcileProfileBundles,
  resolveBundleDir,
  writeProfileManifest,
  type ProfileManifest,
} from '@deepseek-ai/dsh-app-boot'

/**
 * Registries to try, in order, for a registry plugin install. The install
 * attempts each until one succeeds; the official npm registry is the final
 * fallback, so a deployment reaches the package even when every mirror is
 * down. Add mirrors here (code-editable) to route installs through them.
 */
export const INSTALL_REGISTRIES: readonly string[] = [
  'https://registry.npmmirror.com',
  'https://registry.npmjs.org',
]

/**
 * Compose an offline optional bundle into the profile's bundle layer list.
 * Validates that the bundle resolves from the installation anchor (so a bad
 * name fails loud instead of silently corrupting the manifest), then appends
 * the name when absent. Persists only — the running tree is recomposed at the
 * next boot.
 * @param binName - the diagnostic prefix on thrown errors.
 * @param profileDir - the writable profile directory.
 * @param installAnchor - absolute path of a file inside the dsh app package.
 * @param name - the bundle package name to compose.
 */
export function composeOfflineBundle(
  binName: string, profileDir: string, installAnchor: string, name: string,
): void {
  resolveBundleDir(binName, name, installAnchor, profileDir)
  const manifest = readProfileManifest(binName, profileDir)
  const bundles = manifest.dsh?.profile?.bundles ?? []
  if (bundles.includes(name)) return
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: [...bundles, name] } }
  writeProfileManifest(profileDir, manifest)
}

/**
 * Remove an optional bundle from the profile's bundle layer list. Leaves the
 * installed dependency (if any) in place; a later `dsh plugin remove` handles
 * the package itself.
 * @param binName - the diagnostic prefix on thrown errors.
 * @param profileDir - the writable profile directory.
 * @param name - the bundle package name to un-compose.
 */
export function uninstallBundle(binName: string, profileDir: string, name: string): void {
  const manifest = readProfileManifest(binName, profileDir)
  const bundles = (manifest.dsh?.profile?.bundles ?? []).filter(bundle => bundle !== name)
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
  writeProfileManifest(profileDir, manifest)
}

/** Options for one pnpm install run. */
export interface PnpmInstallOptions {
  readonly binName: string
  readonly profileDir: string
  readonly installAnchor: string
  /** Absolute path of the Node executable to run pnpm with (the bundled node). */
  readonly nodeBin: string
  /** Absolute path of the pnpm CLI entry (pnpm.cjs). */
  readonly pnpmCjs: string
  /** The package specifier to install. */
  readonly spec: string
  /** The profile manifest read before the install, for reconciliation. */
  readonly before: ProfileManifest
  /** An npm registry to install from (`pnpm add --registry`); defaults to pnpm's configured one. */
  readonly registry?: string
}

/**
 * Run `pnpm add <spec>` in the profile directory via a bundled Node, then
 * reconcile `dsh.profile.bundles` against the installed state. Throws when the
 * package manager fails (nonzero exit or spawn error).
 * @param options - the run options.
 */
export function runPnpmInstall(options: PnpmInstallOptions): void {
  const { binName, profileDir, installAnchor, nodeBin, pnpmCjs, spec, before, registry } = options
  const args = registry === undefined
    ? [pnpmCjs, 'add', spec]
    : [pnpmCjs, 'add', spec, '--registry', registry]
  const result = spawn(nodeBin, args, profileDir)
  if (result.exitCode !== 0) {
    throw new Error(`${binName}: pnpm install failed with exit code ${result.exitCode}`)
  }
  reconcileProfileBundles(binName, before, profileDir, installAnchor)
}

/**
 * Run `pnpm add` trying each registry in {@link INSTALL_REGISTRIES} until one
 * succeeds (the first success wins). The official registry is last, so a
 * deployment falls back to it when every mirror is down; throws with the last
 * error only when every registry fails.
 * @param options - the run options (without a fixed `registry`).
 * @param registries - the ordered registries to try (defaults to
 * {@link INSTALL_REGISTRIES}).
 */
export function runPnpmInstallWithRegistries(
  options: Omit<PnpmInstallOptions, 'registry'>,
  registries: readonly string[] = INSTALL_REGISTRIES,
): void {
  let lastError: unknown
  for (const registry of registries) {
    try {
      runPnpmInstall({ ...options, registry })
      return
    } catch (error) {
      lastError = error
    }
  }
  // The install path only throws Errors, so the non-Error formatting is defensive.
  /* v8 ignore next */
  throw new Error(
    `${options.binName}: plugin install failed across all registries; last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  )
}

/** Spawn one synchronous child and return its exit code (0 on success). */
function spawn(command: string, args: readonly string[], cwd: string): { exitCode: number } {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error !== undefined) {
    throw result.error
  }
  // On a successful spawn status is always a number; null coincides with the
  // spawn-error path above, so the fallback is unreachable.
  /* v8 ignore next */
  return { exitCode: result.status ?? 1 }
}

/**
 * Locate the pnpm CLI bundled into the harness. Honors a `DSH_PNPM` override,
 * then looks for the vendored pnpm beside the bundled Node's harness root.
 * @param nodeBin - the bundled Node executable path (`process.execPath`).
 * @param env - the process environment.
 * @returns the pnpm.cjs path, or undefined when none is vendored.
 */
export function resolvePnpm(nodeBin: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.DSH_PNPM) return env.DSH_PNPM
  // nodeBin is harness/bin/node in the packaged app, so the harness root is
  // one level up from bin/; pnpm is vendored under harness/pnpm/.
  const harnessRoot = resolve(dirname(nodeBin), '..')
  const candidate = join(harnessRoot, 'pnpm', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
  return existsSync(candidate) ? candidate : undefined
}
