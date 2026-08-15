import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchMarketplaceCatalog,
  fetchMarketplaceSpec,
  marketplaceBaseUrl,
  marketplaceSpecUrl,
  readInstallTable,
  writeInstallTable,
} from '../src/marketplace.ts'
import type { InstalledMarketplacePlugin } from '../src/types.ts'

const dirs: string[] = []

afterEach(() => {
  vi.unstubAllGlobals()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-marketplace-'))
  dirs.push(dir)
  return dir
}

/** Stub global fetch to return `body` for every URL, or a per-URL value. */
function stubFetch(body: unknown, resolve?: (url: string) => unknown): void {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    async json() { return resolve === undefined ? body : resolve(url) },
  }))
  vi.stubGlobal('fetch', fetchMock)
}

describe('marketplaceBaseUrl', () => {
  it('strips the trailing plugins.json to the catalog directory', () => {
    expect(marketplaceBaseUrl('https://x/plugins/plugins.json')).toBe('https://x/plugins/')
  })

  it('leaves a URL without the catalog filename unchanged', () => {
    expect(marketplaceBaseUrl('https://x/plugins/')).toBe('https://x/plugins/')
  })
})

describe('marketplaceSpecUrl', () => {
  it('appends the id and .json under the base, encoding the id', () => {
    expect(marketplaceSpecUrl('https://x/plugins/', 'my-plugin')).toBe('https://x/plugins/my-plugin.json')
    expect(marketplaceSpecUrl('https://x/plugins/', 'a b')).toBe('https://x/plugins/a%20b.json')
  })
})

describe('fetchMarketplaceCatalog', () => {
  it('parses the catalog list, filling display defaults', async () => {
    stubFetch({
      plugins: [
        { id: 'a', name: 'A', description: 'desc', author: 'Dev', version: '1.0.0', recommended: true },
        { id: 'b' },
        { id: 'c', name: 'C', description: '', recommended: false },
      ],
    })
    await expect(fetchMarketplaceCatalog('https://x/plugins/plugins.json')).resolves.toEqual([
      { id: 'a', name: 'A', description: 'desc', author: 'Dev', version: '1.0.0', recommended: true },
      { id: 'b', name: 'b', description: '' },
      { id: 'c', name: 'C', description: '', recommended: false },
    ])
  })

  it('rejects an entry without an id', async () => {
    stubFetch({ plugins: [{ name: 'A' }] })
    await expect(fetchMarketplaceCatalog('https://x/plugins/plugins.json')).rejects.toThrow(/missing an id/)
  })

  it('throws on an HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })))
    await expect(fetchMarketplaceCatalog('https://x/plugins/plugins.json')).rejects.toThrow(/HTTP 503/)
  })
})

describe('fetchMarketplaceSpec', () => {
  it('parses a git install method with its dependency', async () => {
    stubFetch(
      { id: 'a', install: { method: 'git', spec: 'github:user/a', dependency: 'a' } },
      (url) => {
        expect(url).toBe('https://x/plugins/a.json')
        return { id: 'a', install: { method: 'git', spec: 'github:user/a', dependency: 'a' } }
      },
    )
    await expect(fetchMarketplaceSpec('https://x/plugins/', 'a')).resolves.toEqual({
      id: 'a', method: 'git', spec: 'github:user/a', dependency: 'a',
    })
  })

  it('parses a bundle method without a dependency', async () => {
    stubFetch({ id: 'a', install: { method: 'bundle', spec: '@scope/b' } })
    await expect(fetchMarketplaceSpec('https://x/plugins/', 'a')).resolves.toEqual({
      id: 'a', method: 'bundle', spec: '@scope/b',
    })
  })

  it('rejects an unsupported install method', async () => {
    stubFetch({ id: 'a', install: { method: 'cargo', spec: 'a' } })
    await expect(fetchMarketplaceSpec('https://x/plugins/', 'a')).rejects.toThrow(/no supported install method/)
  })

  it('rejects a missing install spec', async () => {
    stubFetch({ id: 'a', install: { method: 'npm' } })
    await expect(fetchMarketplaceSpec('https://x/plugins/', 'a')).rejects.toThrow(/no install spec/)
  })
})

describe('install table persistence', () => {
  it('reads an empty table when the file is absent', () => {
    expect(readInstallTable(join(tempDir(), 'nonexistent'))).toEqual({})
  })

  it('reads an empty table for a malformed file', () => {
    const dir = tempDir()
    writeInstallTable(dir, { a: { method: 'npm', spec: 'a', installedAt: 'x' } })
    writeFileSync(join(dir, 'installed.json'), 'not json', 'utf8')
    expect(readInstallTable(dir)).toEqual({})
  })

  it('round-trips the table, creating the directory and writing atomically', () => {
    const dir = tempDir()
    const row: InstalledMarketplacePlugin = { method: 'git', spec: 'github:user/a', dependency: 'a', installedAt: '2026-08-15T00:00:00.000Z' }
    writeInstallTable(dir, { a: row })
    expect(readInstallTable(dir)).toEqual({ a: row })
    const raw = readFileSync(join(dir, 'installed.json'), 'utf8')
    expect(raw).toContain('"github:user/a"')
    // The atomic write leaves no temp file behind.
    expect(existsSync(join(dir, 'installed.json.tmp'))).toBe(false)
  })

  it('overwrites the table on a second write', () => {
    const dir = tempDir()
    writeInstallTable(dir, { a: { method: 'npm', spec: 'a', installedAt: 'x' } })
    writeInstallTable(dir, { b: { method: 'bundle', spec: 'b', installedAt: 'y' } })
    expect(readInstallTable(dir)).toEqual({ b: { method: 'bundle', spec: 'b', installedAt: 'y' } })
  })
})
