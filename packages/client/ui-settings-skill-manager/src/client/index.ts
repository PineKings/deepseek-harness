/** Host skill manager registered into Web Settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SkillManagerSettingsTab, type SkillManagerSettingsTabInjected } from './SkillManagerSettingsTab.tsx'
import { en, zh, type SkillManagerLocaleKey } from './locales.ts'

export type { SkillManagerSettingsTabInjected, SkillManagerSettingsTabProps } from './SkillManagerSettingsTab.tsx'
export type { SkillManagerLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Host skill manager copy. */
    'settings.skillManager': SkillManagerLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.skillManager'

/** Services required by the Settings registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.skillManager']

/** Contribute the skills management tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-skill-manager: dictionaries')

  const t = ctx.locale.bind(NS)
  const list: SkillManagerSettingsTabInjected['list'] = async () => {
    // The optional `cwd` parameter must still be sent (as undefined) so the
    // typert transport sees the declared argument count.
    const result = await ctx.remote.skillManager.list(undefined)
    if (!result.ok) {
      throw new Error(`skillManager.list failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const install: SkillManagerSettingsTabInjected['install'] = async (spec) => {
    const result = await ctx.remote.skillManager.installSkill(spec)
    if (!result.ok) {
      throw new Error(`skillManager.installSkill failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const uninstall: SkillManagerSettingsTabInjected['uninstall'] = async (name) => {
    const result = await ctx.remote.skillManager.uninstallSkill(name)
    if (!result.ok) {
      throw new Error(`skillManager.uninstallSkill failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const setEnabled: SkillManagerSettingsTabInjected['setEnabled'] = async (name, patch) => {
    const result = await ctx.remote.skillManager.setEnabled(name, patch)
    if (!result.ok) {
      throw new Error(`skillManager.setEnabled failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const setDescription: SkillManagerSettingsTabInjected['setDescription'] = async (name, description) => {
    const result = await ctx.remote.skillManager.setDescription(name, description)
    if (!result.ok) {
      throw new Error(`skillManager.setDescription failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const injected = (): SkillManagerSettingsTabInjected => ({
    list, install, uninstall, setEnabled, setDescription,
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'skills',
    order: 30,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, SkillManagerSettingsTab))
}
