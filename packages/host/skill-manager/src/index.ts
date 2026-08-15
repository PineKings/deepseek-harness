/** Remote management of local DSH skills: list, install, uninstall, and toggle. */

import type { Context } from '@deepseek-ai/cordis'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from 'zod'
import { discoverLocalSkills } from './discovery.ts'
import { resolveSkill } from './install.ts'
import {
  deleteSkill,
  installSkillDir,
  readSkillText,
  rewriteSkillFile,
  skillExists,
  skillRoot,
  writeSkillFile,
} from './skill-io.ts'
import type {
  SkillInstallSpec,
  SkillInvocationPatch,
  SkillManagerSnapshot,
  SkillMutationResult,
} from './types.ts'

export type * from './types.ts'
export {
  SKILL_NAME,
  deleteSkill,
  installSkillDir,
  parseSkillFile,
  readSkillText,
  rewriteSkillFile,
  skillExists,
  skillRoot,
  writeSkillFile,
} from './skill-io.ts'
export { resolveSkill } from './install.ts'
export { discoverLocalSkills, type DiscoveredSkill } from './discovery.ts'
export type { ParsedSkillFile, SkillFrontmatterMutation } from './skill-io.ts'
export type {
  SkillInstallSource,
  SkillInstallSpec,
  SkillInvocationPatch,
  SkillManagerEntry,
  SkillManagerSnapshot,
  SkillMutationResult,
} from './types.ts'

/**
 * Remote service exposing the local skill catalog with install/uninstall and
 * invocation management. `list` reads `ctx.skills` (the layered registry) in the
 * global layer — the machine-level user/bundled/custom/runtime skills — and
 * marks as `managed` those that live in the writable user root (`$DSH_HOME/skills`,
 * source `user-dsh`). Install/uninstall/toggle/edit all operate on that root:
 * the filesystem provider's watcher picks up every change with no restart.
 */
export class SkillManagerGateway extends TypertRemoteService {
  static inject = ['skills']

  constructor(ctx: Context) {
    super(ctx, 'skillManager')
  }

  /**
   * List the current local skills with their invocation state and whether each
   * is user-manageable. The skills are enumerated directly from the machine's
   * skill roots (user DSH/agents homes, the bundled dir, and the project's
   * `.dsh/skills` / `.agents/skills` when a `cwd` is given), because in the web
   * profile the host filesystem provider is disabled and the runtime registry
   * carries no local skills in this context.
   * @param cwd - workspace selector for the project skill roots; defaults to the
   * process working directory.
   * @returns the local skill snapshot.
   */
  @Remote('list')
  list(cwd?: string): SkillManagerSnapshot {
    const discovered = discoverLocalSkills(cwd ?? safeCwd())
    return {
      skills: discovered.map(skill => ({
        name: skill.name,
        description: skill.description,
        ...(skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {}),
        source: skill.source,
        provider: 'filesystem',
        invocation: skill.invocation,
        managed: skill.managed,
        path: skill.path,
      })),
    }
  }

  /**
   * Install a skill from a git/npm/tarball/local source into the user root.
   * Resolves the source, validates the skill, and copies its bundle to
   * `$DSH_HOME/skills/<name>`; the watcher discovers it immediately.
   * @param spec - the source kind and specifier.
   * @returns a confirmation naming the installed skill.
   */
  @Remote('installSkill')
  async installSkill(spec: SkillInstallSpec): Promise<SkillMutationResult> {
    const workDir = mkdtempSync(join(tmpdir(), 'dsh-skill-install-'))
    try {
      const resolved = await resolveSkill(spec, workDir)
      installSkillDir(skillRoot(), resolved.name, resolved.skillDir)
      return { ok: true, name: resolved.name }
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  }

  /**
   * Uninstall a skill from the user root. Refuses a name that is not installed
   * there, so bundled/project skills are never removed.
   * @param name - the kebab-case skill name.
   * @returns a confirmation.
   */
  @Remote('uninstallSkill')
  uninstallSkill(name: string): SkillMutationResult {
    const root = skillRoot()
    if (!skillExists(root, name)) {
      throw new Error(`skill "${name}" is not installed in the user root`)
    }
    deleteSkill(root, name)
    return { ok: true, name }
  }

  /**
   * Toggle a skill's model and/or user invocation surfaces by rewriting its
   * `SKILL.md` frontmatter.
   * @param name - the kebab-case skill name.
   * @param patch - which surfaces to enable or disable.
   * @returns a confirmation.
   */
  @Remote('setEnabled')
  setEnabled(name: string, patch: SkillInvocationPatch): SkillMutationResult {
    const root = skillRoot()
    const path = join(root, name, 'SKILL.md')
    if (!existsSync(path)) throw new Error(`skill "${name}" is not installed in the user root`)
    const rewritten = rewriteSkillFile(readSkillText(path), {
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.user !== undefined ? { user: patch.user } : {}),
    })
    writeSkillFile(root, name, rewritten)
    return { ok: true, name }
  }

  /**
   * Edit a skill's `description` frontmatter.
   * @param name - the kebab-case skill name.
   * @param description - the new non-empty description.
   * @returns a confirmation.
   */
  @Remote('setDescription')
  setDescription(name: string, description: string): SkillMutationResult {
    if (description.trim().length === 0) throw new Error('skill description cannot be empty')
    const root = skillRoot()
    const path = join(root, name, 'SKILL.md')
    if (!existsSync(path)) throw new Error(`skill "${name}" is not installed in the user root`)
    const rewritten = rewriteSkillFile(readSkillText(path), { description })
    writeSkillFile(root, name, rewritten)
    return { ok: true, name }
  }

}

/** `process.cwd()`, or the DSH home when the working directory is unavailable. */
function safeCwd(): string {
  try {
    return process.cwd()
  } catch {
    return skillRoot()
  }
}

export default SkillManagerGateway
