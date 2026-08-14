/**
 * Persist a plugin's enable/disable override into a profile's user patch layer.
 *
 * A runtime `ctx.loader.update(id, { disabled })` toggles the plugin live but,
 * for a row enabled by a bundle patch, writes only the fully-patched tree — the
 * patch layer re-applies on the next read and the toggle does not survive a
 * restart. Durable control therefore writes a `- id: <rowId> disabled: true`
 * override into the profile's `cordis.patch.yml` (the last-applied user layer).
 * @module @deepseek-ai/dsh-plugin-inventory/persist
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'

/** One loader patch row (the shape the patch file's array carries). */
interface PatchRow {
  id?: string
  disabled?: boolean
}

/**
 * Upsert a `disabled` override for one plugin row in a profile patch. The state
 * is always written explicitly (`disabled: true` to disable, `false` to
 * re-enable over a bundle-default disable), never removed: dropping the row
 * would fall back to the bundle's own `disabled` default rather than the
 * user's choice. Writes atomically.
 * @param profileDir - the profile directory holding `cordis.patch.yml`.
 * @param rowId - the bare loader row id (entry's `options.id`, not the group-prefixed tree id).
 * @param disabled - the persisted disabled state to record.
 * @returns the absolute patch path written.
 */
export function persistPluginDisabled(profileDir: string, rowId: string, disabled: boolean): string {
  const patchPath = join(profileDir, 'cordis.patch.yml')
  const existing = existsSync(patchPath)
    ? yaml.load(readFileSync(patchPath, 'utf8'))
    : []
  const rows: PatchRow[] = Array.isArray(existing) ? existing.filter((row): row is PatchRow => row !== null && typeof row === 'object') : []
  const kept = rows.filter(row => row.id !== rowId)
  const text = yaml.dump([...kept, { id: rowId, disabled }], { lineWidth: -1 })
  const tmp = `${patchPath}.tmp`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, patchPath)
  return patchPath
}
