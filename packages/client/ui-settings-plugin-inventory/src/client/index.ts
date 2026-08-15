/** Host plugin inventory and marketplace registered into Web Settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  PluginInventorySettingsTab,
  type PluginInventorySettingsTabInjected,
} from './PluginInventorySettingsTab.tsx'
import {
  PluginMarketplaceSettingsTab,
  type PluginMarketplaceSettingsTabInjected,
} from './PluginMarketplaceSettingsTab.tsx'
import { en, zh, type PluginInventoryLocaleKey } from './locales.ts'

export type { PluginInventorySettingsTabInjected, PluginInventorySettingsTabProps } from './PluginInventorySettingsTab.tsx'
export type { PluginMarketplaceSettingsTabInjected, PluginMarketplaceSettingsTabProps } from './PluginMarketplaceSettingsTab.tsx'
export type { PluginInventoryLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Host plugin inventory and marketplace copy. */
    'settings.pluginInventory': PluginInventoryLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.pluginInventory'

/** Services required by the Settings registrations and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory']

/** Contribute the plugin-list and marketplace tabs to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugin-inventory: dictionaries')

  const t = ctx.locale.bind(NS)
  const list: PluginInventorySettingsTabInjected['list'] = async () => {
    const result = await ctx.remote.pluginInventory.list()
    if (!result.ok) {
      throw new Error(`pluginInventory.list failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const setEnabled: PluginInventorySettingsTabInjected['setEnabled'] = async (entryId, enabled) => {
    const result = await ctx.remote.pluginInventory.setEnabled(entryId, enabled)
    if (!result.ok) {
      throw new Error(`pluginInventory.setEnabled failed: ${result.error.code}: ${result.error.message}`)
    }
  }
  const installPlugin: PluginInventorySettingsTabInjected['installPlugin'] = async (spec) => {
    const result = await ctx.remote.pluginInventory.installPlugin(spec)
    if (!result.ok) {
      throw new Error(`pluginInventory.installPlugin failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const installedBundles: PluginInventorySettingsTabInjected['installedBundles'] = async () => {
    const result = await ctx.remote.pluginInventory.installedBundles()
    if (!result.ok) {
      throw new Error(`pluginInventory.installedBundles failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const uninstall: PluginInventorySettingsTabInjected['uninstall'] = async (name) => {
    const result = await ctx.remote.pluginInventory.uninstall(name)
    if (!result.ok) {
      throw new Error(`pluginInventory.uninstall failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const marketplaceList: PluginMarketplaceSettingsTabInjected['marketplaceList'] = async () => {
    const result = await ctx.remote.pluginInventory.marketplaceList()
    if (!result.ok) {
      throw new Error(`pluginInventory.marketplaceList failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const marketplaceInstall: PluginMarketplaceSettingsTabInjected['marketplaceInstall'] = async (id, consentBuilds) => {
    const result = await ctx.remote.pluginInventory.marketplaceInstall(id, consentBuilds)
    if (!result.ok) {
      throw new Error(`pluginInventory.marketplaceInstall failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const marketplaceUninstall: PluginMarketplaceSettingsTabInjected['marketplaceUninstall'] = async (id) => {
    const result = await ctx.remote.pluginInventory.marketplaceUninstall(id)
    if (!result.ok) {
      throw new Error(`pluginInventory.marketplaceUninstall failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const inventoryInjected = (): PluginInventorySettingsTabInjected => ({
    list, setEnabled, installPlugin, installedBundles, uninstall,
  })
  const marketplaceInjected = (): PluginMarketplaceSettingsTabInjected => ({
    marketplaceList, marketplaceInstall, marketplaceUninstall,
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'all',
    order: 10,
    label: () => t('tab'),
    locale: NS,
    inject: inventoryInjected,
  }, PluginInventorySettingsTab))
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'marketplace',
    order: 20,
    label: () => t('marketplace'),
    locale: NS,
    inject: marketplaceInjected,
  }, PluginMarketplaceSettingsTab))
}
