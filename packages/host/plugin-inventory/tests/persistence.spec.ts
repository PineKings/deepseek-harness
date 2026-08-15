import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { composeEntries, initProfile, loadProfile, readProfileManifest, writeProfileManifest } from '@deepseek-ai/dsh-app-boot'
import { composeOfflineBundle } from '../src/install.ts'
import { persistPluginDisabled } from '../src/persist.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-persist-'))
  dirs.push(dir)
  return dir
}

/** Make a dsh.bundle package resolvable from a profile dir, inserting a plugin row. */
function makeBundle(profileDir: string, name: string, rowId: string): void {
  const pkgDir = join(profileDir, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name,
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  writeFileSync(join(pkgDir, 'cordis.patch.yml'), `- insert:\n    - id: ${rowId}\n      name: cordis:active\n`)
}

/** Simulate a restart: reload the profile and compose the effective entry list. */
function composeOnReload(binName: string, name: string, anchor: string, home: string) {
  const profile = loadProfile(binName, name, anchor, home)
  return composeEntries([...profile.layers.map(layer => layer.patches), profile.patches])
}

describe('plugin install + enable persistence across restart', () => {
  it('restores an installed bundle layer after a reload', () => {
    const home = tempDir()
    const profileName = 'persist'
    const profileDir = join(home, 'profiles', profileName)
    const anchor = join(profileDir, 'package.json')
    initProfile(profileDir, [])
    makeBundle(profileDir, 'example-bundle', 'b-row')

    composeOfflineBundle('dsh', profileDir, anchor, 'example-bundle')
    expect(readProfileManifest('dsh', profileDir).dsh?.profile?.bundles).toEqual(['example-bundle'])

    // Restart recomposes the bundle layer into the Loader entry tree.
    const entries = composeOnReload('dsh', profileName, anchor, home)
    expect(entries.some(entry => entry.id === 'b-row' && entry.name === 'cordis:active')).toBe(true)
  })

  it('restores a persisted enable/disable override after a reload', () => {
    const home = tempDir()
    const profileName = 'persist'
    const profileDir = join(home, 'profiles', profileName)
    const anchor = join(profileDir, 'package.json')
    initProfile(profileDir, [])
    makeBundle(profileDir, 'example-bundle', 'b-row')
    composeOfflineBundle('dsh', profileDir, anchor, 'example-bundle')

    // User disables, then enables the plugin; the override is persisted.
    persistPluginDisabled(profileDir, 'b-row', true)
    let entries = composeOnReload('dsh', profileName, anchor, home)
    expect(entries.find(entry => entry.id === 'b-row')?.disabled).toBe(true)

    persistPluginDisabled(profileDir, 'b-row', false)
    entries = composeOnReload('dsh', profileName, anchor, home)
    expect(entries.find(entry => entry.id === 'b-row')?.disabled).toBe(false)
  })

  it('keeps a registry-installed bundle plugin loadable after a reload', () => {
    const home = tempDir()
    const profileName = 'persist'
    const profileDir = join(home, 'profiles', profileName)
    const anchor = join(profileDir, 'package.json')
    initProfile(profileDir, [])
    makeBundle(profileDir, 'registry-bundle', 'reg-row')

    // A registry install reconciles the bundle layer (the pnpm part is out of
    // scope here; the layer persistence is what survives the restart).
    const manifest = readProfileManifest('dsh', profileDir)
    manifest.dependencies = { ...manifest.dependencies, 'registry-bundle': '1.0.0' }
    manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: ['registry-bundle'] } }
    writeProfileManifest(profileDir, manifest)

    const entries = composeOnReload('dsh', profileName, anchor, home)
    expect(entries.some(entry => entry.id === 'reg-row')).toBe(true)
  })
})
