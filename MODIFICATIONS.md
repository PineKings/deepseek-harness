# Modifications — Community Fork of deepseek-harness

This repository is a **community fork** of
[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (MIT),
maintained by PineSound. The core harness — plugin architecture, agent loop,
server, and web frontend — is **preserved unchanged**; the fork adds a desktop
application and related product capabilities.

- **Upstream**: https://github.com/deepseek-ai/deepseek-harness (MIT)
- **This fork**: adds `apps/desktop`, new host/client packages, and a release channel
- **License**: [MIT](LICENSE), with the original copyright preserved
- **Desktop repo**: https://github.com/PineKings/deepseek-harness-desktop
- **Publish site**: https://deepseek.pinesound.cn/

## Major changes vs. upstream

### 1. Desktop app (`apps/desktop`, deepseek-harness-desktop)
- An Electron shell that launches the real `dsh` (the `web` profile) on loopback and opens a native window, so no browser tab or manual URL is needed.
- Self-contained: the packaged app bundles the full harness runtime, vendored pnpm, and a platform Node — zero external dependencies on the target machine.
- Cross-platform installers: macOS (`.dmg`) and Windows (`.nsis`).
- Chinese application menu and branded icons.

### 2. Plugin inventory & marketplace (`packages/host/plugin-inventory`)
- Visual plugin list with search, status, and enable/disable controls.
- Black/whitelist guard: required system plugins cannot be disabled.
- Plugin install from npm / tarball / GitHub via the built-in pnpm, with multi-mirror fallback and hot reload (no restart).
- A plugin marketplace with persistent install state and priority-based ordering.

### 3. Skill manager (`packages/host/skill-manager`)
- Manage local skills from the settings UI: list, install, uninstall, enable/disable, and edit descriptions.

### 4. Image recognition / vision
- An OpenAI-compatible HTTP vision provider (e.g. Alibaba DashScope) that fills the gap for text-only models.
- Vision key / endpoint / model are configured independently of the chat model.
- A settings **namespace exposure** mechanism (`configurable` + `exposeSettings`) lets third-party settings namespaces be edited from the UI.

### 5. Update & release channel
- The About page shows the dynamic version and "check for updates", reading an online `releases.json`.
- Desktop updates and the web publish site share the same manifest — one deploy publishes both.

## Scope preserved

The fork does **not** change the harness backend. The desktop is a thin launcher;
native addons keep their system Node ABI and are never loaded under Electron.
