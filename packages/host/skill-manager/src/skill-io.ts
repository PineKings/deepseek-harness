/**
 * Filesystem and frontmatter helpers behind the skill-manager Remotes.
 *
 * A skill is a kebab-case directory bundle (`<name>/SKILL.md`) or flat file
 * (`<name>.md`) discovered by `dsh-skill-filesystem`; install materializes one
 * into the writable user root (`$DSH_HOME/skills`), uninstall removes it, and
 * toggling/editing rewrites its `SKILL.md` frontmatter — all picked up by the
 * provider's watcher with no restart. Frontmatter interpretation matches the
 * provider exactly: `name` and `description` are required, and the invocation
 * surfaces are `disable-model-invocation` / `user-invocable` (each omitted
 * defaults to permitting its surface). These helpers are dependency-free of
 * Cordis, so they unit-test without a context.
 * @module @deepseek-ai/dsh-host-skill-manager/skill-io
 */

import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { SkillInvocationPolicy } from '@deepseek-ai/dsh-skill'

/** Kebab-case skill-name grammar, matching the registry's `isSkillName`. */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The directory the skill provider scans at `USER_DSH_RANK`. */
export function skillRoot(): string {
  return dshHomePath('skills')
}

/** Parsed `SKILL.md` frontmatter-derived fields plus the instruction body. */
export interface ParsedSkillFile {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly invocation: SkillInvocationPolicy
  readonly body: string
}

/** Parse a `SKILL.md` body, validating the provider-mandated fields. */
export function parseSkillFile(content: string): ParsedSkillFile {
  const { frontmatter, body } = splitFrontmatter(content)
  const data = parseYaml(frontmatter) as unknown
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('skill frontmatter is not a YAML object')
  }
  const record = data as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name : ''
  if (!SKILL_NAME.test(name)) throw new Error(`invalid skill name "${name}"`)
  const description = typeof record.description === 'string' ? record.description : ''
  if (description.length === 0) throw new Error(`skill "${name}" has no description`)
  return {
    name,
    description,
    invocation: {
      modelInvocable: record['disable-model-invocation'] !== true,
      userInvocable: record['user-invocable'] !== false,
    },
    body,
    ...(typeof record.whenToUse === 'string' && record.whenToUse.length > 0
      ? { whenToUse: record.whenToUse }
      : {}),
  }
}

/** Frontmatter fields a management edit may change. */
export interface SkillFrontmatterMutation {
  readonly description?: string
  /** Desired `modelInvocable`; written as the inverse of `disable-model-invocation`. */
  readonly model?: boolean
  /** Desired `userInvocable`; written as `user-invocable`. */
  readonly user?: boolean
}

/**
 * Rewrite a `SKILL.md` with the given frontmatter mutation, preserving every
 * other frontmatter key and the instruction body verbatim.
 * @param content - the current `SKILL.md` text.
 * @param mutation - the fields to change.
 * @returns the rewritten `SKILL.md` text.
 */
export function rewriteSkillFile(content: string, mutation: SkillFrontmatterMutation): string {
  const { frontmatter, body } = splitFrontmatter(content)
  const parsed = parseYaml(frontmatter) as unknown
  const data = (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed))
    ? parsed as Record<string, unknown>
    : {}
  if (mutation.description !== undefined) data.description = mutation.description
  if (mutation.model !== undefined) data['disable-model-invocation'] = mutation.model ? false : true
  if (mutation.user !== undefined) data['user-invocable'] = mutation.user
  const rendered = stringifyYaml(data, { lineWidth: 0 }).trimEnd()
  return `---\n${rendered}\n---\n${body}`
}

/** Read a skill file's text. */
export function readSkillText(path: string): string {
  return readFileSync(path, 'utf8')
}

/** Whether a skill exists in `root` as a directory bundle or flat file. */
export function skillExists(root: string, name: string): boolean {
  return existsSync(join(root, name, 'SKILL.md')) || existsSync(join(root, `${name}.md`))
}

/**
 * Materialize a resolved skill directory into `root/<name>`, copying the whole
 * bundle so any relative resources keep working.
 */
export function installSkillDir(root: string, name: string, sourceDir: string): void {
  if (!SKILL_NAME.test(name)) throw new Error(`invalid skill name "${name}"`)
  cpSync(sourceDir, join(root, name), { recursive: true })
}

/** Remove a skill (directory bundle or flat file) from `root`. */
export function deleteSkill(root: string, name: string): void {
  if (!SKILL_NAME.test(name)) throw new Error(`invalid skill name "${name}"`)
  rmSync(join(root, name), { recursive: true, force: true })
  rmSync(join(root, `${name}.md`), { force: true })
}

/** Rewrite a skill's `SKILL.md` in place and return the new text. */
export function writeSkillFile(root: string, name: string, content: string): string {
  writeFileSync(join(root, name, 'SKILL.md'), content, 'utf8')
  return content
}

/** Split a SKILL.md into its leading YAML frontmatter block and the body after it. */
function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content)
  if (match === null) throw new Error('skill file has no frontmatter')
  return { frontmatter: match[1] ?? '', body: content.slice(match[0].length) }
}
