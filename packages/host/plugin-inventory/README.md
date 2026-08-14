# @deepseek-ai/dsh-host-plugin-inventory

English | [中文](README.zh.md)

Host projection of the current Cordis Loader tree with per-plugin enable/disable. `PluginInventoryGateway` registers the `pluginInventory` service and publishes two generated direct Remotes: `pluginInventory/list` and `pluginInventory/setEnabled`. `list` reads `ctx.loader.entries()` directly, skips structural group rows, and returns the remaining entries in Loader order with only their Loader entry id, module specifier, effective enablement, and current root Fiber phase.

The phase is `pending`, `loading`, `active`, `failed`, or `unloading`; it is `null` when the entry has no live root Fiber. The snapshot is intentionally point-in-time: Loader remains the sole lifecycle authority, while this package owns no cache, history, provenance model, or event stream. `setEnabled` toggles one entry live through `ctx.loader.update` and persists an explicit `disabled` override into the profile's user patch layer so the choice survives a restart (a bundle-default disable needs the `disabled: false` override to stick).

Every entry carries a `protected` flag. The guard is default-protect: every shipped plugin is required by the application (disabling one that another plugin injects breaks the dependent; enabling one whose service is unavailable fails the boot), so `setEnabled` refuses them and the UI hides the toggle. Only plugins a deployment adds through an opt-in bundle (`USER_TOGGLEABLE_PLUGINS` in `src/required.ts`) are toggleable. The Web plugin-list tab groups the inventory by current state: disabled plugins sit in the main list with an enable button (so they can be re-enabled), while enabled plugins sit in a collapsible "system plugins" section — a user-added enabled plugin keeps a disable toggle, a required one shows none. Its public payload types live under `./types`, and Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`.

The service is Remote-only and deliberately declares no same-process Cordis `Context` merge. Client packages consume it through the explicit [`api-remotes`](../../api/remotes/README.md) assembly rather than importing the Host implementation.

## Model Experience

None, as this Host-only inventory projection registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Point-in-time state only** — the result contains no durable failure history or subscription; a missing root Fiber is reported as `null`, regardless of why no live root exists.
- **No provenance or add/remove** — the service does not identify which bundle, profile, or override introduced an entry, and it cannot add or remove plugins. Enable/disable persists to the profile's user patch layer; a row the profile does not mount (absent from every bundle) cannot be toggled from here.
