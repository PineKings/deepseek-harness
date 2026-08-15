# DeepSeek Harness

<p align="center">
  <img src="assets/readme/hero.svg" alt="DeepSeek Harness — plugin-based agent harness with a native desktop app" width="100%"/>
</p>

**DeepSeek Harness (`dsh`)** is a plugin-based agent harness where **everything is a plugin** — models, tools, skills, sessions, storage, the agent loop, and even the UI are all replaceable [Cordis](https://github.com/cordiverse/cordis) plugins, freely recomposed per profile. It ships both as a CLI/Web harness and as a **native desktop app** (`deepseek-harness-desktop`).

> **Community fork**: this repository is a community derivative of
> [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), maintained by
> PineSound, adding a desktop app, plugin marketplace, image recognition, and a release channel on top of
> the **unchanged core harness**. **This is not the official DeepSeek repository.** Full list of changes:
> [MODIFICATIONS.md](MODIFICATIONS.md) · [MODIFICATIONS.zh.md](MODIFICATIONS.zh.md).

---

## Proof

<p align="center">
  <img src="assets/readme/plugin-marketplace.png" alt="Plugin marketplace and install UI" width="420"/>
  <img src="assets/readme/trajectory-view.png" alt="Traceable run trajectory" width="420"/>
  <img src="assets/readme/desktop-plugins.png" alt="Plugin list and management" width="420"/>
</p>

---

## What it is

An agent harness assembled from plugins. Instead of a monolithic binary, every capability lives behind a
documented seam — **Service Definition / Provider / Consumer** — so you swap tools, skills, storage,
terminal, web, or sandbox without touching the loop. Runs are **traceable**: everything a model sees is
reconstructable from the session log.

## Why it is different

- **Everything is a plugin** — models, tools, skills, sessions, storage, loop, and UI are replaceable, recomposable units.
- **Traceable by default** — model-visible input is reconstructable from the session log, not a black box.
- **A native desktop**, not just a browser tab — zero-dependency installers for macOS and Windows.
- **Open & extensible** — a documented seam for every capability; the plugin ecosystem is growing.

## Features

### Desktop app (native)
- **Double-click to launch** — no browser tab or URL needed. The Electron shell spawns the real `dsh` on loopback and opens a native window.
- **Zero external dependencies** — the installer bundles the full harness runtime, vendored pnpm, and a platform Node.
- **Cross-platform** — macOS (`.dmg`) and Windows (`.nsis`) installers, Chinese menus, branded icons.
- **Update mechanism** — the About page checks an online `releases.json`; desktop and publish site share one manifest.

### Plugin marketplace
- Visual plugin list with search, status, and enable/disable; required system plugins are guarded.
- Install from npm / tarball / GitHub via the built-in pnpm, with multi-mirror fallback and **no-restart** hot reload.

### Image recognition
- An OpenAI-compatible vision provider (e.g. Alibaba DashScope) fills the gap for text-only models; the vision key / endpoint / model are configured independently of the chat model.

### Skill manager
- Manage local skills from the settings UI: list, install, uninstall, enable/disable, and edit descriptions.

---

## How it works

<p align="center">
  <img src="assets/readme/architecture.svg" alt="How it works: the desktop shell spawns the dsh harness as a system-Node child, composed entirely of plugins" width="100%"/>
</p>

The desktop is a **thin launcher**: it spawns the real `dsh` (`web` profile) as a separate system-Node
child, parses the readiness URL, and opens a window at that address. Native addons keep their system Node
ABI and are never loaded under Electron.

---

## Get started

### 1. Desktop (recommended)

Download the installer for your platform from the **publish site** — <https://deepseek.pinesound.cn/>.
No install steps; on first open, unsigned builds may need right-click → Open.

### 2. CLI / Web (npm)

Install Node.js, then run:

```sh
npx @deepseek-ai/dsh web
```

The Web UI is served at `http://127.0.0.1:3080` by default.

### 3. From source

```sh
git clone https://github.com/PineKings/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

### Desktop development

```sh
pnpm install
pnpm run build          # builds lib + the web frontend dist
pnpm desktop:dev        # opens the desktop window
```

### Packaging a release

```sh
pnpm --filter @deepseek-ai/dsh-desktop run build:harness   # assemble the self-contained runtime
pnpm desktop:pack                                          # electron-builder: .dmg / .nsis
pnpm --filter @deepseek-ai/dsh-desktop run stage-release   # copy installers + manifest into the publish site
```

### Quality gates

```sh
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run test:coverage
pnpm run test:snapshot     # keyless replay of assembled transcripts
```

---

## Repository layout

```
apps/        cli, web, desktop (Electron shell)
packages/    @deepseek-ai/dsh-<pkg> plugin workspaces
vendor/      vendored Cordis source
docs/        architecture, user guide, cookbook
assets/      readme visuals
```

---

## Community and support

- **Publish site**: <https://deepseek.pinesound.cn/>
- **Desktop repo**: <https://github.com/PineKings/deepseek-harness-desktop>
- **Upstream**: <https://github.com/deepseek-ai/deepseek-harness>
- Tag plugins with the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic for discoverability.

---

## License

[MIT](LICENSE). This project is a derivative of `deepseek-harness` (MIT); the original copyright is
preserved. Third-party dependencies and their licenses are disclosed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
