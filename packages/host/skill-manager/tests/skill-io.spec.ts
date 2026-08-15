import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deleteSkill, installSkillDir, parseSkillFile, readSkillText, rewriteSkillFile,
  skillExists, SKILL_NAME, writeSkillFile,
} from '../src/skill-io.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-skill-io-'))
  dirs.push(dir)
  return dir
}

const VALID = '---\nname: my-skill\ndescription: A demo skill\n---\n# My skill\nBody here.\n'

describe('parseSkillFile', () => {
  it('parses name, description, and default invocation', () => {
    const parsed = parseSkillFile(VALID)
    expect(parsed).toMatchObject({
      name: 'my-skill',
      description: 'A demo skill',
      invocation: { modelInvocable: true, userInvocable: true },
    })
    expect(parsed.body).toContain('# My skill')
  })

  it('honors invocation frontmatter and whenToUse', () => {
    const content = '---\nname: my-skill\ndescription: A\ndisable-model-invocation: true\nuser-invocable: false\nwhenToUse: When X\n---\nbody\n'
    const parsed = parseSkillFile(content)
    expect(parsed.invocation).toEqual({ modelInvocable: false, userInvocable: false })
    expect(parsed.whenToUse).toBe('When X')
  })

  it('rejects an invalid skill name, a missing description, or no frontmatter', () => {
    expect(() => parseSkillFile('---\nname: My Skill\ndescription: A\n---\nbody\n')).toThrow(/invalid skill name/)
    expect(() => parseSkillFile('---\nname: my-skill\n---\nbody\n')).toThrow(/no description/)
    expect(() => parseSkillFile('# no frontmatter\n')).toThrow(/no frontmatter/)
  })
})

describe('rewriteSkillFile', () => {
  it('toggles invocation and edits description while preserving the body', () => {
    const rewritten = rewriteSkillFile(VALID, { model: false, user: false, description: 'New desc' })
    expect(rewritten).toContain('disable-model-invocation: true')
    expect(rewritten).toContain('user-invocable: false')
    expect(rewritten).toContain('description: New desc')
    expect(rewritten).toContain('# My skill')
  })

  it('re-enabling writes explicit false values', () => {
    const disabled = rewriteSkillFile(VALID, { model: false })
    const enabled = rewriteSkillFile(disabled, { model: true })
    expect(enabled).toContain('disable-model-invocation: false')
  })
})

describe('skill filesystem helpers', () => {
  it('reports existence and installs/deletes a directory bundle', () => {
    const root = tempDir()
    const src = tempDir()
    mkdirSync(join(src, 'my-skill'), { recursive: true })
    writeFileSync(join(src, 'my-skill', 'SKILL.md'), VALID)
    expect(skillExists(root, 'my-skill')).toBe(false)
    installSkillDir(root, 'my-skill', join(src, 'my-skill'))
    expect(skillExists(root, 'my-skill')).toBe(true)
    expect(readFileSync(join(root, 'my-skill', 'SKILL.md'), 'utf8')).toContain('name: my-skill')
    deleteSkill(root, 'my-skill')
    expect(skillExists(root, 'my-skill')).toBe(false)
  })

  it('writeSkillFile rewrites the SKILL.md in place', () => {
    const root = tempDir()
    mkdirSync(join(root, 'my-skill'), { recursive: true })
    writeFileSync(join(root, 'my-skill', 'SKILL.md'), VALID)
    writeSkillFile(root, 'my-skill', rewriteSkillFile(readSkillText(join(root, 'my-skill', 'SKILL.md')), { description: 'X' }))
    expect(readFileSync(join(root, 'my-skill', 'SKILL.md'), 'utf8')).toContain('description: X')
  })
})

describe('SKILL_NAME', () => {
  it('accepts kebab-case and rejects other shapes', () => {
    expect(SKILL_NAME.test('my-skill')).toBe(true)
    expect(SKILL_NAME.test('my')).toBe(true)
    expect(SKILL_NAME.test('My-Skill')).toBe(false)
    expect(SKILL_NAME.test('my_skill')).toBe(false)
    expect(SKILL_NAME.test('my skill')).toBe(false)
  })
})
