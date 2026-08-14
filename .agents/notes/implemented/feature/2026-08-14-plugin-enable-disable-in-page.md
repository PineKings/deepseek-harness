# Agent Note: In-page plugin enable/disable

Status: implemented

English | [中文](2026-08-14-plugin-enable-disable-in-page.zh.md)

## Problem

The Web UI's plugin list was read-only: it showed the Loader's entries and their
lifecycle state but could not toggle a plugin on or off. Users wanted to
enable/disable plugins from the page, with the choice surviving a restart.

## Decision

Extend `PluginInventoryGateway` (`packages/host/plugin-inventory`) from a
read-only projection to one that also enables/disables. It now publishes a
second direct Remote, `pluginInventory/setEnabled(entryId, enabled)`, which:

1. Calls `ctx.loader.update(entryId, { disabled: !enabled })` — `Entry.update`
   disposes or re-starts the plugin's fiber live (the same runtime path HMR's
   config refresh uses).
2. Persists an explicit `disabled` override into the profile's user patch layer
   (`cordis.patch.yml`) so the choice survives a restart.

The persistence is written via `persistPluginDisabled` (`src/persist.ts`): it
upserts `- id: <rowId> disabled: true|false` atomically. The state is **always
written explicitly** — re-enabling writes `disabled: false`, because dropping
the row would fall back to the bundle's own `disabled` default rather than the
user's choice.

The patch row id is the entry's bare `options.id`, not the group-prefixed Loader
tree id (`include:<rowId>`); the two differ and only the bare id matches the
patch's `applyEntryPatches` target lookup.

The Web plugin-list tab (`ui-settings-plugin-inventory`) adds an enable/disable
button to each expanded card, wired to the Remote, re-listing after the toggle.

**Guard:** every entry carries a `protected` flag. The rule is default-protect —
disabling a plugin that another plugin injects breaks the dependent, and
enabling one whose service is unavailable fails the boot (both surfaced as
`dsh-tool-ralph: pending (waiting for service: workflowEngine)` after a bad
toggle). So `setEnabled` refuses and the UI hides the toggle for every shipped
plugin; only plugins added through an opt-in bundle (`USER_TOGGLEABLE_PLUGINS`
in `src/required.ts`) are toggleable.

## Persistence caveat

A runtime toggle alone does not survive a restart for a row enabled by a bundle
patch, because `Entry.update` writes the fully-patched tree and the patch layer
re-applies on the next read. Writing the override into the profile's
`cordis.patch.yml` (the last-applied user layer) is what makes it durable. The
web profile has HMR off, so the immediate live effect comes from
`loader.update`, not from the file write; the file matters only on restart.

## Verification

- `persistPluginDisabled` unit tests: append, override-a-bundle-disable, and
  dedupe an existing override.
- `PluginInventoryGateway.setEnabled` test: toggles the Loader entry live.
- `remoteMethods` includes `setEnabled`.
- Real use: toggle a plugin in the plugin-list tab, confirm its fiber phase
  changes and the profile `cordis.patch.yml` carries the override; restart and
  confirm the choice holds.

## Alternatives considered

- **Runtime-only toggle (no persistence).** Rejected: the user asked for the
  choice to survive a restart, which a bare `loader.update` cannot guarantee for
  a bundle-patch-disabled row.
- **Persist by writing the fully-patched tree to the base config.** Rejected:
  the profile root config is an empty entry list; dumping the whole composed
  tree there would corrupt it. The durable write must target the user patch
  layer instead.

## Consequences

- **Costs:** the gateway grows from read-only to writable, adding a Remote and a
  profile-patch write path; toggling a row the profile does not mount (absent
  from every bundle) is unsupported; re-enabling always writes `disabled: false`
  so the patch carries a row even for a default-enabled plugin the user turned
  back on.
- **Buys:** users can enable/disable plugins from the page with the choice
  surviving a restart, using the Loader's existing runtime update path plus an
  explicit override in the last-applied user layer.
