/** Read-only projection of the current Cordis Loader plugin entries. */

import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { fileURLToPath } from 'node:url'
import { readProfileManifest, type ProfileManifest } from '@deepseek-ai/dsh-app-boot'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import { AVAILABLE_BUNDLES } from './bundles.ts'
import {
  composeOfflineBundle,
  registryPackageName,
  resolvePnpmCommand,
  runPnpmInstall,
  runPnpmInstallWithRegistries,
  runPnpmRemove,
  uninstallBundle,
  writeAllowBuilds,
} from './install.ts'
import {
  fetchMarketplaceCatalog,
  fetchMarketplaceSpec,
  MARKETPLACE_URL,
  marketplaceBaseUrl,
  marketplaceDataDir,
  readInstallTable,
  writeInstallTable,
} from './marketplace.ts'
import { persistPluginDisabled } from './persist.ts'
import { isRequiredPlugin } from './required.ts'
import type {
  AvailableBundlesSnapshot,
  InstallResult,
  InstallSpec,
  InstalledBundlesSnapshot,
  InstalledMarketplacePlugin,
  MarketplaceInstallSpec,
  MarketplaceSnapshot,
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySnapshot,
} from './types.ts'

export type * from './types.ts'
export { AVAILABLE_BUNDLES } from './bundles.ts'
export {
  INSTALL_REGISTRIES,
  parseBlockedBuilds,
  registryPackageName,
  resolvePnpmCommand,
  runPnpmRemove,
  writeAllowBuilds,
} from './install.ts'
export type { PnpmAddResult, ResolvedPnpmCommand } from './install.ts'
export {
  CATALOG_FILE,
  MARKETPLACE_URL,
  fetchMarketplaceCatalog,
  fetchMarketplaceSpec,
  marketplaceBaseUrl,
  marketplaceDataDir,
  marketplaceSpecUrl,
  readInstallTable,
  writeInstallTable,
} from './marketplace.ts'
export type {
  AvailableBundle,
  AvailableBundlesSnapshot,
  InstallResult,
  InstallSpec,
  InstalledBundle,
  InstalledBundlesSnapshot,
  InstalledMarketplacePlugin,
  MarketplaceEntry,
  MarketplaceInstallMethod,
  MarketplaceInstallSpec,
  MarketplacePluginMeta,
  MarketplaceSnapshot,
} from './types.ts'

/**
 * The profile's default bundle layers, composed by the shipped template and not
 * offered as offline-installable or uninstallable (they are part of the
 * deployment). See `packages/boot/app-boot/src/profile.ts` `PROFILE_TEMPLATES`.
 */
const DEFAULT_BUNDLES = new Set([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-image-recognition-bundle',
])

/** Brand an existing Loader-tree entry id at the owning boundary. */
function pluginEntryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Complete public projection of Cordis Fiber states. */
const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, PluginFiberPhase>

