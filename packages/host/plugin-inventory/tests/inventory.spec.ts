import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { readProfileManifest } from '@deepseek-ai/dsh-app-boot'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import PluginInventoryGateway, {
  marketplaceDataDir,
  readInstallTable,
  writeInstallTable,
  type PluginEntryId,
} from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const activePlugin: Plugin.Function = () => {}
const pendingPlugin: Plugin.Object = {
  inject: ['neverReady'],
  apply() {},
}
const failingPlugin: Plugin.Function = () => { throw new Error('boom') }

async function harness(): Promise<{
  ctx: Context
  inventory: PluginInventoryGateway
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.active = activePlugin
  ctx.loader.builtins.pending = pendingPlugin
  ctx.loader.builtins.failing = failingPlugin
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
      { method: 'installedBundles', invocation: { kind: 'direct' } },
      { method: 'uninstall', invocation: { kind: 'direct' } },
      { method: 'marketplaceList', invocation: { kind: 'direct' } },
      { method: 'marketplaceInstall', invocation: { kind: 'direct' } },
      { method: 'marketplaceUninstall', invocation: { kind: 'direct' } },
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

  it('pauses for build consent, then writes the allowlist and retries', async () => {
    const { ctx, inventory } = await harness()
    const dir = mkdtempSync(join(tmpdir(), 'dsh-inv-'))
    ctx.baseUrl = pathToFileURL(dir + '/').href
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-test', dsh: { profile: { bundles: [] } } }))
    // A fake pnpm whose `add` reports a blocked build until the profile's
    // pnpm-workspace.yaml allows node-pty (which the gateway writes on consent).
    const fakePnpm = join(dir, 'pnpm.cjs')
    writeFileSync(fakePnpm, [
      "const fs = require('fs')",
      "const ws = fs.existsSync('pnpm-workspace.yaml') ? fs.readFileSync('pnpm-workspace.yaml','utf8') : ''",
      "if (ws.includes('node-pty')) process.exit(0)",
      "process.stderr.write('ERR_PNPM_IGNORED_BUILDS\\nIgnored build scripts: node-pty, protobufjs\\n')",
      'process.exit(1)',
    ].join('\n'))
    process.env.DSH_PNPM = fakePnpm
    try {
      ctx.provide('dshInstallAnchor', join(dir, 'package.json'))
      ctx.provide('dshAllowPluginInstall', true)
      const first = await inventory.installPlugin({ type: 'registry', spec: 'some-pkg' })
      expect(first.pendingBuilds).toEqual(['node-pty', 'protobufjs'])
      expect(first.restartRequired).toBe(false)
      const second = await inventory.installPlugin({
        type: 'registry', spec: 'some-pkg', consentBuilds: ['node-pty', 'protobufjs'],
      })
      expect(second.pendingBuilds).toBeUndefined()
      expect(second.restartRequired).toBe(true)
      // The gateway wrote the allowlist directly into pnpm-workspace.yaml.
      expect(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8')).toContain('node-pty: true')
      expect(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8')).toContain('protobufjs: true')
    } finally {
      delete process.env.DSH_PNPM
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uninstalls a user-installed dependency via pnpm remove and reconciles', async () => {
    const { ctx, inventory } = await harness()
    const dir = mkdtempSync(join(tmpdir(), 'dsh-inv-'))
    ctx.baseUrl = pathToFileURL(dir + '/').href
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-test',
      dependencies: { 'user-plugin': '1.0.0' },
      dsh: { profile: { bundles: ['user-plugin'] } },
    }))
    const record = join(dir, 'remove.json')
    const fakePnpm = join(dir, 'pnpm.cjs')
    writeFileSync(fakePnpm, [
      "const fs = require('fs')",
      'fs.writeFileSync(process.env.REMOVE_RECORD, JSON.stringify(process.argv.slice(2)))',
      "const pkg = JSON.parse(fs.readFileSync('package.json','utf8'))",
      'delete pkg.dependencies[process.argv[3]]',
      "fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\\n')",
      'process.exit(0)',
    ].join('\n'))
    process.env.DSH_PNPM = fakePnpm
    process.env.REMOVE_RECORD = record
    try {
      ctx.provide('dshInstallAnchor', join(dir, 'package.json'))
      ctx.provide('dshAllowPluginInstall', true)
      const result = await inventory.uninstall('user-plugin')
      expect(result.restartRequired).toBe(true)
      expect(JSON.parse(readFileSync(record, 'utf8'))).toEqual(['remove', 'user-plugin'])
      const manifest = readProfileManifest('dsh', dir)
      expect(manifest.dependencies).not.toHaveProperty('user-plugin')
      expect(manifest.dsh?.profile?.bundles).toEqual([])
    } finally {
      delete process.env.DSH_PNPM
      delete process.env.REMOVE_RECORD
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('lists user-installed dependencies for uninstall', async () => {
    const { ctx, inventory } = await harness()
    const dir = mkdtempSync(join(tmpdir(), 'dsh-inv-'))
    ctx.baseUrl = pathToFileURL(dir + '/').href
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-test',
      dependencies: { 'user-plugin': '1.0.0', 'lib': '2.0.0' },
      dsh: { profile: { bundles: ['user-plugin'] } },
    }))
    try {
      expect(inventory.installedBundles().installed).toEqual([{ name: 'user-plugin' }, { name: 'lib' }])
    } finally {
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

  it('setEnabled allows enabling a plugin pending on a dependency', async () => {
    const { ctx, inventory } = await harness()
    const id = await ctx.loader.create({ name: 'cordis:pending' }) as PluginEntryId
    await expect(inventory.setEnabled(id, true)).resolves.toEqual({ ok: true })
    // A plugin awaiting a service another enabled plugin provides stays
    // enabled (the loader activates it when the dependency resolves), so
    // interdependent plugins can be enabled together.
    expect(inventory.list().entries.find(entry => entry.entryId === id)?.enabled).toBe(true)
  })

  it('setEnabled fails loud when a plugin cannot apply', async () => {
    const { ctx, inventory } = await harness()
    const id = await ctx.loader.create({ name: 'cordis:failing', disabled: true }) as PluginEntryId
    await expect(inventory.setEnabled(id, true)).rejects.toThrow(/apply/)
    expect(inventory.list().entries.find(entry => entry.entryId === id)?.enabled).toBe(false)
  })

  it('registry install fails loud when no pnpm is available at all', async () => {
    const { ctx, inventory } = await harness()
    const dir = mkdtempSync(join(tmpdir(), 'dsh-inv-'))
    ctx.baseUrl = pathToFileURL(dir + '/').href
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-test', dsh: { profile: { bundles: [] } } }))
    delete process.env.DSH_PNPM
    const savedPath = process.env.PATH
    try {
      ctx.provide('dshInstallAnchor', join(dir, 'package.json'))
      ctx.provide('dshAllowPluginInstall', true)
      // Neither a vendored pnpm (DSH_PNPM deleted, no harness root) nor a PATH
      // pnpm (empty PATH) is present, so the gateway refuses loudly.
      process.env.PATH = ''
      await expect(inventory.installPlugin({ type: 'registry', spec: 'x' })).rejects.toThrow(/bundled pnpm is unavailable/)
    } finally {
      if (savedPath === undefined) delete process.env.PATH
      else process.env.PATH = savedPath
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

  it('marketplaceList marks entries installed only when the table and profile agree', async () => {
    const { ctx, inventory } = await harness()
    const dataDir = mkdtempSync(join(tmpdir(), 'dsh-inv-mp-'))
    const profileDir = mkdtempSync(join(tmpdir(), 'dsh-inv-mp-profile-'))
    ctx.baseUrl = pathToFileURL(profileDir + '/').href
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-test',
      dependencies: { x: '1.0.0' },
      dsh: { profile: { bundles: [] } },
    }))
    const savedHome = process.env.DSH_HOME
    process.env.DSH_HOME = dataDir
    const catalog = { plugins: [{ id: 'a', name: 'A', description: 'd', repository: 'https://github.com/dev/a', priority: 5 }] }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => catalog })))
    try {
      // No table entry: not installed.
      expect((await inventory.marketplaceList()).entries).toEqual([
        { id: 'a', name: 'A', description: 'd', repository: 'https://github.com/dev/a', priority: 5, installed: false },
      ])
      // Table entry but the profile lacks the dependency: not installed (drift).
      writeInstallTable(marketplaceDataDir(), { a: { method: 'git', spec: 'y', installedAt: 'now' } })
      expect((await inventory.marketplaceList()).entries).toEqual([
        { id: 'a', name: 'A', description: 'd', repository: 'https://github.com/dev/a', priority: 5, installed: false },
      ])
      // Table entry whose dependency is present in the profile: installed.
      writeInstallTable(marketplaceDataDir(), { a: { method: 'git', spec: 'x', installedAt: 'now' } })
      expect((await inventory.marketplaceList()).entries).toEqual([
        { id: 'a', name: 'A', description: 'd', repository: 'https://github.com/dev/a', priority: 5, installed: true },
      ])
    } finally {
      vi.unstubAllGlobals()
      if (savedHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = savedHome
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(profileDir, { recursive: true, force: true })
    }
  })

  it('marketplaceInstall installs a git spec and records it', async () => {
    const { ctx, inventory } = await harness()
    const profileDir = mkdtempSync(join(tmpdir(), 'dsh-inv-mp-'))
    ctx.baseUrl = pathToFileURL(profileDir + '/').href
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'dsh-profile-test', dsh: { profile: { bundles: [] } } }))
    const dataDir = mkdtempSync(join(tmpdir(), 'dsh-inv-mp-home-'))
    const savedHome = process.env.DSH_HOME
    process.env.DSH_HOME = dataDir
    const fakePnpm = join(profileDir, 'pnpm.cjs')
    writeFileSync(fakePnpm, 'process.exit(0)\n')
    process.env.DSH_PNPM = fakePnpm
    const catalog = { plugins: [{ id: 'a', name: 'A', description: 'd' }] }
    const spec = { id: 'a', install: { method: 'git', spec: 'github:user/a', dependency: 'a' } }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () => (url.endsWith('/plugins.json') ? catalog : spec),
    })))
    try {
      ctx.provide('dshInstallAnchor', join(profileDir, 'package.json'))
      ctx.provide('dshAllowPluginInstall', true)
      const result = await inventory.marketplaceInstall('a')
      expect(result.restartRequired).toBe(true)
      expect(readInstallTable(marketplaceDataDir())['a']).toMatchObject({
        method: 'git', spec: 'github:user/a', dependency: 'a',
      })
    } finally {
      vi.unstubAllGlobals()
      delete process.env.DSH_PNPM
      if (savedHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = savedHome
      rmSync(profileDir, { recursive: true, force: true })
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('records the real scoped package name when a git install resolves differently', async () => {
    const { ctx, inventory } = await harness()
    const profileDir = mkdtempSync(join(tmpdir(), 'dsh-inv-mp-'))
    ctx.baseUrl = pathToFileURL(profileDir + '/').href
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-test',
      // The git spec installed under its own package name, which carries a scope
      // the web spec's `dependency` guess omitted.
      dependencies: { '@dsh-external/a': 'github:user/a' },
      dsh: { profile: { bundles: [] } },
    }))
    const dataDir = mkdtempSync(join(tmpdir(), 'dsh-inv-mp-home-'))
    const savedHome = process.env.DSH_HOME
    process.env.DSH_HOME = dataDir
    const fakePnpm = join(profileDir, 'pnpm.cjs')
    writeFileSync(fakePnpm, 'process.exit(0)\n')
    process.env.DSH_PNPM = fakePnpm
    const catalog = { plugins: [{ id: 'a', name: 'A', description: 'd' }] }
    const spec = { id: 'a', install: { method: 'git', spec: 'github:user/a', dependency: 'a' } }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () => (url.endsWith('/plugins.json') ? catalog : spec),
    })))
    try {
      ctx.provide('dshInstallAnchor', join(profileDir, 'package.json'))
      ctx.provide('dshAllowPluginInstall', true)
      const result = await inventory.marketplaceInstall('a')
      expect(result.restartRequired).toBe(true)
      // The recorded dependency matches the profile, so the marketplace reports
      // it installed instead of a phantom not-installed state.
      expect(readInstallTable(marketplaceDataDir())['a']).toMatchObject({
        method: 'git', spec: 'github:user/a', dependency: '@dsh-external/a',
      })
      expect((await inventory.marketplaceList()).entries).toEqual([
        { id: 'a', name: 'A', description: 'd', installed: true },
      ])
    } finally {
      vi.unstubAllGlobals()
      delete process.env.DSH_PNPM
      if (savedHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = savedHome
      rmSync(profileDir, { recursive: true, force: true })
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('marketplaceUninstall removes the record after uninstalling the dependency', async () => {
    const { ctx, inventory } = await harness()
    const profileDir = mkdtempSync(join(tmpdir(), 'dsh-inv-mp-'))
    ctx.baseUrl = pathToFileURL(profileDir + '/').href
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-test',
      dependencies: { a: '1.0.0' },
      dsh: { profile: { bundles: [] } },
    }))
    const dataDir = mkdtempSync(join(tmpdir(), 'dsh-inv-mp-home-'))
    const savedHome = process.env.DSH_HOME
    process.env.DSH_HOME = dataDir
    const fakePnpm = join(profileDir, 'pnpm.cjs')
    writeFileSync(fakePnpm, [
      "const fs = require('fs')",
      "const pkg = JSON.parse(fs.readFileSync('package.json','utf8'))",
      'delete pkg.dependencies[process.argv[3]]',
      "fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\\n')",
      'process.exit(0)',
    ].join('\n'))
    process.env.DSH_PNPM = fakePnpm
    writeInstallTable(marketplaceDataDir(), { a: { method: 'npm', spec: 'a', dependency: 'a', installedAt: 'now' } })
    try {
      ctx.provide('dshInstallAnchor', join(profileDir, 'package.json'))
      ctx.provide('dshAllowPluginInstall', true)
      const result = await inventory.marketplaceUninstall('a')
      expect(result.restartRequired).toBe(true)
      expect(readInstallTable(marketplaceDataDir())).toEqual({})
    } finally {
      delete process.env.DSH_PNPM
      if (savedHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = savedHome
      rmSync(profileDir, { recursive: true, force: true })
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('marketplaceUninstall fails loud for a plugin not in the table', async () => {
    const { inventory } = await harness()
    await expect(inventory.marketplaceUninstall('missing')).rejects.toThrow(/not installed/)
  })
})
