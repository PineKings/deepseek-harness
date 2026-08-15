import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable Loader-tree identity of one configured plugin entry. */
export type PluginEntryId = Branded<'PluginEntryId'>

/** Lifecycle state of an entry's root Fiber, or null when it has no live root Fiber. */
export type PluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/** One non-group Loader entry exposed to trusted clients. */
export interface PluginInventoryEntry {
  readonly entryId: PluginEntryId
  /** Exact module specifier imported by the Loader entry. */
  readonly moduleName: string
  /** Effective Loader enablement, including disabled ancestor groups. */
  readonly enabled: boolean
  /** Whether the running application requires this plugin and forbids toggling it. */
  readonly protected: boolean
  readonly fiberPhase: PluginFiberPhase
}

/** Point-in-time inventory returned by the plugin inventory Remote. */
export interface PluginInventorySnapshot {
  readonly entries: readonly PluginInventoryEntry[]
}

/** One optional bundle in the offline-installable catalog. */
export interface AvailableBundle {
  /** The bundle's npm package name. */
  readonly name: string
  /** Whether the bundle is already composed in the profile. */
  readonly installed: boolean
}

/** Catalog snapshot returned by the available-bundles Remote. */
export interface AvailableBundlesSnapshot {
  readonly available: readonly AvailableBundle[]
}

/** One user-installed plugin dependency of the profile. */
export interface InstalledBundle {
  /** The installed dependency's package name. */
  readonly name: string
}

/** Snapshot of the profile's user-installed plugin dependencies. */
export interface InstalledBundlesSnapshot {
  readonly installed: readonly InstalledBundle[]
}

/** What a plugin-install request targets. */
export type InstallSpec =
  | { readonly type: 'bundle'; readonly name: string }
  | {
    readonly type: 'registry'
    /** Any pnpm `add` specifier: a bare name, a tarball path/URL, a git or GitHub URL. */
    readonly spec: string
    /**
     * The exact packages the user consented to run build scripts for, sent on
     * the retry after the host reported them in {@link InstallResult.pendingBuilds}.
     */
    readonly consentBuilds?: readonly string[]
  }

/** Result of an install/uninstall request. */
export interface InstallResult {
  readonly ok: true
  /** Whether the app must restart for the change to take effect. */
  readonly restartRequired: boolean
  /**
   * Build scripts pnpm refused to run; the install paused awaiting the user's
   * per-package consent. Present only then — the caller should show these and
   * re-request with the same spec plus `InstallSpec.consentBuilds`.
   */
  readonly pendingBuilds?: readonly string[]
}

/** One plugin offered by the remote marketplace catalog. */
export interface MarketplacePluginMeta {
  /** The stable marketplace id, also the per-plugin spec file name stem. */
  readonly id: string
  readonly name: string
  readonly description: string
  readonly author?: string
  readonly version?: string
  /** The publisher's source repository or homepage URL. */
  readonly repository?: string
  /** Whether the publisher curates this plugin as a recommended pick. */
  readonly recommended?: boolean
  /** Sort priority for the marketplace list; higher sorts closer to the front. */
  readonly priority?: number
}

/** How a marketplace plugin is installed. */
export type MarketplaceInstallMethod = 'git' | 'npm' | 'tarball' | 'bundle'

/** The install prescription for one marketplace plugin. */
export interface MarketplaceInstallSpec {
  readonly id: string
  readonly method: MarketplaceInstallMethod
  /** The pnpm `add` specifier (git URL, npm name, tarball URL) or a bundle name. */
  readonly spec: string
  /**
   * The package name that lands in the profile's `dependencies` after install,
   * used for uninstall. Bundle installs un-compose by `spec` instead.
   */
  readonly dependency?: string
}

/** A marketplace catalog entry with its installed state. */
export interface MarketplaceEntry extends MarketplacePluginMeta {
  /** Whether the user has installed this plugin, per the durable install table. */
  readonly installed: boolean
}

/** Snapshot returned by the marketplace-list Remote. */
export interface MarketplaceSnapshot {
  readonly entries: readonly MarketplaceEntry[]
}

/** One row of the durable per-user plugin install table. */
export interface InstalledMarketplacePlugin {
  readonly method: MarketplaceInstallMethod
  readonly spec: string
  /** The package name used for uninstall; bundle installs use `spec` instead. */
  readonly dependency?: string
  /** When the install was recorded (ISO 8601). */
  readonly installedAt: string
}
