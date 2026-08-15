import type { SkillInvocationPolicy, SkillSource } from '@deepseek-ai/dsh-skill'

/** How a skill install source is resolved. */
export type SkillInstallSource = 'git' | 'npm' | 'tarball' | 'local'

/** A skill install request: the source kind plus the specifier. */
export interface SkillInstallSpec {
  readonly source: SkillInstallSource
  /**
   * `git`: a git clone URL/`github:user/repo`; `npm`: a package name; `tarball`:
   * a `.tgz` URL or local path; `local`: a directory containing `SKILL.md`.
   */
  readonly spec: string
}

/** Which invocation surfaces a management patch enables or disables. */
export interface SkillInvocationPatch {
  /** Whether the model-invocation surface is enabled. */
  readonly model?: boolean
  /** Whether the user-invocation surface is enabled. */
  readonly user?: boolean
}

/** One local skill as exposed to the manager client. */
export interface SkillManagerEntry {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  /** Discovery source that produced the skill. */
  readonly source: SkillSource
  /** Provider that owns the skill body. */
  readonly provider: string
  readonly invocation: SkillInvocationPolicy
  /** Absolute path of the skill body when known. */
  readonly path?: string
  /** Whether this skill lives in the writable user root and can be managed. */
  readonly managed: boolean
}

/** Snapshot returned by the skill-manager list Remote. */
export interface SkillManagerSnapshot {
  readonly skills: readonly SkillManagerEntry[]
}

/** Result of a skill install/uninstall/management mutation. */
export interface SkillMutationResult {
  readonly ok: true
  /** The affected skill name. */
  readonly name?: string
}
