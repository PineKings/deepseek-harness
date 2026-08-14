#!/usr/bin/env node
/**
 * Generate the OSS update manifest (`releases.json`) from the packaged
 * installers in `apps/desktop/dist`. The manifest drives both the desktop app's
 * manual "check for updates" (main-process fetch + version compare) and the
 * web download page. Run after `desktop:pack`, then upload `releases.json`
 * together with the installers to the OSS `updates/` folder.
 *
 * The installer URLs are derived from the `DSH_UPDATE_BASE` (default
 * `https://deepseek.pinesound.cn/updates/`) plus the artifact filename.
 * `DSH_RELEASE_NOTES` optionally supplies the release-notes text.
 */

import { readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const dist = join(root, 'apps/desktop/dist')
const base = process.env.DSH_UPDATE_BASE ?? 'https://deepseek.pinesound.cn/updates/'

/** Extract a semver-ish version from a filename like `…0.1.0-rc.5-arm64.dmg`. */
function versionOf(filename) {
  const base = filename.replace(/\.(dmg|exe)$/, '').replace(/-(arm64|x64)$/, '')
  const match = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)$/.exec(base)
  return match === null ? undefined : match[1]
}

const platforms = {}
let latestVersion
let latestDate = process.env.DSH_RELEASE_DATE ?? new Date().toISOString().slice(0, 10)

for (const entry of readdirSync(dist)) {
  if (!entry.endsWith('.dmg') && !entry.endsWith('.exe')) continue
  const version = versionOf(entry)
  if (version === undefined) continue
  const key = entry.endsWith('.dmg')
    ? entry.includes('arm64') ? 'mac-arm64' : 'mac-x64'
    : 'win-x64'
  platforms[key] = { url: `${base}${encodeURIComponent(entry)}` }
  if (latestVersion === undefined || version > latestVersion) {
    latestVersion = version
    latestDate = process.env.DSH_RELEASE_DATE ?? new Date().toISOString().slice(0, 10)
  }
}

if (latestVersion === undefined) {
  console.error(`generate-release-json: no installers found in ${dist}`)
  process.exit(1)
}

const manifest = {
  latest: { version: latestVersion, date: latestDate },
  releaseNotes: process.env.DSH_RELEASE_NOTES ?? '',
  platforms,
}

writeFileSync(join(dist, 'releases.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`wrote ${join(dist, 'releases.json')} for ${latestVersion}`)
