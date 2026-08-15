import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import SkillManagerGateway from '../src/index.ts'

const contexts: Context[] = []
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-skill-manager-'))
  dirs.push(dir)
  return dir
}

function withUserHome(): { dir: string; restore: () => void } {
  const dir = tempDir()
  const savedHome = process.env.DSH_HOME
  const savedAgents = process.env.DSH_AGENTS_HOME
  process.env.DSH_HOME = dir
  process.env.DSH_AGENTS_HOME = join(dir, 'agents')
  return {
    dir,
    restore: () => {
      if (savedHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = savedHome
      if (savedAgents === undefined) delete process.env.DSH_AGENTS_HOME
      else process.env.DSH_AGENTS_HOME = savedAgents
    },
  }
}

async function harness() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillManagerGateway)
  const manager = ctx.get('skillManager') as SkillManagerGateway
  return { ctx, manager }
}

/** Create a user-root skill at `$DSH_HOME/skills/<name>` and return its SKILL.md path. */
function createUserSkill(home: string, name: string, frontmatter = ''): string {
  const dir = join(home, 'skills', name)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'SKILL.md')
  writeFileSync(path, `---\nname: ${name}\ndescription: A skill\n${frontmatter}---\nbody\n`)
  return path
}

describe('SkillManagerGateway', () => {
  it('publishes direct methods under the skillManager namespace', async () => {
    const { manager } = await harness()
    expect(manager.typertRemote).toMatchObject({ serviceKey: 'skillManager', namespace: 'skillManager' })
    expect(remoteMethods(manager)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'installSkill', invocation: { kind: 'direct' } },
      { method: 'uninstallSkill', invocation: { kind: 'direct' } },
      { method: 'setEnabled', invocation: { kind: 'direct' } },
      { method: 'setDescription', invocation: { kind: 'direct' } },
    ])
  })

  it('lists local skills discovered from the user root', async () => {
    const { manager } = await harness()
    const home = withUserHome()
    try {
      createUserSkill(home.dir, 'foo-bar')
      createUserSkill(home.dir, 'bar-baz', 'disable-model-invocation: true\n')
      const snapshot = manager.list(join(home.dir, 'cwd'))
      expect(snapshot.skills).toEqual([
        {
          name: 'bar-baz',
          description: 'A skill',
          source: 'user-dsh',
          provider: 'filesystem',
          invocation: { modelInvocable: false, userInvocable: true },
          managed: true,
          path: join(home.dir, 'skills', 'bar-baz', 'SKILL.md'),
        },
        {
          name: 'foo-bar',
          description: 'A skill',
          source: 'user-dsh',
          provider: 'filesystem',
          invocation: { modelInvocable: true, userInvocable: true },
          managed: true,
          path: join(home.dir, 'skills', 'foo-bar', 'SKILL.md'),
        },
      ])
    } finally {
      home.restore()
    }
  })

  it('installs a local skill into the user root', async () => {
    const { manager } = await harness()
    const home = withUserHome()
    try {
      const src = tempDir()
      mkdirSync(join(src, 'my-skill'), { recursive: true })
      writeFileSync(join(src, 'my-skill', 'SKILL.md'), '---\nname: my-skill\ndescription: A skill\n---\n# My skill\n')
      await expect(manager.installSkill({ source: 'local', spec: join(src, 'my-skill') }))
        .resolves.toEqual({ ok: true, name: 'my-skill' })
      const installed = join(home.dir, 'skills', 'my-skill', 'SKILL.md')
      expect(readFileSync(installed, 'utf8')).toContain('name: my-skill')
    } finally {
      home.restore()
    }
  })

  it('uninstalls a user-root skill and refuses a missing one', async () => {
    const { manager } = await harness()
    const home = withUserHome()
    try {
      createUserSkill(home.dir, 'my-skill')
      expect(manager.uninstallSkill('my-skill')).toEqual({ ok: true, name: 'my-skill' })
      expect(existsSync(join(home.dir, 'skills', 'my-skill'))).toBe(false)
      expect(() => manager.uninstallSkill('not-here')).toThrow(/not installed/)
    } finally {
      home.restore()
    }
  })

  it('toggles invocation by rewriting frontmatter', async () => {
    const { manager } = await harness()
    const home = withUserHome()
    try {
      const path = createUserSkill(home.dir, 'my-skill')
      manager.setEnabled('my-skill', { model: false, user: false })
      let content = readFileSync(path, 'utf8')
      expect(content).toContain('disable-model-invocation: true')
      expect(content).toContain('user-invocable: false')
      manager.setEnabled('my-skill', { model: true, user: true })
      content = readFileSync(path, 'utf8')
      expect(content).toContain('disable-model-invocation: false')
      expect(content).toContain('user-invocable: true')
    } finally {
      home.restore()
    }
  })

  it('edits the skill description', async () => {
    const { manager } = await harness()
    const home = withUserHome()
    try {
      const path = createUserSkill(home.dir, 'my-skill')
      expect(manager.setDescription('my-skill', 'New description')).toEqual({ ok: true, name: 'my-skill' })
      expect(readFileSync(path, 'utf8')).toContain('description: New description')
      expect(() => manager.setDescription('my-skill', '   ')).toThrow(/cannot be empty/)
    } finally {
      home.restore()
    }
  })
})
