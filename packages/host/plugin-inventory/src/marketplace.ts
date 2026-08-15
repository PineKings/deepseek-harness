/**
 * Pure helpers behind the plugin-marketplace Remotes: catalog fetch and the
 * durable per-user install table.
 *
 * The catalog lives on the static web host (deepseek-harness-web): one index
 * JSON listing plugins plus a per-plugin JSON prescribing the install method.
 * The install table is a small JSON document under the user data root and is
 * the authoritative "is this plugin installed" check for the marketplace UI.
 * Neither helper touches Cordis, so both unit-test without a context.
 *
 * Per-plugin spec URLs are derived from the catalog base plus the plugin id,
 * never read from catalog content, so a hostile catalog cannot point the app
 * at an arbitrary URL.
 * @module @deepseek-ai/dsh-host-plugin-inventory/marketplace
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {
  InstalledMarketplacePlugin,
  MarketplaceInstallMethod,
  MarketplaceInstallSpec,
  MarketplacePluginMeta,
} from './types.ts'

/** The marketplace catalog index file name. */
export const CATALOG_FILE = 'plugins.json'

/**
 * The remote marketplace catalog index. Defaults to the static web host that
 * also serves the app's update manifest; a deployment overrides it with
 * `DSH_MARKETPLACE_URL`.
 */
export const MARKETPLACE_URL = process.env.DSH_MARKETPLACE_URL
  ?? 'https://deepseek.pinesound.cn/plugins/plugins.json'

/** The directory under the user data root that holds the marketplace install table. */
const DATA_DIR = 'plugin-marketplace'

/** The install table file name under {@link DATA_DIR}. */
const TABLE_FILE = 'installed.json'

/** The install methods the catalog may prescribe. */
const METHODS: readonly MarketplaceInstallMethod[] = ['git', 'npm', 'tarball', 'bundle']

/**
 * The directory where the marketplace persists the user's install table.
 * @returns the absolute `$DSH_HOME/plugin-marketplace` directory.
 */
export function marketplaceDataDir(): string {
  return dshHomePath(DATA_DIR)
}

/**
 * Derive the marketplace base URL (the catalog's directory, ending in `/`)
 * from its index URL, so per-plugin specs resolve beside the index.
 * @param catalogUrl - the catalog index URL.
 * @returns the base directory URL.
 */
export function marketplaceBaseUrl(catalogUrl: string): string {
  return catalogUrl.endsWith(`/${CATALOG_FILE}`) ? catalogUrl.slice(0, -CATALOG_FILE.length) : catalogUrl
}

/**
 * The per-plugin spec URL for `id`. Built from the fixed catalog base plus the
 * id, never from catalog content.
 * @param baseUrl - the marketplace base URL from {@link marketplaceBaseUrl}.
 * @param id - the plugin id.
 * @returns the spec URL.
 */
export function marketplaceSpecUrl(baseUrl: string, id: string): string {
  return `${baseUrl}${encodeURIComponent(id)}.json`
}

/**
 * Fetch and parse the marketplace catalog index. Throws on an HTTP error or a
 * malformed entry so the caller can surface a clean failure.
 * @param catalogUrl - the catalog index URL.
 * @returns the catalog entries.
 */
export async function fetchMarketplaceCatalog(catalogUrl: string): Promise<MarketplacePluginMeta[]> {
  const response = await fetch(catalogUrl)
  if (!response.ok) throw new Error(`marketplace catalog HTTP ${response.status}`)
  const body = await response.json() as { plugins?: unknown }
  const plugins = Array.isArray(body.plugins) ? body.plugins : []
  return plugins.map(parseMeta)
}

/**
 * Fetch and parse one plugin's install spec. Throws on an HTTP error or a
 * malformed body.
 * @param baseUrl - the marketplace base URL from {@link marketplaceBaseUrl}.
 * @param id - the plugin id.
 * @returns the install spec.
 */
export async function fetchMarketplaceSpec(baseUrl: string, id: string): Promise<MarketplaceInstallSpec> {
  const response = await fetch(marketplaceSpecUrl(baseUrl, id))
  if (!response.ok) throw new Error(`marketplace plugin ${id} HTTP ${response.status}`)
  const body = await response.json() as Record<string, unknown>
  return parseSpec(body)
}

/**
 * Read the user's plugin install table, or an empty table when the file is
 * absent or malformed (a missing or corrupt table simply reports nothing
 * installed, never crashes the marketplace).
 * @param dataDir - the marketplace data directory.
 * @returns the install table keyed by plugin id.
 */
export function readInstallTable(dataDir: string): Record<string, InstalledMarketplacePlugin> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dataDir, TABLE_FILE), 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, InstalledMarketplacePlugin>
      : {}
  } catch {
    return {}
  }
}

/**
 * Write the install table atomically, creating the data directory if needed.
 * @param dataDir - the marketplace data directory.
 * @param table - the install table keyed by plugin id.
 */
export function writeInstallTable(dataDir: string, table: Record<string, InstalledMarketplacePlugin>): void {
  const path = join(dataDir, TABLE_FILE)
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(table, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
}

/** Validate one catalog index entry into {@link MarketplacePluginMeta}. */
function parseMeta(raw: unknown): MarketplacePluginMeta {
  const value = raw as Record<string, unknown>
  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new Error('marketplace catalog entry missing an id')
  }
  return {
    id: value.id,
    name: typeof value.name === 'string' ? value.name : value.id,
    description: typeof value.description === 'string' ? value.description : '',
    ...(typeof value.author === 'string' ? { author: value.author } : {}),
    ...(typeof value.version === 'string' ? { version: value.version } : {}),
    ...(typeof value.repository === 'string' ? { repository: value.repository } : {}),
    ...(typeof value.recommended === 'boolean' ? { recommended: value.recommended } : {}),
    ...(typeof value.priority === 'number' ? { priority: value.priority } : {}),
  }
}

/** Validate one per-plugin install spec into {@link MarketplaceInstallSpec}. */
function parseSpec(raw: Record<string, unknown>): MarketplaceInstallSpec {
  const id = typeof raw.id === 'string' ? raw.id : ''
  const install = raw.install as Record<string, unknown> | undefined
  const method = install?.method
  if (!METHODS.includes(method as MarketplaceInstallMethod)) {
    throw new Error(`marketplace plugin ${id || '?'} prescribes no supported install method`)
  }
  const spec = typeof install?.spec === 'string' ? install.spec : ''
  if (spec.length === 0) throw new Error(`marketplace plugin ${id || '?'} prescribes no install spec`)
  return {
    id,
    method: method as MarketplaceInstallMethod,
    spec,
    ...(typeof install?.dependency === 'string' ? { dependency: install.dependency } : {}),
  }
}
