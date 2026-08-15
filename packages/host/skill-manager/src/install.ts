/**
 * Resolve a skill install source into a validated skill directory.
 *
 * A skill install materializes the `SKILL.md` bundle from a git clone, an npm
 * package, a downloaded or local tarball, or a local directory into the writable
 * user root (`$DSH_HOME/skills`); the filesystem provider's watcher then
 * discovers it with no restart. The resolved source is unwrapped and located the
 * same way the provider reads skills — a directory bundle `<name>/SKILL.md` at
 * the root or under a `skills/` subdirectory — and validated for the
 * provider-mandated `name` + `description` frontmatter. The caller owns the
 * scratch `workDir` and cleans it up after copying. Dependency-free of Cordis.
 * @module @deepseek-ai/dsh-host-skill-manager/install
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { SkillInstallSpec } from './types.ts'
import { parseSkillFile, readSkillText } from './skill-io.ts'

/** A resolved, validated skill ready to copy into the user root. */
export interface ResolvedSkill {
  readonly name: string
  readonly description: string
  /** The source directory containing the skill's `SKILL.md` and resources. */
  readonly skillDir: string
}

/**
 * Resolve an install source into a validated skill. Downloads/clones/packs the
 * source under `workDir` (which the caller creates and owns), unwraps any single
 * top-level directory, locates the `SKILL.md` bundle, and validates it.
 * @param spec - the source kind and specifier.
 * @param workDir - an existing scratch directory for cloned/downloaded content.
 * @returns the validated skill name, description, and source directory.
 */
export async function resolveSkill(spec: SkillInstallSpec, workDir: string): Promise<ResolvedSkill> {
  const sourceDir = await materializeSource(spec, workDir)
  const skillDir = locateSkillDir(sourceDir)
  const parsed = parseSkillFile(readSkillText(join(skillDir, 'SKILL.md')))
  return { name: parsed.name, description: parsed.description, skillDir }
}

/** Materialize an install source into a directory that (may) hold the skill. */
async function materializeSource(spec: SkillInstallSpec, workDir: string): Promise<string> {
  switch (spec.source) {
    case 'local': {
      if (!existsSync(spec.spec)) throw new Error(`skill source directory not found: ${spec.spec}`)
      return spec.spec
    }
    case 'git': {
      const dest = join(workDir, 'repo')
      run('git', ['clone', '--depth', '1', spec.spec, dest], gitEnv())
      return dest
    }
    case 'npm': {
      const packDir = join(workDir, 'pack')
      mkdirSync(packDir, { recursive: true })
      run('npm', ['pack', spec.spec, '--pack-destination', packDir], {})
      const tgz = findTarball(packDir)
      const extractDir = join(workDir, 'pkg')
      mkdirSync(extractDir, { recursive: true })
      run('tar', ['-xzf', tgz, '-C', extractDir], {})
      return unwrapSingleDir(extractDir)
    }
    case 'tarball': {
      const extractDir = join(workDir, 'pkg')
      mkdirSync(extractDir, { recursive: true })
      const tgz = /^https?:\/\//.test(spec.spec)
        ? await download(spec.spec, join(workDir, 'pkg.tgz'))
        : spec.spec
      if (!existsSync(tgz)) throw new Error(`tarball not found: ${tgz}`)
      run('tar', ['-xzf', tgz, '-C', extractDir], {})
      return unwrapSingleDir(extractDir)
    }
  }
}

/** The deepest directory that is the sole wrapper around a real skill root. */
function unwrapSingleDir(dir: string, depth = 0): string {
  if (depth > 3) return dir
  const entries = readdirSync(dir, { withFileTypes: true })
  const directories = entries.filter(entry => entry.isDirectory())
  if (directories.length === 1 && entries.length === directories.length) {
    const only = directories[0]
    return only === undefined ? dir : unwrapSingleDir(join(dir, only.name), depth + 1)
  }
  return dir
}

/** Locate a skill directory under a resolved source root: `skills/<name>` or root `SKILL.md`. */
function locateSkillDir(root: string): string {
  const skillsDir = join(root, 'skills')
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(skillsDir, entry.name, 'SKILL.md'))) {
        return join(skillsDir, entry.name)
      }
    }
  }
  if (existsSync(join(root, 'SKILL.md'))) return root
  throw new Error('no SKILL.md found in the resolved source')
}

/** Find the first `.tgz` in a directory. */
function findTarball(dir: string): string {
  for (const entry of readdirSync(dir)) {
    if (entry.endsWith('.tgz') || entry.endsWith('.tar.gz')) return join(dir, entry)
  }
  throw new Error('no tarball produced by the source')
}

/** Download a URL to `dest` and return the local path. */
async function download(url: string, dest: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`tarball HTTP ${response.status}`)
  writeFileSync(dest, Buffer.from(await response.arrayBuffer()))
  return dest
}

/** Run one synchronous child; throws with its captured output on failure. */
function run(command: string, args: readonly string[], env: Record<string, string>): void {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  })
  if (result.status !== 0 || result.error !== undefined) {
    throw new Error(`${command} ${args.join(' ')} failed: ${trim(result.stderr)}`)
  }
}

/** A git environment that never hangs on a first-time host-key or credential prompt. */
function gitEnv(): Record<string, string> {
  return {
    GIT_TERMINAL_PROMPT: '0',
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new',
  }
}

/** Compact a child's output for an error message (first 300 chars). */
function trim(output: string): string {
  const trimmed = output.trim()
  return trimmed.length <= 300 ? trimmed : `${trimmed.slice(0, 300)}…`
}
