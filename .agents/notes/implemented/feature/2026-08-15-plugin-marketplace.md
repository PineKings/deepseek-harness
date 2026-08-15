# Agent Note: plugin marketplace

Status: implemented

English | [中文](2026-08-15-plugin-marketplace.zh.md)

## Problem

The plugin settings page only installs a plugin by typing an arbitrary pnpm specifier
into a text field. There is no curated catalog a user can browse, and no durable record
of which community plugins they have installed, separate from the profile's own bundle
composition. A marketplace needs a remote catalog, a per-plugin install prescription,
and an authoritative "is this installed" table.

## Decision

Add a plugin marketplace to `PluginInventoryGateway` (`packages/host/plugin-inventory`).

**Catalog** (`src/marketplace.ts`). The static web host serves one index JSON
(`plugins/plugins.json`, default URL
`https://deepseek.pinesound.cn/plugins/plugins.json`, overridable via `DSH_MARKETPLACE_URL`)
listing plugins, and a per-plugin JSON beside it (`plugins/<id>.json`) prescribing the
install method — `git`, `npm`, `tarball`, or `bundle` — with the pnpm specifier and the
dependency name that lands in the profile's `dependencies`. The helpers are pure
(fetch + parse + table IO) and unit-test without a Cordis context.

**Three direct Remotes** (`src/index.ts`):
- `marketplaceList()` fetches the catalog and marks each entry installed from the table.
- `marketplaceInstall(id, consentBuilds?)` fetches the per-plugin spec and maps it onto
  the existing install path — git/npm/tarball via the registry Remote, bundle via the
  offline compose — then records the install in the table on success. It honors the same
  two-phase build-consent flow: a `pendingBuilds` result pauses, and the retry carries the
  approved set in `consentBuilds`.
- `marketplaceUninstall(id)` resolves the dependency (or bundle name) from the table row,
  runs the existing `uninstall`, and drops the row.

**Install table.** A small JSON document at `$DSH_HOME/plugin-marketplace/installed.json`
(`dshHomePath('plugin-marketplace')`) maps plugin id → `{ method, spec, dependency,
installedAt }`. It is written atomically and is the **authoritative** "is this installed"
check for the marketplace list, per the product requirement.

**SSRF posture.** Per-plugin spec URLs are derived from the fixed catalog base plus the
plugin id (`marketplaceBaseUrl` + `marketplaceSpecUrl`), never read from catalog content,
so a hostile catalog cannot point the app at an arbitrary URL. Fetch runs in the harness
service with `global.fetch` (the repo's convention), not in the renderer.

**UI** (`ui-settings-plugin-inventory`). The Plugins settings section gains a third
sibling tab — `settings.plugins.tab` id `marketplace`, order 20 — to the right of the
plugin-list tab `all` (order 10), both behind 插件配置 (order 0). `PluginMarketplaceSettingsTab`
lists catalog cards (name, description, author, Installed tag, Install/Uninstall button)
with its own build-consent modal; a fetch miss shows a retryable failure. The plugin-list
tab stays single-column and unchanged. A catalog entry may carry an optional `recommended`
flag (parsed into `MarketplacePluginMeta.recommended`), which renders a 推荐 badge on that
card.

## Verification

- `tests/marketplace.spec.ts` (pure): catalog/spec parse, HTTP errors, table
  read/write/atomicity, base-URL and spec-URL derivation.
- `tests/inventory.spec.ts`: `marketplaceList` overlays the table; `marketplaceInstall`
  (fake pnpm) records the row; `marketplaceUninstall` drops it; unknown id fails loud.
  All keyed to a temp `$DSH_HOME`.
- `tests/marketplace-tab.client.spec.tsx`: marketplace tab render, install, uninstall,
  build-consent, and load-failure retry.
- `pnpm run build:lib:host` regenerates the Typert Host/Client Remote artifacts.

## Alternatives

- **Fetch the catalog in the Electron main and pass it into the harness.** Rejected: the
  install must run in the harness anyway, and every other package fetches with
  `global.fetch`; keeping fetch next to install avoids a second transport.
- **Derive installed state from profile dependencies instead of a dedicated table.**
  Rejected: the product asked for a durable table as the authoritative check, and a
  git/tarball install's resolved package name is not reliably recoverable from a spec, so
  the table records the dependency name explicitly.
