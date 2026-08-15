/**
 * Pure helpers behind the plugin-inventory install/uninstall Remotes.
 *
 * Offline bundle install composes an already-shipped optional bundle into the
 * profile's `dsh.profile.bundles` — a writable profile-manifest mutation with
 * no network or package manager. Registry install runs pnpm against the
 * writable profile directory via a bundled Node + vendored pnpm, then
 * reconciles the bundle layer list exactly as `dsh plugin add` does. All
 * functions are dependency-free of Cordis so they unit-test without a context.
 *
 * pnpm 11 blocks dependency build scripts by default and refuses to install
 * registry packages published too recently, so a `pnpm add` can fail for
 * reasons the caller must turn into a user decision. The install helpers
 * surface a blocked build as a parseable `pendingBuilds` result instead of a
 * throw; consenting re-runs `pnpm approve-builds` for exactly those packages
 * before retrying the add.
 * @module @deepseek-ai/dsh-plugin-inventory/install
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dump, load } from 'js-yaml'
import {
  readProfileManifest,
  reconcileProfileBundles,
  resolveBundleDir,
  resolvePnpm,
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

/** What a single pnpm add run concluded. */
export interface PnpmAddResult {
  /**
   * Build scripts pnpm refused to run. The install did not complete; the
   * caller should ask the user and retry with `writeAllowBuilds` first.
   */
  readonly pendingBuilds?: readonly string[]
}

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

/**
 * The bare package name when `spec` is a registry specifier, else undefined.
 * Registry specs are bare names with an optional version/tag suffix
 * (`name`, `name@1.0.0`, `@scope/name@next`). Everything pnpm treats as a
 * non-registry source — paths, `file:`/`link:`/`github:`/`git+` prefixes,
 * tarball paths and archive URLs, git hosts — is not a registry spec. Only a
 * registry spec participates in the `--registry` fallback loop and the
 * `minimumReleaseAge` exemption, both of which are meaningless for a git or
 * filesystem source.
 * @param spec - the pnpm specifier verbatim.
 * @returns the bare package name for a registry spec, else undefined.
 */
