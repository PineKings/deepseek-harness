# @deepseek-ai/dsh-host-plugin-inventory

English | [中文](README.zh.md)

Host projection of the current Cordis Loader tree with per-plugin enable/disable. `PluginInventoryGateway` registers the `pluginInventory` service and publishes two generated direct Remotes: `pluginInventory/list` and `pluginInventory/setEnabled`. `list` reads `ctx.loader.entries()` directly, skips structural group rows, and returns the remaining entries in Loader order with only their Loader entry id, module specifier, effective enablement, and current root Fiber phase.

The phase is `pending`, `loading`, `active`, `failed`, or `unloading`; it is `null` when the entry has no live root Fiber. The snapshot is intentionally point-in-time: Loader remains the sole lifecycle authority, while this package owns no cache, history, provenance model, or event stream. `setEnabled` toggles one entry live through `ctx.loader.update` and persists an explicit `disabled` override into the profile's user patch layer so the choice survives a restart (a bundle-default disable needs the `disabled: false` override to stick).

Every entry carries a `protected` flag. The guard in `src/required.ts` is default-open with two code-editable lists: `REQUIRED_PLUGINS` (the blacklist of load-bearing core that must never be disabled — the entry tree, the Remote RPC spine, the session and agent spines) and `USER_TOGGLEABLE_PLUGINS` (the whitelist, which overrides the blacklist for an explicitly toggleable plugin); a plugin on neither list is toggleable by default. The full dependency-derived taxonomy of the shipped base bundle is in [`docs/plugin-system.md`](../../../docs/plugin-system.md). `setEnabled` refuses to disable a required plugin and, after enabling, verifies the fiber becomes active (reverting a dependency-missing enable). The Web plugin-list tab renders one flat list of every entry: each shows its real enabled state, a toggleable plugin carries an enable or disable button (so a bundle-default-disabled plugin can be re-enabled), and a required plugin shows only a read-only note.

The gateway also manages installation through `availableBundles`/`installPlugin`/`uninstall`. `availableBundles` lists the curated offline-installable optional bundles in `src/bundles.ts` (`AVAILABLE_BUNDLES`); that catalog is empty until an optional bundle ships — the profile's default bundles (`dsh-base`, `dsh-web-app`, `dsh-image-recognition-bundle`) are part of the deployment, not optional add-ons, and `uninstall` refuses to remove them. `installPlugin` runs pnpm against the writable profile directory via the bundled Node and vendored pnpm for a registry package spec (the settings plugin-list tab offers this as the "install plugin" form); a registry install is gated behind the `dshAllowPluginInstall` context flag, which only the desktop boot sets. It tries the ordered `INSTALL_REGISTRIES` list (`src/install.ts`) until one succeeds, with the official npm registry last as the fallback, and errors only when every registry is unreachable. When the boot provides a `dshReloadProfile` handle, the gateway recomposes the running tree after the write so the plugin activates immediately (`restartRequired: false`); without it, the install persists the manifest and requires a restart (`restartRequired: true`). Its public payload types live under `./types`, and Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`.

The service is Remote-only and deliberately declares no same-process Cordis `Context` merge. Client packages consume it through the explicit [`api-remotes`](../../api/remotes/README.md) assembly rather than importing the Host implementation.

## Model Experience

None, as this Host-only inventory projection registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Point-in-time state only** — the result contains no durable failure history or subscription; a missing root Fiber is reported as `null`, regardless of why no live root exists.
- **No provenance or add/remove** — the service does not identify which bundle, profile, or override introduced an entry, and it cannot add or remove plugins. Enable/disable persists to the profile's user patch layer; a row the profile does not mount (absent from every bundle) cannot be toggled from here.
