import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readProfileManifest } from '@deepseek-ai/dsh-app-boot'
import { composeOfflineBundle, resolvePnpm, runPnpmInstall, uninstallBundle } from '../src/install.ts'

const dirs: string[] = []

function makeProfile(bundles: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-install-'))
  dirs.push(dir)
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'dsh-profile-test', dsh: { profile: { bundles } } }, undefined, 2),
  )
  return dir
}

/** Make a bundle resolvable from a profile dir's node_modules. */
function makeBundle(dir: string, name: string): void {
  const pkgDir = join(dir, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name,
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  writeFileSync(join(pkgDir, 'cordis.patch.yml'), '[]\n')
}

/** A fake pnpm CLI that exits with the given code. */
function makeFakePnpm(dir: string, exitCode: number): string {
  const file = join(dir, `pnpm-${exitCode}.cjs`)
  writeFileSync(file, `process.exit(${exitCode})\n`)
  return file
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('composeOfflineBundle', () => {
  it('appends a resolvable bundle and stays idempotent', () => {
    const dir = makeProfile()
    makeBundle(dir, 'example-bundle')
    composeOfflineBundle('dsh', dir, join(dir, 'package.json'), 'example-bundle')
    expect(readProfileManifest('dsh', dir).dsh?.profile?.bundles).toEqual(['example-bundle'])
    composeOfflineBundle('dsh', dir, join(dir, 'package.json'), 'example-bundle')
    expect(readProfileManifest('dsh', dir).dsh?.profile?.bundles).toEqual(['example-bundle'])
  })

  it('fails loud for an unresolvable bundle', () => {
    const dir = makeProfile()
    expect(() => { composeOfflineBundle('dsh', dir, join(dir, 'package.json'), 'missing') }).toThrow(/cannot resolve/)
  })
})

describe('uninstallBundle', () => {
  it('removes a bundle from the layer list', () => {
    const dir = makeProfile(['example-bundle'])
    uninstallBundle('dsh', dir, 'example-bundle')
    expect(readProfileManifest('dsh', dir).dsh?.profile?.bundles).toEqual([])
  })
})

describe('runPnpmInstall', () => {
  it('reconciles without throwing on pnpm success', () => {
    const dir = makeProfile()
    const before = readProfileManifest('dsh', dir)
    const pnpm = makeFakePnpm(dir, 0)
    runPnpmInstall({
      binName: 'dsh', profileDir: dir, installAnchor: join(dir, 'package.json'),
      nodeBin: process.execPath, pnpmCjs: pnpm, spec: 'example', before,
    })
  })

  it('throws when pnpm fails', () => {
    const dir = makeProfile()
    const before = readProfileManifest('dsh', dir)
    const pnpm = makeFakePnpm(dir, 1)
    expect(() => { runPnpmInstall({
      binName: 'dsh', profileDir: dir, installAnchor: join(dir, 'package.json'),
      nodeBin: process.execPath, pnpmCjs: pnpm, spec: 'example', before,
    }) }).toThrow(/pnpm install failed/)
  })
})

describe('composeOfflineBundle with a bare manifest', () => {
  it('initializes an absent bundle list', () => {
    const dir = makeProfile()
    rmSync(join(dir, 'package.json'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-test' }))
    makeBundle(dir, 'example-bundle')
    composeOfflineBundle('dsh', dir, join(dir, 'package.json'), 'example-bundle')
    expect(readProfileManifest('dsh', dir).dsh?.profile?.bundles).toEqual(['example-bundle'])
  })
})

describe('uninstallBundle with a non-present bundle', () => {
  it('leaves the list unchanged', () => {
    const dir = makeProfile(['other'])
    uninstallBundle('dsh', dir, 'absent')
    expect(readProfileManifest('dsh', dir).dsh?.profile?.bundles).toEqual(['other'])
  })

  it('handles an absent bundle list', () => {
    const dir = makeProfile()
    rmSync(join(dir, 'package.json'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-test' }))
    uninstallBundle('dsh', dir, 'absent')
    expect(readProfileManifest('dsh', dir).dsh?.profile?.bundles).toEqual([])
  })
})

describe('runPnpmInstall spawn failure', () => {
  it('throws the spawn error when node cannot start', () => {
    const dir = makeProfile()
    const before = readProfileManifest('dsh', dir)
    expect(() => { runPnpmInstall({
      binName: 'dsh', profileDir: dir, installAnchor: join(dir, 'package.json'),
      nodeBin: '/nonexistent/node', pnpmCjs: '/x/pnpm.cjs', spec: 'x', before,
    }) }).toThrow()
  })
})

describe('resolvePnpm', () => {
  it('honors a DSH_PNPM override', () => {
    expect(resolvePnpm('/x/bin/node', { DSH_PNPM: '/vendored/pnpm.cjs' })).toBe('/vendored/pnpm.cjs')
  })

  it('derives the vendored pnpm beside the node harness root and misses when absent', () => {
    expect(resolvePnpm('/nonexistent/bin/node', {})).toBeUndefined()
  })

  it('finds a vendored pnpm beside the node harness root', () => {
    const dir = makeProfile()
    const harnessRoot = join(dir, 'harness')
    const pnpmDir = join(harnessRoot, 'pnpm', 'node_modules', 'pnpm', 'bin')
    mkdirSync(pnpmDir, { recursive: true })
    writeFileSync(join(pnpmDir, 'pnpm.cjs'), '')
    const nodeBin = join(harnessRoot, 'bin', 'node')
    mkdirSync(join(harnessRoot, 'bin'), { recursive: true })
    writeFileSync(nodeBin, '')
    expect(resolvePnpm(nodeBin, {})).toBe(join(pnpmDir, 'pnpm.cjs'))
  })
})
