import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveSkill } from '../src/install.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-skill-install-'))
  dirs.push(dir)
  return dir
}

function makeSkill(dir: string, name: string, description = 'A skill'): void {
  mkdirSync(join(dir, name), { recursive: true })
  writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`)
}

describe('resolveSkill (local source)', () => {
  it('resolves a directory bundle at the source root', async () => {
    const src = tempDir()
    makeSkill(src, 'my-skill')
    const work = tempDir()
    const resolved = await resolveSkill({ source: 'local', spec: join(src, 'my-skill') }, work)
    expect(resolved.name).toBe('my-skill')
    expect(resolved.description).toBe('A skill')
    expect(resolved.skillDir).toBe(join(src, 'my-skill'))
  })

  it('resolves a skills/<name> pack layout under the source', async () => {
    const src = tempDir()
    makeSkill(join(src, 'skills'), 'packed-skill')
    const work = tempDir()
    const resolved = await resolveSkill({ source: 'local', spec: src }, work)
    expect(resolved.name).toBe('packed-skill')
    expect(resolved.skillDir).toBe(join(src, 'skills', 'packed-skill'))
  })

  it('rejects a source without a SKILL.md', async () => {
    const src = tempDir()
    writeFileSync(join(src, 'README.md'), '# no skill\n')
    const work = tempDir()
    await expect(resolveSkill({ source: 'local', spec: src }, work)).rejects.toThrow(/no SKILL\.md found/)
  })

  it('rejects a source with an invalid skill name', async () => {
    const src = tempDir()
    writeFileSync(join(src, 'SKILL.md'), '---\nname: Bad Name\ndescription: A\n---\nbody\n')
    const work = tempDir()
    await expect(resolveSkill({ source: 'local', spec: src }, work)).rejects.toThrow(/invalid skill name/)
  })

  it('rejects a missing local directory', async () => {
    const work = tempDir()
    await expect(resolveSkill({ source: 'local', spec: join(tempDir(), 'nope') }, work))
      .rejects.toThrow(/not found/)
  })
})
