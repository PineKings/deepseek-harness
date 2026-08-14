# The Plugin System

English | [中文](plugin-system.zh.md)

This reference explains how plugins are installed, composed, and injected in the harness, and how the shipped base bundle splits into system-required and freely optional plugins. It is a reference for how the plugin system works today; the Cordis runtime semantics it relies on live in the [cordis primer](cordis-primer.md) and the [Cordis API](cordis-api/context.md), and the package composition map is in [architecture.md](architecture.md).

## Three threads

A plugin is an ordinary npm (or workspace) package that is composed into a profile by name, resolved through Node module resolution, and mounted as a Cordis fiber that runs only once the services it injects are active. Three threads make that work: **composition** (which plugins a profile mounts), **resolution** (how a name becomes loaded code), and **activation** (when a plugin actually runs).

## Installation and composition

There is no code that downloads or registers plugin code by name. "Installing" a plugin means two things: it is a resolvable npm package in the profile's (or the installation's) `node_modules`, and it is declared in a composition layer.

A profile is a directory (`$DSH_HOME/profiles/<name>`) whose `package.json` lists ordered **bundles** under `dsh.profile.bundles`. Each bundle is a package carrying a `dsh.bundle.patch` field pointing at a `cordis.patch.yml` — a top-level array of loader patch entries. When `dsh --profile web` boots, `apps/cli` `composeProfile` stacks the bundle patches, the profile's own `cordis.patch.yml`, the home-level `$DSH_HOME/cordis.patch.yml`, any `--patch` overlays, and the telemetry switch into one ordered patch list; `boot` installs the `Loader` service and mounts a root `include` entry over the profile's empty `cordis.yml` (which exists only to anchor the Loader's `baseUrl` at the profile directory); the include reads its patch list through `applyEntryPatches` and reconciles the composed rows into a live entry tree via `EntryGroup.update`, which creates, updates, or disables each `Entry` transactionally; and each entry imports its plugin module by `name` (its module specifier) through Node `internal.import`, interpolates `!!js` config and `disabled` expressions in the entry's own context, and mounts the module as a Cordis fiber.

Bundles resolve installation-first, then from the profile directory; a flat symlink closure (`healProfilesModuleFallback`) keeps every in-box plugin Node-resolvable from any profile. `dsh plugin add <package>` is literally `pnpm add` run in the profile directory, after which any installed package that declares `dsh.bundle` is reconciled into `dsh.profile.bundles`. The `verify-cordis-config` gate enforces the invariant behind both install paths: every bare plugin specifier a composition references must appear in the `dependencies` of the package that resolves it.

## Injection and activation

A function plugin named-exports `name`, `inject`, `Config`, and `apply` (with no default export); a service plugin default-exports a `Service` subclass that registers itself on construction; an object plugin is `{ apply }`. `inject` lists the services the plugin requires.

Services are provided by `Service` subclasses via `super(ctx, name)`, which registers the instance in the context store. `ctx.<name>` reads go through a property proxy that walks the plugin's ancestors in the fiber tree (topology sensitive), while `ctx.get(name)` reads the global store and only returns a provider whose fiber is active. This is why a declared injection is readable only once its provider is active in the plugin's ancestry.

Activation order is driven by service availability. A fiber whose injected services are missing stays `PENDING` and never runs `apply`; it is woken reactively when a provider appears. After the tree settles, the host audits every enabled entry (`assertEntriesActivated`) and treats any `PENDING` entry as a boot failure, listing the missing services. The canonical example is a tool that injects `workflowEngine` (e.g. `dsh-tool-ralph`) remaining pending when the workflow engine provider is not mounted.

## System-required versus optional plugins

"Required" is a dependency-graph property: a plugin is system-required when disabling it leaves a load-bearing service unavailable, which in turn leaves the core plugins that inject that service `PENDING`. The shipped `dsh-base` bundle is the shared core every mode mounts. Grouping its rows by this property:

| Plugin (module specifier) | Load-bearing service | Class |
|---|---|---|
| `cordis-plugin-loader` | the loader entry tree itself | required |
| `dsh-typert-registry` | `ctx.typert` (Remote RPC type registry) | required |
| `dsh-typert-loader` | Remote RPC type loading | required |
| `dsh-api-gateway` | `ctx.typertGateway` (RPC invocation) | required |
| `dsh-agent` | `ctx.agents` | required |
| `dsh-session` | `ctx.sessions` | required |
| `dsh-llm` | `ctx.llm` | required |
| `dsh-tools` | `ctx.tools` (tool registry) | required |
| `dsh-system-prompt` | system-prompt assembly | required |
| `dsh-agent-loop` | `ctx.agentLoop` (injects agents/sessions/llm/tools/systemPrompt) | required |
| `dsh-settings-file` | user settings document (config) | required |
| `dsh-credentials-local` | credential store (keys) | required |
| everything else in `dsh-base` | none (leaf capability) | optional |

`dsh-agent-loop` is the most load-bearing consumer: it injects `['agents', 'sessions', 'llm', 'tools', 'systemPrompt']`, so disabling it or any of its injected providers leaves the whole agent runtime `PENDING`. The configuration and credential rows are required in the sense that removing them takes away the config and key spine the rest of the tree reads.

The optional rows are leaf capabilities whose disable removes a feature but never breaks the core: `hmr`, `timer`, `web` and its search, the shell and terminal providers, `skill`, `goal`, `plan-mode`, `compaction`, `subagent`, `workflow`, `sandbox` and the concrete sandbox providers, `approval` and `permission`, `telemetry`, `spill`, `todo`, and the individual `tool-*` and `command-*` rows.

Two borderline groups deserve a note. The safety spine — `dsh-sandbox`, `dsh-fs-sandbox`, `dsh-sandbox-policy`, `dsh-permission-presets`, `dsh-user-approval` — is required for the default workspace-write-plus-ask posture but a deployment may relax it. The web profile additionally composes `dsh-web-app` (host transport, connection, frontend serving) and the optional `dsh-image-recognition-bundle`; `dsh-headless` composes `dsh-base` plus the headless runner rows. Those bundles' rows are required only within the mode that mounts them.

## The plugin inventory's `protected` flag

The plugin-inventory host projects each loader entry with `enabled = !entry.disabled` and `protected = isRequiredPlugin(entry.options.name)`. `isRequiredPlugin` in `src/required.ts` is a default-open guard: every plugin is toggleable unless its module specifier is in a small explicit set — currently the loader, the typert spine, `dsh-session`, and `dsh-agent`. That set is a conservative subset of the dependency-derived required list above: it does not protect `dsh-agent-loop`, `dsh-llm`, `dsh-tools`, `dsh-system-prompt`, or `dsh-api-gateway`. The full dependency-derived classification here is the basis for widening that set if the guard is ever made to reflect "cannot disable without breaking the core".
