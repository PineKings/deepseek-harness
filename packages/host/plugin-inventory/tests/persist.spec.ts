import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { persistPluginDisabled } from '../src/persist.ts'

/** A scratch profile dir with a given starting patch. */
function profile(initial: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-plugin-persist-'))
  writeFileSync(join(dir, 'cordis.patch.yml'), initial)
  return dir
}

describe('persistPluginDisabled', () => {
  it('appends a disabled override to an empty patch', () => {
    const dir = profile('[]\n')
    persistPluginDisabled(dir, 'image-recognition-http', true)
    const text = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(text).toContain('image-recognition-http')
    expect(text).toContain('disabled: true')
  })

  it('writes disabled: false to override a bundle-default disable', () => {
    const dir = profile('- id: tool-web\n  disabled: true\n')
    persistPluginDisabled(dir, 'tool-web', false)
    const text = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(text).toContain('tool-web')
    expect(text).toContain('disabled: false')
  })

  it('replaces an existing override for the same row instead of duplicating', () => {
    const dir = profile('- id: image-recognition-http\n  disabled: true\n')
    persistPluginDisabled(dir, 'image-recognition-http', false)
    const text = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(text.match(/image-recognition-http/g)).toHaveLength(1)
    expect(text).not.toContain('disabled: true')
  })

  it('creates the patch file when it does not yet exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-plugin-persist-'))
    persistPluginDisabled(dir, 'image-recognition-http', true)
    const text = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(text).toContain('image-recognition-http')
    expect(text).toContain('disabled: true')
    rmSync(dir, { recursive: true, force: true })
  })

  it('treats a non-array patch file as empty', () => {
    const dir = profile('not-an-array\n')
    persistPluginDisabled(dir, 'image-recognition-http', true)
    const text = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(text).toContain('image-recognition-http')
    expect(text).not.toContain('not-an-array')
  })
})
