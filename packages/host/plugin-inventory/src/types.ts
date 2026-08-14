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

/** What a plugin-install request targets. */
export type InstallSpec =
  | { readonly type: 'bundle'; readonly name: string }
  | { readonly type: 'registry'; readonly spec: string }

/** Result of an install/uninstall request. */
export interface InstallResult {
  readonly ok: true
  /** Whether the app must restart for the change to take effect. */
  readonly restartRequired: boolean
}
