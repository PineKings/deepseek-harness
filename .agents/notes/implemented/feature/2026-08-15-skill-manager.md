# Agent Note: skills manager settings tab + built-in host plugin

Status: implemented

English | [中文](2026-08-15-skill-manager.zh.md)

## Problem

Skills are discovered by `dsh-skill-filesystem` from filesystem roots
(`$DSH_HOME/skills`, project `.agents/skills`, bundled, …) as `SKILL.md` bundles,
but there is **no management surface** — no way to see all local skills, install one
from a git/npm/tarball/local source, uninstall it, or toggle its invocation. The
plugin settings section had config/list/marketplace tabs but no skills tab.

## Decision

Add a **skills management tab** beside 插件配置 / 插件列表 / 插件市场 in the Plugins
settings section, backed by a new built-in host plugin.

**Host: `packages/host/skill-manager` (`@deepseek-ai/dsh-host-skill-manager`).**
`SkillManagerGateway` (serviceKey `skillManager`) exposes five direct Remotes:
- `list()` — reads `ctx.skills.list({})` (the global layer: user/bundled/custom/runtime
  skills) and marks `managed` = lives in `$DSH_HOME/skills` (`source === 'user-dsh'`).
- `install(spec)` — resolves a `git | npm | tarball | local` source into a validated
  `SKILL.md` bundle and copies it to `$DSH_HOME/skills/<name>`; the provider watcher
  discovers it with no restart.
- `uninstall(name)` — deletes a user-root skill; refuses names not installed there.
- `setEnabled(name, patch)` — rewrites `SKILL.md` frontmatter
  `disable-model-invocation` / `user-invocable`.
- `setDescription(name, description)` — rewrites `SKILL.md` frontmatter `description`.

`src/install.ts` materializes the source (git clone, `npm pack`+tar, tarball fetch+tar,
local dir), unwraps a single top-level dir, locates `SKILL.md` (root or `skills/<name>/`),
and validates the provider-mandated `name` + `description`. Git runs with the same
non-interactive environment as the plugin marketplace (`GIT_TERMINAL_PROMPT=0` +
`StrictHostKeyChecking=accept-new`) so a first-time clone never hangs.

`src/skill-io.ts` parses/rewrites the frontmatter (matching the provider's key semantics)
and does the read/install/delete filesystem work. No durable install table is needed:
the filesystem **is** the installed state, unlike plugin installs which record a profile
dependency.

**Client: `packages/client/ui-settings-skill-manager`
(`@deepseek-ai/dsh-client-ui-settings-skill-manager`).** Registers
`settings.plugins.tab` id `skills` (order 30). `SkillManagerSettingsTab` lists skills
with their invocation tags and manage/read-only labels, plus an install row (source
select + spec) and per-managed-skill toggle / edit-description / delete actions.

**Wiring:** the host + client packages are composed in `packages/bundle/web-app`
(cordis.patch.yml + package.json), `@deepseek-ai/dsh-host-skill-manager` is added to
`REQUIRED_PLUGINS` (protected, not toggleable), and the `skillManager` namespace is
mounted in `packages/api/remotes/src/client/index.ts`.

## Verification

- Host: `tests/skill-manager.spec.ts` (Remote surface + list/install/uninstall/toggle/
  description against a temp `$DSH_HOME`), `tests/install.spec.ts` (local source
  resolution + validation), `tests/skill-io.spec.ts` (frontmatter parse/rewrite + fs).
- Client: `tests/skill-manager.client.spec.tsx` (render, install, toggle, edit, delete,
  load-failure retry).
- `pnpm run build:lib:host` + `pnpm run build:lib:client` (regenerates the `skillManager`
  Typert Host/Client Remote artifacts); all modified packages typecheck.

## Alternatives

- **Fold skill management into `plugin-inventory`.** Rejected: skills are filesystem
  artifacts with a different install target than plugins (skill root vs profile deps),
  so a separate host package keeps each seam's ownership clear.
- **A durable install table like the plugin marketplace.** Rejected: a skill is
  installed iff its bundle exists in the user root; the watcher already derives the
  catalog from the filesystem, so an extra table would only drift.
