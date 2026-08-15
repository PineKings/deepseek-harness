import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverLocalSkills } from '../src/discovery.ts'

const dirs: string[] = []
const savedEnv: Record<string, string | undefined> = {}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = value
  }
  Object.keys(savedEnv).forEach((key) => { Reflect.deleteProperty(savedEnv, key) })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-discovery-'))
  dirs.push(dir)
  return dir
}

function withEnv(key: string, value: string): void {
  savedEnv[key] = process.env[key]
  process.env[key] = value
}

function makeSkill(root: string, name: string, description = 'A skill'): void {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`)
}

describe('discoverLocalSkills', () => {
  it('discovers skills from the user DSH and agents roots', () => {
    const home = tempDir()
    const agents = tempDir()
    withEnv('DSH_HOME', home)
    withEnv('DSH_AGENTS_HOME', agents)
    makeSkill(join(home, 'skills'), 'user-skill')
    makeSkill(join(agents, 'skills'), 'agent-skill')
    withEnv('DSH_BUNDLED_SKILL_DIR', join(tempDir(), 'nonexistent'))

    const skills = discoverLocalSkills(join(home, 'cwd'))
    expect(skills.map(s => s.name)).toEqual(['agent-skill', 'user-skill'])
    const user = skills.find(s => s.name === 'user-skill')!
    expect(user).toMatchObject({ source: 'user-dsh', managed: true })
    const agent = skills.find(s => s.name === 'agent-skill')!
    expect(agent).toMatchObject({ source: 'user-agents', managed: false })
  })

  it('discovers bundled and project skills, with project winning by rank', () => {
    const home = tempDir()
    const agents = tempDir()
    const bundled = tempDir()
    const project = tempDir()
    withEnv('DSH_HOME', home)
    withEnv('DSH_AGENTS_HOME', agents)
    withEnv('DSH_BUNDLED_SKILL_DIR', bundled)
    makeSkill(join(bundled), 'bundled-skill')
    // Same name in the project and user roots: the project (lower rank) wins.
    makeSkill(join(project, '.agents', 'skills'), 'shared', 'project version')
    makeSkill(join(home, 'skills'), 'shared', 'user version')

    const skills = discoverLocalSkills(project)
    expect(skills.find(s => s.name === 'bundled-skill')?.source).toBe('bundled')
    const shared = skills.find(s => s.name === 'shared')!
    expect(shared).toMatchObject({ source: 'project-agents', description: 'project version' })
  })

  it('marks user-dsh skills as managed and reads invocation frontmatter', () => {
    const home = tempDir()
    withEnv('DSH_HOME', home)
    withEnv('DSH_AGENTS_HOME', tempDir())
    const dir = join(home, 'skills', 'my-skill')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: my-skill\ndescription: A\ndisable-model-invocation: true\nuser-invocable: false\n---\nbody\n')

    const skill = discoverLocalSkills(home).find(s => s.name === 'my-skill')!
    expect(skill).toMatchObject({ managed: true, invocation: { modelInvocable: false, userInvocable: false } })
  })

  it('skips skills whose frontmatter name does not match the bundle, or that are malformed', () => {
    const home = tempDir()
    withEnv('DSH_HOME', home)
    withEnv('DSH_AGENTS_HOME', tempDir())
    const root = join(home, 'skills')
    mkdirSync(join(root, 'ok-skill'), { recursive: true })
    writeFileSync(join(root, 'ok-skill', 'SKILL.md'), '---\nname: ok-skill\ndescription: A\n---\nbody\n')
    // name mismatch
    mkdirSync(join(root, 'mismatch'), { recursive: true })
    writeFileSync(join(root, 'mismatch', 'SKILL.md'), '---\nname: different\ndescription: A\n---\nbody\n')
    // no description
    mkdirSync(join(root, 'nodesc'), { recursive: true })
    writeFileSync(join(root, 'nodesc', 'SKILL.md'), '---\nname: nodesc\n---\nbody\n')

    const skills = discoverLocalSkills(home)
    expect(skills.map(s => s.name)).toEqual(['ok-skill'])
  })
})