/** Remote-only service exposing the Loader's current non-group entry state. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader']

  constructor(ctx: Context) {
    super(ctx, 'pluginInventory')
  }

  /**
   * Read the Loader directly on every call. Cordis's internal plugin/status
   * events already maintain Entry.fiber and Fiber.state, so a second cache
   * would only add another lifecycle truth to keep synchronized.
   * @returns Current non-group Loader entries in Loader order.
   */
  @Remote('list')
  list(): PluginInventorySnapshot {
    const entries: PluginInventoryEntry[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      entries.push({
        entryId: pluginEntryId(entry.id),
        moduleName: entry.options.name,
        enabled: !entry.disabled,
        protected: isRequiredPlugin(entry.options.name),
        fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
      })
    }
    return { entries }
  }

  /**
   * Toggle one plugin entry on or off. Applies the change live through the
   * Loader (disposing or re-starting the plugin's fiber) and persists an
   * explicit `disabled` override into the profile's user patch layer so the
   * choice survives a restart. A plugin enabled by a bundle patch must carry
   * the `disabled: false` override too, or the bundle's default would win on
   * the next reload. A plugin that is PENDING on a dependency (a service
   * another enabled plugin provides) is left enabled — the loader activates it
   * once the dependency resolves; a plugin whose apply actually fails rejects
   * here via the loader's own start error.
   * @param entryId - the loader tree entry id (as `list` reports it).
   * @param enabled - the desired effective state.
   * @returns a confirmation; the caller re-lists to observe the new phase.
   */
  @Remote('setEnabled')
  async setEnabled(entryId: PluginEntryId, enabled: boolean): Promise<{ ok: true }> {
    // resolve() throws for an unknown id, so the entry is always defined.
    const entry = this.ctx.loader.resolve(entryId)
    // Disabling a required system plugin tears the process down; refuse it.
    // Re-enabling a disabled plugin is what this surface is for.
    if (!enabled && isRequiredPlugin(entry.options.name)) {
      throw new Error(`plugin ${String(entryId)} is required by the application and cannot be disabled`)
    }
    const rowId = entry.options.id
    // update() throws when the plugin's apply/config fails (and restores the
    // previous disabled state), so a resolved enable has either started or is
    // legitimately PENDING on a dependency that another enabled plugin
    // provides. PENDING is not a failure: reverting it here would stop
    // interdependent plugins — typically several freshly installed ones —
    // from being enabled together.
    await this.ctx.loader.update(entryId, { disabled: !enabled })
    if (this.ctx.baseUrl !== undefined) {
      persistPluginDisabled(fileURLToPath(this.ctx.baseUrl), rowId, !enabled)
    }
    return { ok: true }
  }

  /**
   * List the offline-installable optional bundles, each marked installed when
   * it is already composed in the profile's `dsh.profile.bundles`.
   * @returns the curated bundle catalog with installed state.
   */
  @Remote('availableBundles')
  availableBundles(): AvailableBundlesSnapshot {
    const profileDir = this.profileDir()
    const installed = new Set(this.profileManifest(profileDir)?.dsh?.profile?.bundles ?? [])
    // The catalog is empty until a new optional bundle ships, so the projection
    // callback is unreachable in the current configuration.
    /* v8 ignore next */
    return {
      available: AVAILABLE_BUNDLES.map(name => ({ name, installed: installed.has(name) })),
    }
  }

  /**
   * Install a plugin. A `bundle` spec composes an offline optional bundle into
   * the profile's bundle layer list (no network); a `registry` spec runs pnpm
   * against the writable profile directory via the bundled Node and vendored
   * pnpm, which requires the `dshAllowPluginInstall` context flag (set only by
   * the desktop boot). A registry spec is any pnpm `add` specifier — a bare npm
   * name, a tarball path/URL, or a git/GitHub URL — so every community install
   * source shares this path.
   *
   * Build-script consent is two-phase. The first call (no `consentBuilds`)
   * installs; when pnpm blocks dependency build scripts the host returns them
   * as `pendingBuilds` instead of failing. The caller shows those to the user,
   * and the retry carries the exact consented set in `consentBuilds`: the host
   * runs `pnpm approve-builds` for those packages, then reinstalls. The running
   * tree recomposes at the next boot.
   * @param spec - the bundle name or registry package spec to install.
   * @returns a confirmation; `pendingBuilds` pauses the install for consent,
   * otherwise `restartRequired` tells the caller to restart.
   */
  @Remote('installPlugin')
  async installPlugin(spec: InstallSpec): Promise<InstallResult> {
    const profileDir = this.profileDir()
    const anchor = this.ctx.get('dshInstallAnchor') as string | undefined
    if (anchor === undefined) {
      throw new Error('dsh: install anchor is unavailable in this runtime')
    }
    if (spec.type === 'bundle') {
      if (DEFAULT_BUNDLES.has(spec.name)) {
        throw new Error(`dsh: bundle ${spec.name} is composed by default and is not installable`)
      }
      composeOfflineBundle('dsh', profileDir, anchor, spec.name)
      return { ok: true, restartRequired: !(await this.reload()) }
    }
    if (this.ctx.get('dshAllowPluginInstall') !== true) {
      throw new Error('dsh: plugin install is not permitted in this runtime')
    }
    // Prefer the pnpm vendored into the packaged harness; fall back to pnpm on
    // PATH so a development checkout (which has no vendored pnpm) can install.
    const pnpm = resolvePnpmCommand(process.execPath)
    if (pnpm === undefined) {
      throw new Error('dsh: bundled pnpm is unavailable in this runtime and pnpm is not on PATH')
    }
    // The reconcile below re-reads the manifest, so a missing file fails there;
    // this snapshot fallback is only reached in that same unreachable-to-succeed case.
    /* v8 ignore next */
    const before = this.profileManifest(profileDir) ?? { dependencies: {} }
    // A consenting retry allows exactly the packages the user confirmed in the
    // profile's pnpm-workspace.yaml (deterministic — no dependency on pnpm's
    // pending-build state), then the add proceeds with them buildable.
    if (spec.consentBuilds !== undefined && spec.consentBuilds.length > 0) {
      writeAllowBuilds(profileDir, spec.consentBuilds)
    }
    // A registry-name spec participates in the registry fallback loop and the
    // minimum-release-age exemption; a git, tarball, or path spec runs once.
    const registryName = registryPackageName(spec.spec)
    const result = registryName === undefined
      ? runPnpmInstall({
        binName: 'dsh',
        profileDir,
        installAnchor: anchor,
        nodeBin: pnpm.nodeBin,
        pnpmCjs: pnpm.pnpmCjs,
        spec: spec.spec,
        before,
      })
      : runPnpmInstallWithRegistries({
        binName: 'dsh',
        profileDir,
        installAnchor: anchor,
        nodeBin: pnpm.nodeBin,
        pnpmCjs: pnpm.pnpmCjs,
        spec: spec.spec,
        before,
        minimumReleaseAgeExclude: registryName,
      })
    if (result.pendingBuilds !== undefined) {
      return { ok: true, restartRequired: false, pendingBuilds: result.pendingBuilds }
    }
    return { ok: true, restartRequired: !(await this.reload()) }
  }

  /**
   * List the profile's user-installed plugin dependencies (the packages pnpm
   * manages in the profile, excluding the in-box bundles, which ship with the
   * installation and are never dependencies). These are the ones the user can
   * uninstall.
   * @returns the installed-dependency snapshot.
   */
  @Remote('installedBundles')
  installedBundles(): InstalledBundlesSnapshot {
    const profileDir = this.profileDir()
    const dependencies = this.profileManifest(profileDir)?.dependencies ?? {}
    // In-box bundles (dsh-base & friends) are never profile dependencies, so the
    // dependency list is exactly the set the user installed.
    return { installed: Object.keys(dependencies).map(name => ({ name })) }
  }

  /**
   * Uninstall a plugin. A user-installed dependency (managed by pnpm) is removed
   * with `pnpm remove`, which drops both the dependency and any bundle layer it
   * had declared — this requires the `dshAllowPluginInstall` context flag, set
   * only by the desktop boot. An offline optional bundle that a profile composed
   * is un-composed (no dependency to remove). In-box bundles are part of the
   * installation and are refused.
   * @param name - the plugin package name to remove.
   * @returns a confirmation; `restartRequired` tells the caller to restart.
   */
  @Remote('uninstall')
  async uninstall(name: string): Promise<InstallResult> {
    const profileDir = this.profileDir()
    if (DEFAULT_BUNDLES.has(name)) {
      throw new Error(`dsh: bundle ${name} is composed by default and cannot be uninstalled`)
    }
    const before = this.profileManifest(profileDir)
    if (before?.dependencies?.[name] !== undefined) {
      // A user-installed dependency: remove it with pnpm, then reconcile (the
      // reconcile drops the layer when the removed package had declared one).
      const anchor = this.ctx.get('dshInstallAnchor') as string | undefined
      if (anchor === undefined) {
        throw new Error('dsh: install anchor is unavailable in this runtime')
      }
      if (this.ctx.get('dshAllowPluginInstall') !== true) {
        throw new Error('dsh: plugin uninstall is not permitted in this runtime')
      }
      const pnpm = resolvePnpmCommand(process.execPath)
      if (pnpm === undefined) {
        throw new Error('dsh: bundled pnpm is unavailable in this runtime and pnpm is not on PATH')
      }
      runPnpmRemove({
        binName: 'dsh',
        profileDir,
        installAnchor: anchor,
        nodeBin: pnpm.nodeBin,
        pnpmCjs: pnpm.pnpmCjs,
        spec: name,
        before,
      })
      return { ok: true, restartRequired: !(await this.reload()) }
    }
    // Not a profile dependency: an offline optional bundle the profile composed.
    uninstallBundle('dsh', profileDir, name)
    return { ok: true, restartRequired: !(await this.reload()) }
  }

  /**
   * List the remote marketplace catalog, marking each entry installed. The
   * durable install table records what the user installed; an entry is reported
   * installed only when it is BOTH recorded there AND actually present in the
   * current profile's dependencies (or bundle layers, for a bundle install) —
   * so a plugin removed by another path or a reset profile is not shown as
   * installed after a restart. When no profile is anchored, the table alone is
   * the fallback. The catalog is fetched from the static web host; a transient
   * network miss throws so the caller can surface a clean failure.
   * @returns the marketplace catalog with installed state.
   */
  @Remote('marketplaceList')
  async marketplaceList(): Promise<MarketplaceSnapshot> {
    const dataDir = marketplaceDataDir()
    const table = readInstallTable(dataDir)
    const entries = await fetchMarketplaceCatalog(MARKETPLACE_URL)
    const profile = this.ctx.baseUrl !== undefined ? this.profileManifest(this.profileDir()) : undefined
    const dependencies = profile?.dependencies ?? {}
    const bundles = profile?.dsh?.profile?.bundles ?? []
    return {
      entries: entries.map((meta) => {
        const row = table[meta.id]
        const installed = row !== undefined && (
          row.method === 'bundle'
            ? bundles.includes(row.spec)
            : dependencies[row.dependency ?? row.spec] !== undefined
        )
        return { ...meta, installed }
      }),
    }
  }

  /**
   * Install a marketplace plugin by id. Fetches the plugin's install spec from
   * the catalog base (derived from the fixed catalog URL, never from catalog
   * content), maps it onto the existing install path (git/npm/tarball via the
   * registry Remote, bundle via the offline compose), and records the install
   * in the durable table once it succeeds. A `pendingBuilds` result pauses for
   * build consent exactly as a direct registry install does; the caller shows
   * the blocked packages and re-invokes with the consented set.
   * @param id - the marketplace plugin id.
   * @param consentBuilds - the packages the user consented to run build scripts
   * for, sent on the retry after a `pendingBuilds` result.
   * @returns the underlying install result (restart notice or pending consent).
   */
  @Remote('marketplaceInstall')
  async marketplaceInstall(id: string, consentBuilds?: readonly string[]): Promise<InstallResult> {
    const spec = await fetchMarketplaceSpec(marketplaceBaseUrl(MARKETPLACE_URL), id)
    const result = spec.method === 'bundle'
      ? await this.installPlugin({ type: 'bundle', name: spec.spec })
      : consentBuilds !== undefined && consentBuilds.length > 0
        ? await this.installPlugin({ type: 'registry', spec: spec.spec, consentBuilds })
        : await this.installPlugin({ type: 'registry', spec: spec.spec })
    // A paused install awaits consent; only a completed install is recorded.
    if (result.pendingBuilds !== undefined) return result
    this.recordMarketplaceInstall(id, spec)
    return result
  }

  /**
   * Uninstall a marketplace plugin by id. Resolves the profile dependency (or
   * the bundle name) from the install table row, calls the existing uninstall
   * path, and drops the table row once it succeeds.
   * @param id - the marketplace plugin id.
   * @returns the underlying uninstall result.
   */
  @Remote('marketplaceUninstall')
  async marketplaceUninstall(id: string): Promise<InstallResult> {
    const dataDir = marketplaceDataDir()
    const table = readInstallTable(dataDir)
    const row = table[id]
    if (row === undefined) throw new Error(`marketplace plugin ${id} is not installed`)
    // A bundle install un-composes by its bundle name; registry installs remove
    // the profile dependency, falling back to the spec when no explicit
    // dependency name was recorded.
    const result = await this.uninstall(row.method === 'bundle' ? row.spec : row.dependency ?? row.spec)
    const next = { ...table }
    Reflect.deleteProperty(next, id)
    writeInstallTable(dataDir, next)
    return result
  }

  /** Record a successful marketplace install in the durable install table. */
  private recordMarketplaceInstall(id: string, spec: MarketplaceInstallSpec): void {
    const dataDir = marketplaceDataDir()
    const table = readInstallTable(dataDir)
    // The web spec's `dependency` is a best-effort guess; for a git (or path)
    // install the resolved package name is only known once pnpm runs, and it can
    // carry a scope the guess omitted (e.g. `@dsh-external/dsh-visualize`). The
    // marketplace's installed check matches the profile by this name, so record
    // the real one — resolved from the just-updated profile — to keep the table
    // in sync with the dependency the loader actually holds.
    const dependency = this.resolveInstalledDependency(spec) ?? spec.dependency
    const row: InstalledMarketplacePlugin = {
      method: spec.method,
      spec: spec.spec,
      installedAt: new Date().toISOString(),
      ...(dependency !== undefined ? { dependency } : {}),
    }
    writeInstallTable(dataDir, { ...table, [id]: row })
  }

  /**
   * Resolve the real profile dependency name for a just-completed install. An
   * exact dependency-name match wins; otherwise a git/path spec installs under
   * the package's own name, which surfaces as the dependency whose version range
   * equals the spec.
   * @param spec - the marketplace install spec that succeeded.
   * @returns the profile dependency name, or undefined when unresolvable.
   */
  private resolveInstalledDependency(spec: MarketplaceInstallSpec): string | undefined {
    if (this.ctx.baseUrl === undefined) return undefined
    const dependencies = this.profileManifest(this.profileDir())?.dependencies ?? {}
    if (spec.dependency !== undefined && dependencies[spec.dependency] !== undefined) {
      return spec.dependency
    }
    for (const [name, range] of Object.entries(dependencies)) {
      if (range === spec.spec) return name
    }
    return undefined
  }

  /** Trigger a live tree recomposition; false when no reload handle is provided. */
  private async reload(): Promise<boolean> {
    const reload = this.ctx.get('dshReloadProfile') as (() => Promise<void>) | undefined
    if (reload === undefined) return false
    await reload()
    return true
  }

  /** The profile directory the Loader anchors on (its `baseUrl`). */
  private profileDir(): string {
    if (this.ctx.baseUrl === undefined) {
      throw new Error('dsh: plugin management requires a profile directory')
    }
    return fileURLToPath(this.ctx.baseUrl)
  }

  /** Read the profile manifest, or undefined when absent. */
  private profileManifest(profileDir: string): ProfileManifest | undefined {
    try {
      return readProfileManifest('dsh', profileDir)
    } catch {
      return undefined
    }
  }
}

export default PluginInventoryGateway
