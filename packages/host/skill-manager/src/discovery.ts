/**
 * Direct filesystem enumeration of local skills for the skill-manager surface.
 *
 * The runtime catalog (`ctx.skills`) is provider-layered: in the web profile the
 * host `skill-filesystem` row is disabled and local discovery is owned by agent
 * presets, so a host-context `ctx.skills.list()` sees almost nothing. Skill
 * management needs the machine's local skills regardless of presets, so this
 * module scans the same roots the filesystem provider would — user DSH/agents
 * homes, the bundled dir, and the project's `.dsh/skills` / `.agents/skills` —
 * parses each `SKILL.md` the same way, and dedups by name with the provider's
 * rank precedence. Dependency-free of Cordis.
 * @module @deepseek-ai/dsh-host-skill-manager/discovery
 */

import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { SkillInvocationPolicy, SkillSource } from '@deepseek-ai/dsh-skill'
import { SKILL_NAME, parseSkillFile, readSkillText } from './skill-io.ts'

/** One locally discovered skill. */
export interface DiscoveredSkill {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly source: SkillSource
  readonly invocation: SkillInvocationPolicy
  /** Whether the skill lives in the writable user DSH root. */
  readonly managed: boolean
  /** Absolute path of the skill body. */
  readonly path: string
  /** The provider rank this skill was discovered at (lower wins dedup). */
  readonly rank: number
}

/** One scan root with its source label and provider rank. */
interface SkillRoot {
  readonly path: string
  readonly source: SkillSource
  readonly rank: number
}

/**
 * Enumerate the machine's local skills across the user, agents, bundled, and
 * (when a `cwd` is supplied) project skill roots, deduped by name with the
 * provider's rank precedence and sorted by name.
 * @param cwd - workspace selector for the project `.dsh/skills` / `.agents/skills`
 * roots; omitted skips project roots (a machine-level view).
 * @returns the discovered skills, sorted by name.
 */
export function discoverLocalSkills(cwd?: string): DiscoveredSkill[] {
  const byName = new Map<string, DiscoveredSkill>()
  for (const root of skillRoots(cwd)) {
    if (!existsSync(root.path)) continue
    // A skill root may be unreadable in a given environment (permissions, a
    // file where a directory is expected); skip it rather than fail discovery.
    let entries
    try {
      entries = readdirSync(root.path, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const skill = readSkillEntry(root, entry.name, entry.isDirectory())
      if (skill === undefined) continue
      const existing = byName.get(skill.name)
      if (existing !== undefined && existing.rank <= skill.rank) continue
      byName.set(skill.name, skill)
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Parse one `<name>/SKILL.md` or `<name>.md` entry under a root into a skill. */
function readSkillEntry(root: SkillRoot, name: string, isDirectory: boolean): DiscoveredSkill | undefined {
  const skillName = isDirectory ? name : name.endsWith('.md') ? name.slice(0, -3) : ''
  if (!SKILL_NAME.test(skillName)) return undefined
  const path = isDirectory ? join(root.path, name, 'SKILL.md') : join(root.path, name)
  if (!existsSync(path)) return undefined
  let parsed
  try {
    parsed = parseSkillFile(readSkillText(path))
  } catch {
    return undefined
  }
  // The frontmatter name must match the on-disk bundle name, like the provider.
  if (parsed.name !== skillName) return undefined
  return {
    name: parsed.name,
    description: parsed.description,
    ...(parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {}),
    source: root.source,
    invocation: parsed.invocation,
    managed: root.source === 'user-dsh',
    path,
    rank: root.rank,
  }
}

/** The skill roots this manager scans, in provider rank order. */
function skillRoots(cwd?: string): SkillRoot[] {
  const roots: SkillRoot[] = []
  if (cwd !== undefined) {
    const projectRoot = findProjectRoot(cwd)
    roots.push(
      { path: join(projectRoot, '.dsh', 'skills'), source: 'project-dsh', rank: 100 },
      { path: join(projectRoot, '.agents', 'skills'), source: 'project-agents', rank: 200 },
    )
  }
  roots.push(
    { path: dshHomePath('skills'), source: 'user-dsh', rank: 400 },
    { path: join(agentsHome(), 'skills'), source: 'user-agents', rank: 500 },
  )
  const bundled = process.env.DSH_BUNDLED_SKILL_DIR
  if (bundled !== undefined && bundled.trim().length > 0) {
    roots.push({ path: resolve(bundled), source: 'bundled', rank: 600 })
  }
  return roots
}

/** The user agents home: `$DSH_AGENTS_HOME` or `~/.agents`. */
function agentsHome(): string {
  return resolve(process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents'))
}

/** Nearest ancestor of `cwd` containing a `.git`, else `cwd` itself. */
function findProjectRoot(cwd: string): string {
  const start = resolve(cwd)
  let current = start
  while (true) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return start
    current = parent
  }
}
