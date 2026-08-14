#!/usr/bin/env node
/**
 * Stage a built release into the `deepseek-harness-web` site so it can be
 * published in one deploy. Copies `apps/desktop/dist`'s `releases.json` and the
 * platform installers (.dmg/.exe) into `../deepseek-harness-web/updates/` — the
 * site root's `updates/` folder (deploy.py uploads the repo root to the bucket
 * root) that both the web download page and the desktop update check
 * (`DSH_UPDATE_URL`) read from.
 *
 * Run after `desktop:pack` + `generate-release-json`, then deploy the site:
 *   cd ../deepseek-harness-web && python3 deploy.py
 *
 * Flags:
 *   --dry-run   print what would be copied without touching the filesystem.
 *   --site <path>   override the deepseek-harness-web repo path (default: sibling dir).
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const dist = join(root, 'apps/desktop/dist')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const siteFlag = args.find((a) => a.startsWith('--site='))
const siteRoot = siteFlag === undefined
  ? resolve(root, '../deepseek-harness-web')
  : resolve(root, siteFlag.slice('--site='.length))

/** Names the site root's update channel lives at (`updates/`). */
const updatesDir = join(siteRoot, 'updates')

/** Platform installer and manifest files staged to the site. */
const artifactNames = () => {
  if (!existsSync(dist)) return []
  return readdirSync(dist).filter((f) => f === 'releases.json' || f.endsWith('.dmg') || f.endsWith('.exe'))
}

const artifacts = artifactNames()
if (artifacts.length === 0) {
  console.error(`stage-release: no releases.json or installers found in ${dist}`)
  console.error('Run `desktop:pack` and `generate-release-json` first.')
  process.exit(1)
}

console.log(`staging ${artifacts.length} artifact(s) from ${dist}`)
console.log(`  → ${updatesDir}${dryRun ? ' (dry run)' : ''}`)
for (const name of artifacts) {
  console.log(`  ${dryRun ? 'would copy' : 'copying'}  ${name}`)
  if (dryRun) continue
  mkdirSync(updatesDir, { recursive: true })
  cpSync(join(dist, name), join(updatesDir, name))
}

// A stale installer left from a previous release should not linger on the site.
const stale = existsSync(updatesDir)
  ? readdirSync(updatesDir).filter((name) => !artifacts.includes(name) && (name.endsWith('.dmg') || name.endsWith('.exe')))
  : []
for (const name of stale) {
  console.log(`  ${dryRun ? 'would remove stale' : 'removing stale'}  ${name}`)
  if (!dryRun) rmSync(join(updatesDir, name), { force: true })
}

if (dryRun) console.log('(dry run: no files were written)')
console.log('done. Deploy with `cd ../deepseek-harness-web && python3 deploy.py`.')
