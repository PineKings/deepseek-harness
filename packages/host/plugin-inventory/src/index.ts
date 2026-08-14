/** Read-only projection of the current Cordis Loader plugin entries. */

import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { fileURLToPath } from 'node:url'
import { readProfileManifest, type ProfileManifest } from '@deepseek-ai/dsh-app-boot'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import { AVAILABLE_BUNDLES } from './bundles.ts'
import { composeOfflineBundle, resolvePnpm, runPnpmInstall, uninstallBundle } from './install.ts'
import { persistPluginDisabled } from './persist.ts'
import { isRequiredPlugin } from './required.ts'
import type {
  AvailableBundlesSnapshot,
  InstallResult,
  InstallSpec,
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySnapshot,
} from './types.ts'

export type * from './types.ts'
export { AVAILABLE_BUNDLES } from './bundles.ts'
export type { AvailableBundle, AvailableBundlesSnapshot, InstallResult, InstallSpec } from './types.ts'

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
   * the next reload.
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
    await this.ctx.loader.update(entryId, { disabled: !enabled })
    // An enable whose injected services are unavailable would fail the next
    // boot (the dependent never becomes active). Revert and refuse loudly.
    if (enabled && entry.fiber !== undefined && entry.fiber.state !== FIBER_STATE.ACTIVE) {
      await this.ctx.loader.update(entryId, { disabled: true })
      throw new Error(`plugin ${String(entryId)} could not start; its dependencies are unavailable`)
    }
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
    return {
      available: AVAILABLE_BUNDLES.map(name => ({ name, installed: installed.has(name) })),
    }
  }

  /**
   * Install a plugin. A `bundle` spec composes an offline optional bundle into
   * the profile's bundle layer list (no network); a `registry` spec runs pnpm
   * against the writable profile directory via the bundled Node and vendored
   * pnpm, which requires the `dshAllowPluginInstall` context flag (set only by
   * the desktop boot). Persists the manifest; the running tree recomposes at
   * the next boot.
   * @param spec - the bundle name or registry package spec to install.
   * @returns a confirmation; `restartRequired` tells the caller to restart.
   */
  @Remote('installPlugin')
  installPlugin(spec: InstallSpec): InstallResult {
    const profileDir = this.profileDir()
    const anchor = this.ctx.get('dshInstallAnchor') as string | undefined
    if (anchor === undefined) {
      throw new Error('dsh: install anchor is unavailable in this runtime')
    }
    if (spec.type === 'bundle') {
      composeOfflineBundle('dsh', profileDir, anchor, spec.name)
      return { ok: true, restartRequired: true }
    }
    if (this.ctx.get('dshAllowPluginInstall') !== true) {
      throw new Error('dsh: plugin install is not permitted in this runtime')
    }
    const pnpmCjs = resolvePnpm(process.execPath)
    if (pnpmCjs === undefined) {
      throw new Error('dsh: bundled pnpm is unavailable in this runtime')
    }
    // The reconcile below re-reads the manifest, so a missing file fails there;
    // this snapshot fallback is only reached in that same unreachable-to-succeed case.
    /* v8 ignore next */
    const before = this.profileManifest(profileDir) ?? { dependencies: {} }
    runPnpmInstall({
      binName: 'dsh',
      profileDir,
      installAnchor: anchor,
      nodeBin: process.execPath,
      pnpmCjs,
      spec: spec.spec,
      before,
    })
    return { ok: true, restartRequired: true }
  }

  /**
   * Un-compose an offline optional bundle from the profile's bundle layer list.
   * @param name - the bundle package name to remove.
   * @returns a confirmation; `restartRequired` tells the caller to restart.
   */
  @Remote('uninstall')
  uninstall(name: string): InstallResult {
    uninstallBundle('dsh', this.profileDir(), name)
    return { ok: true, restartRequired: true }
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