export function registryPackageName(spec: string): string | undefined {
  const trimmed = spec.trim()
  if (trimmed.length === 0) return undefined
  if (/^(?:file:|link:|github:|gitlab:|bitbucket:|git\+|git@)/.test(trimmed)) return undefined
  if (/^(?:\.{1,2}|~|[/\\])/.test(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed)) return undefined
  // A tarball or archive: ends in .tgz / .tar.gz (allowing query/fragment).
  if (/\.(?:tgz|tar\.gz)(?:[?#]|$)/.test(trimmed)) return undefined
  // An http(s) URL with at least one path segment (repo URL, archive URL, git).
  if (/^https?:\/\//.test(trimmed) && trimmed.replace(/^https?:\/\//, '').split('/').length > 1) return undefined
  // A `.git` marker (optionally with a #branch / @ref): a git checkout spec.
  if (/\.git(?:[#@]|$)/.test(trimmed)) return undefined
  // Strip a trailing version/tag (`@<version>`), whose part has no `/` — the
  // scope separator always does — so `@scope/name@1.0.0` → `@scope/name`.
  return trimmed.replace(/@[^/@]+$/, '')
}

/**
 * Extract the packages whose build scripts pnpm refused to run from captured
 * pnpm output. pnpm reports a blocked build as `ERR_PNPM_IGNORED_BUILDS` with
 * a message naming the packages; matching the message line is the stable
 * signal. Returns undefined when the output shows no blocked build, so a plain
 * failure stays an ordinary error.
 * @param output - the combined stdout/stderr of the pnpm run.
 * @returns the blocked package names, or undefined when no build was blocked.
 */
export function parseBlockedBuilds(output: string): readonly string[] | undefined {
  const match = /Ignored build scripts:\s*([^\r\n]+)/.exec(output)
  const namesText = match?.[1]
  if (namesText === undefined) return undefined
  const names = namesText.split(',').map(name => name.trim()).filter(name => name.length > 0)
  return names.length > 0 ? names : undefined
}

/** Options for one pnpm install run. */
export interface PnpmInstallOptions {
  readonly binName: string
  readonly profileDir: string
  readonly installAnchor: string
  /**
   * The Node executable to run `pnpmCjs` under; `undefined` when `pnpmCjs` is a
   * command on PATH (the `pnpm` fallback), which spawn() then runs directly.
   */
  readonly nodeBin: string | undefined
  /** The vendored pnpm.cjs path, or the `pnpm` command on PATH. */
  readonly pnpmCjs: string
  /** The package specifier to install. */
  readonly spec: string
  /** The profile manifest read before the install, for reconciliation. */
  readonly before: ProfileManifest
  /** An npm registry to install from (`pnpm add --registry`); defaults to pnpm's configured one. */
  readonly registry?: string
  /** A bare registry package name to exempt from pnpm's minimum-release-age check. */
  readonly minimumReleaseAgeExclude?: string
}

/**
 * Run `pnpm add <spec>` in the profile directory via the resolved pnpm, then
 * reconcile `dsh.profile.bundles` against the installed state. A run whose
 * build scripts were blocked returns them as `pendingBuilds` instead of
 * throwing — the caller asks the user and retries after `writeAllowBuilds`.
 * Any other nonzero exit throws.
 * @param options - the run options.
 * @returns `pendingBuilds` when pnpm blocked build scripts, else an empty result.
 */
export function runPnpmInstall(options: PnpmInstallOptions): PnpmAddResult {
  const { binName, profileDir, installAnchor, nodeBin, pnpmCjs, spec, before, registry, minimumReleaseAgeExclude } = options
  const args = ['add', spec]
  if (registry !== undefined) args.push('--registry', registry)
  // `--minimum-release-age-exclude` is understood only by pnpm ≥10.7. It is safe
  // with the vendored pnpm (pinned 11.7); a PATH-pnpm fallback in a development
  // checkout may be older and reject the option, so skip it there.
  if (minimumReleaseAgeExclude !== undefined && nodeBin !== undefined) {
    args.push(`--minimum-release-age-exclude=${minimumReleaseAgeExclude}`)
  }
  const result = nodeBin === undefined ? spawn(pnpmCjs, args, profileDir) : spawn(nodeBin, [pnpmCjs, ...args], profileDir)
  if (result.exitCode !== 0) {
    const pendingBuilds = parseBlockedBuilds(result.output)
    if (pendingBuilds !== undefined) return { pendingBuilds }
    // Surface pnpm's own output so the real cause (a missing package, a build
    // failure, a registry error) is diagnosable instead of an opaque exit code.
    throw new Error(`${binName}: pnpm install failed with exit code ${result.exitCode}${truncateOutput(result.output)}`)
  }
  reconcileProfileBundles(binName, before, profileDir, installAnchor)
  return {}
}

/** Compact a child's captured output for an error message (first 400 chars). */
function truncateOutput(output: string): string {
  const trimmed = output.trim()
  if (trimmed.length === 0) return ''
  return trimmed.length <= 400 ? `: ${trimmed}` : `: ${trimmed.slice(0, 400)}…`
}

/**
 * Run `pnpm add` trying each registry in {@link INSTALL_REGISTRIES} until one
 * succeeds (the first success wins). A blocked build returns immediately — the
 * same build would block on every registry, so a consent decision precedes any
 * retry. The official registry is last, so a deployment falls back to it when
 * every mirror is down; throws with the last error only when every registry
 * fails with an ordinary error.
 * @param options - the run options (without a fixed `registry`).
 * @param registries - the ordered registries to try (defaults to
 * {@link INSTALL_REGISTRIES}).
 */
export function runPnpmInstallWithRegistries(
  options: Omit<PnpmInstallOptions, 'registry'>,
  registries: readonly string[] = INSTALL_REGISTRIES,
): PnpmAddResult {
  let lastError: unknown
  for (const registry of registries) {
    try {
      // A blocked build is source-independent: surface it without trying more
      // registries (the same build would block on every registry).
      return runPnpmInstall({ ...options, registry })
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

/** The pnpm workspace settings a fresh profile needs alongside an allowlist. */
const PROFILE_WORKSPACE_BASE: Record<string, unknown> = {
  packages: ['.'],
  nodeLinker: 'hoisted',
  autoInstallPeers: false,
}

/**
 * Allow the build scripts of the given packages by writing the per-package
 * `allowBuilds` map (pnpm ≥11) and `onlyBuiltDependencies` array (pnpm 10) into
 * the profile's `pnpm-workspace.yaml`. Writing the config directly is
 * deterministic: unlike `pnpm approve-builds`, it does not depend on the
 * packages being in pnpm's pending-build state, so it works even when an
 * install aborted before those packages materialized. Existing workspace
 * settings are preserved and existing allowlist entries are merged.
 * @param profileDir - the writable profile directory.
 * @param names - the packages whose build scripts the user consented to run.
 */
export function writeAllowBuilds(profileDir: string, names: readonly string[]): void {
  const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
  let doc: Record<string, unknown>
  try {
    const parsed = load(readFileSync(workspacePath, 'utf8'))
    doc = parsed !== null && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : { ...PROFILE_WORKSPACE_BASE }
  } catch {
    doc = { ...PROFILE_WORKSPACE_BASE }
  }
  const allowBuilds = (doc.allowBuilds ?? {}) as Record<string, unknown>
  const onlyBuilt = new Set<string>((doc.onlyBuiltDependencies ?? []) as string[])
  for (const name of names) {
    allowBuilds[name] = true
    onlyBuilt.add(name)
  }
  doc.allowBuilds = allowBuilds
  doc.onlyBuiltDependencies = [...onlyBuilt]
  writeFileSync(workspacePath, dump(doc))
}

/** Options for removing one plugin dependency. */
export interface PnpmRemoveOptions {
  readonly binName: string
  readonly profileDir: string
  readonly installAnchor: string
  /** The Node executable to run `pnpmCjs` under; `undefined` spawns `pnpmCjs` directly. */
  readonly nodeBin: string | undefined
  /** The vendored pnpm.cjs path, or the `pnpm` command on PATH. */
  readonly pnpmCjs: string
  /** The dependency name to remove. */
  readonly spec: string
  /** The profile manifest read before the removal, for reconciliation. */
  readonly before: ProfileManifest
}

/**
 * Run `pnpm remove <spec>` in the profile directory via the resolved pnpm, then
 * reconcile `dsh.profile.bundles` against the installed state — a removed
 * dependency that had been a bundle layer leaves the layer stack too. Throws
 * when the removal fails.
 * @param options - the removal run options.
 */
export function runPnpmRemove(options: PnpmRemoveOptions): void {
  const { binName, profileDir, installAnchor, nodeBin, pnpmCjs, spec, before } = options
  const result = nodeBin === undefined
    ? spawn(pnpmCjs, ['remove', spec], profileDir)
    : spawn(nodeBin, [pnpmCjs, 'remove', spec], profileDir)
  if (result.exitCode !== 0) {
    throw new Error(`${binName}: pnpm remove failed with exit code ${result.exitCode}`)
  }
  reconcileProfileBundles(binName, before, profileDir, installAnchor)
}

/** Captured outcome of one synchronous child run. */
interface SpawnResult {
  readonly exitCode: number
  /** Combined stdout and stderr, decoded as UTF-8. */
  readonly output: string
}

/**
 * Spawn one synchronous child and return its exit code and captured output.
 * Output is captured so a blocked build can be parsed back out; on a successful
 * spawn status is always a number, so the fallback is unreachable. The child
 * runs with a non-interactive git environment so a first-time git clone never
 * hangs on a terminal prompt under the piped install subprocess.
 */
function spawn(command: string, args: readonly string[], cwd: string): SpawnResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: gitNonInteractiveEnv(),
  })
  if (result.error !== undefined) {
    throw result.error
  }
  const output = `${result.stdout}${result.stderr}`
  /* v8 ignore next */
  return { exitCode: result.status ?? 1, output }
}

/**
 * The child environment with git forced non-interactive. A first-time git
 * source (`github:...`, `git+ssh://...`) prompts "Are you sure you want to
 * continue connecting (yes/no)?" for an unknown SSH host key; under a piped
 * install subprocess there is no terminal to answer, so the clone hangs or
 * dies. `GIT_SSH_COMMAND` with `StrictHostKeyChecking=accept-new` auto-accepts
 * a new host key (the "yes"), while `BatchMode=yes` forbids password prompts,
 * and `GIT_TERMINAL_PROMPT=0` turns any remaining git prompt into a failure
 * instead of a hang. The host's own `GIT_SSH_COMMAND`, when set, is preserved.
 */
function gitNonInteractiveEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new',
  }
}

export { resolvePnpm } from '@deepseek-ai/dsh-app-boot'

/** How pnpm is invoked for one install: the vendored pnpm or the `pnpm` on PATH. */
export interface ResolvedPnpmCommand {
  /**
   * The Node executable to run `pnpmCjs` under, when the vendored pnpm is used.
   * `undefined` means `pnpmCjs` is a command to spawn directly (`pnpm` on PATH).
   */
  readonly nodeBin: string | undefined
  /** The vendored pnpm.cjs path, or the `pnpm` command on PATH. */
  readonly pnpmCjs: string
}

/**
 * Resolve how to invoke pnpm: the vendored pnpm bundled into the harness when
 * present, else the `pnpm` command on PATH (a development checkout has no
 * vendored pnpm). Returns undefined when neither exists.
 * @param nodeBin - the Node executable path (`process.execPath`).
 * @param env - the process environment.
 * @returns the invocation, or undefined when no pnpm is available.
 */
export function resolvePnpmCommand(nodeBin: string, env: NodeJS.ProcessEnv = process.env): ResolvedPnpmCommand | undefined {
  const vendored = resolvePnpm(nodeBin, env)
  if (vendored !== undefined) return { nodeBin, pnpmCjs: vendored }
  return pnpmOnPath(env) ? { nodeBin: undefined, pnpmCjs: 'pnpm' } : undefined
}

/** Whether a `pnpm` executable resolves on `PATH`. */
function pnpmOnPath(env: NodeJS.ProcessEnv): boolean {
  const path = env.PATH ?? env.Path ?? ''
  const sep = process.platform === 'win32' ? ';' : ':'
  const extensions = process.platform === 'win32' ? ['', '.cmd', '.exe', '.bat'] : ['']
  return path.split(sep).some(
    directory => directory.length > 0 && extensions.some(extension => existsSync(join(directory, `pnpm${extension}`))),
  )
}
