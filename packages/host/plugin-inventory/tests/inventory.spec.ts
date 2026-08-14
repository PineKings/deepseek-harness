import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { readProfileManifest } from '@deepseek-ai/dsh-app-boot'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import PluginInventoryGateway, { type PluginEntryId } from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const activePlugin: Plugin.Function = () => {}
const pendingPlugin: Plugin.Object = {
  inject: ['neverReady'],
  apply() {},
}

async function harness(): Promise<{
  ctx: Context
  inventory: PluginInventoryGateway
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.active = activePlugin
  ctx.loader.builtins.pending = pendingPlugin
  // `cordis:` builtins the toggle tests create; they resolve without a package install.
  ctx.loader.builtins['user-toggleable'] = activePlugin
  ctx.loader.builtins['required'] = activePlugin
  await ctx.plugin(PluginInventoryGateway)
  const inventory = ctx.get('pluginInventory') as PluginInventoryGateway
  return { ctx, inventory }
}

describe('PluginInventoryGateway', () => {
  it('publishes direct methods under the pluginInventory namespace', async () => {
    const { inventory } = await harness()
    expect(inventory.typertRemote).toMatchObject({
      serviceKey: 'pluginInventory',
      namespace: 'pluginInventory',
    })
    expect(remoteMethods(inventory)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'setEnabled', invocation: { kind: 'direct' } },
      { method: 'availableBundles', invocation: { kind: 'direct' } },
      { method: 'installPlugin', invocation: { kind: 'direct' } },
      { method: 'uninstall', invocation: { kind: 'direct' } },
    ])
  })

  it('setEnabled toggles a user-toggleable Loader entry live', async () => {
    const { ctx, inventory } = await harness()
    const id = await ctx.loader.create({ name: 'cordis:user-toggleable' }) as PluginEntryId
    await inventory.setEnabled(id, false)
    expect(inventory.list().entries.find(entry => entry.entryId === id)).toEqual({
      entryId: id,
      moduleName: 'cordis:user-toggleable',
      enabled: false,
      protected: false,
      fiberPhase: null,
    })
    await inventory.setEnabled(id, true)
    expect(inventory.list().entries.find(entry => entry.entryId === id)?.enabled).toBe(true)
  })

  it('setEnabled refuses a required plugin', async () => {
    const { ctx, inventory } = await harness()
    const id = await ctx.loader.create({ name: 'cordis:required' }) as PluginEntryId
    expect(inventory.list().entries.find(entry => entry.entryId === id)?.protected).toBe(true)
    await expect(inventory.setEnabled(id, false)).rejects.toThrow(/required by the application/)
    expect(inventory.list().entries.find(entry => entry.entryId === id)?.enabled).toBe(true)
  })

  it('projects current non-group Loader entries without a second cache', async () => {
    const { ctx, inventory } = await harness()
    const activeId = await ctx.loader.create({ name: 'cordis:active' })
    const pendingId = await ctx.loader.create({ name: 'cordis:pending' })
    const disabledId = await ctx.loader.create({
      name: 'cordis:not-installed',
      disabled: true,
    })
    await ctx.loader.create({ name: 'cordis:active', group: true })

    const snapshot = inventory.list()
    expect(snapshot.entries).toHaveLength(3)
    expect(snapshot.entries).toEqual(expect.arrayContaining([
      {
        entryId: activeId,
        moduleName: 'cordis:active',
        enabled: true,
        protected: false,
        fiberPhase: 'active',
      },
      {
        entryId: pendingId,
        moduleName: 'cordis:pending',
        enabled: true,
        protected: false,
        fiberPhase: 'pending',
      },
      {
        entryId: disabledId,
        moduleName: 'cordis:not-installed',
        enabled: false,
        protected: false,
        fiberPhase: null,
      },
    ]))

    await ctx.loader.update(activeId, { disabled: true })
    expect(inventory.list().entries.find(entry => entry.entryId === activeId)).toEqual({
      entryId: activeId,
      moduleName: 'cordis:active',
      enabled: false,
      protected: false,
      fiberPhase: null,
    })

    await ctx.loader.remove(pendingId)
    expect(inventory.list().entries.some(entry => entry.entryId === pendingId)).toBe(false)
  })

  it('availableBundles reports an empty offline catalog', async () => {
    const { ctx, inventory } = await harness()
    const dir = mkdtempSync(join(tmpdir(), 'dsh-inv-'))
    contexts.push(ctx)
    ctx.baseUrl = pathToFileURL(dir + '/').href
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-test', dsh: { profile: { bundles: [] } } }))
    try {
      expect(inventory.availableBundles().available).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('install requires an install anchor and gating for registry specs', async () => {
    const { ctx, inventory } = await harness()
    const dir = mkdtempSync(join(tmpdir(), 'dsh-inv-'))
    ctx.baseUrl = pathToFileURL(dir + '/').href
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-test', dsh: { profile: { bundles: [] } } }))
    try {
      await expect(inventory.installPlugin({ type: 'bundle', name: 'x' })).rejects.toThrow(/install anchor is unavailable/)
      ctx.provide('dshInstallAnchor', join(dir, 'package.json'))
      await expect(inventory.installPlugin({ type: 'registry', spec: 'x' })).rejects.toThrow(/not permitted/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses to install a default bundle', async () => {
    const { ctx, inventory } = await harness()
    const dir = mkdtempSync(join(tmpdir(), 'dsh-inv-'))
    ctx.baseUrl = pathToFileURL(dir + '/').href
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-test', dsh: { profile: { bundles: [] } } }))
    ctx.provide('dshInstallAnchor', join(dir, 'package.json'))
    try {
      await expect(inventory.installPlugin({ type: 'bundle', name: '@deepseek-ai/dsh-image-recognition-bundle' }))
        .rejects.toThrow(/not installable/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses to uninstall a default bundle and removes an optional one', async () => {
    const { ctx, inventory } = await harness()
    const dir = mkdtempSync(join(tmpdir(), 'dsh-inv-'))
    ctx.baseUrl = pathToFileURL(dir + '/').href
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-test',
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-image-recognition-bundle', 'optional-bundle'] } },
    }))
    try {
      await expect(inventory.uninstall('@deepseek-ai/dsh-image-recognition-bundle')).rejects.toThrow(/cannot be uninstalled/)
      expect((await inventory.uninstall('optional-bundle')).restartRequired).toBe(true)
      expect(readProfileManifest('dsh', dir).dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-image-recognition-bundle'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('composes an offline bundle when the anchor is available', async () => {
    const { ctx, inventory } = await harness()
    const dir = mkdtempSync(join(tmpdir(), 'dsh-inv-'))
    ctx.baseUrl = pathToFileURL(dir + '/').href
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-test', dsh: { profile: { bundles: [] } } }))
    mkdirSync(join(dir, 'node_modules', 'b'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'b', 'package.json'), JSON.stringify({ name: 'b', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
    writeFileSync(join(dir, 'node_modules', 'b', 'cordis.patch.yml'), '[]\n')
    ctx.provide('dshInstallAnchor', join(dir, 'package.json'))
    try {
      await inventory.installPlugin({ type: 'bundle', name: 'b' })
      expect(readProfileManifest('dsh', dir).dsh?.profile?.bundles).toEqual(['b'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('installs a registry spec via bundled pnpm when permitted', async () => {
    const { ctx, inventory } = await harness()
    const dir = mkdtempSync(join(tmpdir(), 'dsh-inv-'))
    ctx.baseUrl = pathToFileURL(dir + '/').href
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-test', dsh: { profile: { bundles: [] } } }))
    const fakePnpm = join(dir, 'pnpm.cjs')
    writeFileSync(fakePnpm, 'process.exit(0)\n')
    process.env.DSH_PNPM = fakePnpm
    try {
      ctx.provide('dshInstallAnchor', join(dir, 'package.json'))
      ctx.provide('dshAllowPluginInstall', true)
      expect((await inventory.installPlugin({ type: 'registry', spec: 'some-pkg' })).restartRequired).toBe(true)
    } finally {
      delete process.env.DSH_PNPM
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails loud without a profile directory', async () => {
    const { inventory } = await harness()
    expect(() => inventory.availableBundles()).toThrow(/profile directory/)
  })

  it('treats a missing profile manifest as an empty catalog', async () => {
    const { ctx, inventory } = await harness()
    const dir = mkdtempSync(join(tmpdir(), 'dsh-inv-'))
    ctx.baseUrl = pathToFileURL(dir + '/').href
    try {
      expect(inventory.availableBundles().available).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('setEnabled fails loud for an unknown entry', async () => {
    const { inventory } = await harness()
    await expect(inventory.setEnabled('missing' as PluginEntryId, false)).rejects.toThrow(/cannot resolve entry missing/)
  })

  it('setEnabled persists the override when anchored to a profile directory', async () => {
    const { ctx, inventory } = await harness()
    const dir = mkdtempSync(join(tmpdir(), 'dsh-inv-'))
    ctx.baseUrl = pathToFileURL(dir + '/').href
    try {
      const id = await ctx.loader.create({ name: 'cordis:user-toggleable' }) as PluginEntryId
      await inventory.setEnabled(id, false)
      expect(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')).toContain('disabled: true')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('setEnabled reverts an enable whose fiber cannot activate', async () => {
    const { ctx, inventory } = await harness()
    const id = await ctx.loader.create({ name: 'cordis:pending' }) as PluginEntryId
    await expect(inventory.setEnabled(id, true)).rejects.toThrow(/could not start/)
    expect(inventory.list().entries.find(entry => entry.entryId === id)?.enabled).toBe(false)
  })

  it('registry install fails loud when bundled pnpm is absent', async () => {
    const { ctx, inventory } = await harness()
    const dir = mkdtempSync(join(tmpdir(), 'dsh-inv-'))
    ctx.baseUrl = pathToFileURL(dir + '/').href
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-test', dsh: { profile: { bundles: [] } } }))
    delete process.env.DSH_PNPM
    try {
      ctx.provide('dshInstallAnchor', join(dir, 'package.json'))
      ctx.provide('dshAllowPluginInstall', true)
      await expect(inventory.installPlugin({ type: 'registry', spec: 'x' })).rejects.toThrow(/bundled pnpm is unavailable/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('registry install fails loud when the profile manifest is missing', async () => {
    const { ctx, inventory } = await harness()
    const dir = mkdtempSync(join(tmpdir(), 'dsh-inv-'))
    ctx.baseUrl = pathToFileURL(dir + '/').href
    const fakePnpm = join(dir, 'pnpm.cjs')
    writeFileSync(fakePnpm, 'process.exit(0)\n')
    process.env.DSH_PNPM = fakePnpm
    try {
      ctx.provide('dshInstallAnchor', join(dir, 'package.json'))
      ctx.provide('dshAllowPluginInstall', true)
      await expect(inventory.installPlugin({ type: 'registry', spec: 'x' })).rejects.toThrow(/failed to read profile manifest/)
    } finally {
      delete process.env.DSH_PNPM
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('triggers a live recompose when a reload handle is provided', async () => {
    const { ctx, inventory } = await harness()
    const dir = mkdtempSync(join(tmpdir(), 'dsh-inv-'))
    ctx.baseUrl = pathToFileURL(dir + '/').href
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-test', dsh: { profile: { bundles: [] } } }))
    mkdirSync(join(dir, 'node_modules', 'b'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'b', 'package.json'), JSON.stringify({ name: 'b', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
    writeFileSync(join(dir, 'node_modules', 'b', 'cordis.patch.yml'), '[]\n')
    ctx.provide('dshInstallAnchor', join(dir, 'package.json'))
    const reload = vi.fn(async () => {})
    ctx.provide('dshReloadProfile', reload)
    try {
      const result = await inventory.installPlugin({ type: 'bundle', name: 'b' })
      expect(result.restartRequired).toBe(false)
      expect(reload).toHaveBeenCalledOnce()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
