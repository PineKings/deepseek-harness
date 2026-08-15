# @deepseek-ai/dsh-desktop

> **DeepSeek Harness Desktop(deepseek-harness-desktop)** — 由 PineSound 基于开源项目
> [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 构建的**社区版**桌面应用。
> 为官方 CLI/Web 形态的 harness 提供原生桌面外壳:双击即用、零外部依赖,发布 macOS 与 Windows 安装包。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

- **基于**: [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)(MIT)
- **源码**: https://github.com/PineKings/deepseek-harness-desktop
- **发布站**: https://deepseek.pinesound.cn/

## 开源协议(License)

本项目基于 MIT 授权的 deepseek-harness 构建,同样以 **MIT 协议**开源(见 [LICENSE](./LICENSE)),并保留原项目版权声明。

## 修改说明(Modification Note)

本项目是 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的**衍生作品**,在**完全保留原项目后端与核心 harness 行为**的基础上,面向最终用户增加了以下能力:

- **桌面外壳**:基于 Electron 的原生桌面窗口,双击即用、无需浏览器标签页;安装包内置完整运行时与 Node,目标机器零外部依赖;发布 macOS(`.dmg`)与 Windows(`.nsis`)安装包。
- **插件系统**:图形化的插件安装 / 开关、黑白名单守卫、内置 pnpm 与多镜像回退、免重启实时生效。
- **图像识别**:通过 OpenAI 兼容接口(DashScope)补齐视觉能力,密钥 / 地址 / 模型与对话主模型完全独立。
- **更新机制**:读取线上 `releases.json` 自动检测更新,桌面与发布站同渠道。
- **发布站**:配套的**非官方社区发布站**(deepseek.pinesound.cn),复刻并重构官方页面为中文单语言纯静态站点,**非 DeepSeek 官方站点**,与 DeepSeek 无隶属或赞助关系,商标归原权利方所有。

> 说明:本项目的后端与核心 harness 行为**完全保留原项目**;桌面外壳只是薄包装,原生 ABI 兼容,无需为 Electron 重编译。

---

## 技术说明(Technical Reference)

Electron desktop shell for DeepSeek Harness. The Electron main process is a thin
wrapper: it spawns the real `dsh` CLI running the `web` profile on loopback (an
OS-assigned port), parses the readiness URL line the profile prints
(`dsh web: http://127.0.0.1:<port>`), and opens a native window at that address.
The harness — its Cordis plugins, webserver, static frontend dist, and WebSocket
transport — runs exactly as `dsh web` would, as a separate system-Node process,
so native addons keep their system Node ABI and are never loaded into Electron.

## Why a system-Node child

Electron's bundled Node ABI differs from the system Node the harness's native
addons (e.g. `node-pty` for the terminal capability) are built against. Running
the harness in its own `node` child keeps those addons on the system Node ABI;
the Electron main and renderer never load them. This is why the desktop is a
launcher, not a bundler: it delegates the whole harness runtime to a child
process and only opens a window at the served URL.

## Architecture

```
Electron main (this package)
  │  spawns  node <harness>/apps/cli/lib/bin.js --profile web --host 127.0.0.1 --port 0
  ▼
system-Node child — the dsh harness
  │  prints "dsh web: http://127.0.0.1:<port>" on stdout
  ▼
Electron opens a BrowserWindow at that loopback URL
```

The main process keeps the window bound to the child: it reads the child's
stdout for the readiness line, opens the window once the port is known, and
quits when the child exits. A fatal child failure is shown in a native error
box.

## Feature surface

- **Chinese application menu** — replaces Electron's English default with
  文件/编辑/视图/窗口/帮助 (plus the macOS app menu: 关于/服务/隐藏/退出). Menu
  items are Electron *roles* with localized labels, so accelerators stay the
  system defaults (e.g. `Cmd+R` reload, `Cmd+Alt+I` DevTools).
- **Branded icon** — `build/icon.png` (1024px) is used for the window icon and,
  through `electron-builder.yml`, derived into the per-target `.icns`/`.ico`.
  Replace it with final artwork anytime.
- **Self-contained harness** — the packaged app ships the full harness runtime
  under `Contents/Resources/harness` (see below), so it runs on any target
  machine with no external Node or repository install.
- **External `dsh` CLI** — the bundled harness ships a `dsh` launcher, so you
  can install plugins of any source form from a terminal outside the app
  (see below). It resolves to the bundled Node, CLI entry, and vendored pnpm,
  so no Node or pnpm install is needed on the machine.

## Installing plugins from a terminal

The in-app Settings → Plugins install box covers npm names, tarballs, and
GitHub URLs. For anything the box can't express — a local directory, a tarball
you haven't placed somewhere — or for full control, run the bundled `dsh` CLI
directly. Any `pnpm add` specifier works, because `dsh plugin add` is a pnpm
forwarder that automatically uses the app's vendored pnpm.

The app **registers the `dsh` command on your PATH automatically on first
launch** (macOS: a symlink into `/usr/local/bin`; Windows: a `dsh.cmd` shim plus
a user-PATH entry), so in a new terminal you can just run:

```sh
dsh plugin --profile web add ./plugin            # local dir
# … or dsh-better-sidebar, github:user/repo, ./plugin.tgz,
#     https://github.com/user/repo/archive/refs/heads/main.tar.gz
```

Notes:

- The CLI and the in-app install share the same `~/.dsh/profiles/web`, so an
  install from either surface is picked up by the other. But a CLI install while
  the app is running does **not** hot-reload the running tree — restart the app
  (or re-open the plugin page) to see it.
- Build-script consent is the terminal's own: pnpm prints the packages it will
  run and, if you allow them, writes them under `allowBuilds` in the profile's
  `pnpm-workspace.yaml` — the same per-package, user-consented posture the
  in-app modal follows.
- Registration is non-destructive: an existing `dsh` that is not ours is left
  untouched, and a PATH that cannot be written (e.g. an unwritable
  `/usr/local/bin`) only logs a warning. Open a new shell to pick up a fresh
  PATH.
- In a development checkout (no packaged harness launcher) registration is
  skipped; use `pnpm dsh` or a PATH `dsh`/`pnpm` instead.

## Run from a checkout

```sh
pnpm install
pnpm run build          # builds lib + the apps/web frontend dist
pnpm desktop:dev        # opens the desktop window
```

`desktop:dev` builds the frontend dist and the `dsh` CLI, then launches
Electron. In development the harness resolves from the workspace, and you can
override the spawned Node or `dsh` entry with `DSH_NODE` / `DSH_ENTRY`.

## Packaging

```sh
pnpm --filter @deepseek-ai/dsh-desktop run build:harness   # (re)assemble the bundled runtime
pnpm desktop:pack                                          # electron-builder: mac .dmg / win .nsis
```

Artifacts land in `apps/desktop/dist`.

### The self-contained harness (`build/harness`)

The harness's pnpm workspace does **not** cleanly materialize into a portable
node_modules: its packages are linked through per-package symlinks to vendored
sources at the repository root (`vendor/`, `packages/`, `native/`), it has
native addons built for a specific Node ABI, and the web profile serves a
separately built frontend dist. `pnpm deploy` and electron-builder's dependency
resolution both produce incomplete or broken copies of this runtime.

The only known-good runtime is the repository's own working tree. So
`scripts/build-harness.mjs` assembles a self-contained copy into
`apps/desktop/build/harness`, preserving the relative layout the symlinks
depend on:

```
build/harness/
  node_modules/   the full dependency store + link network
  vendor/         vendored Cordis packages the symlinks resolve to
  packages/       workspace packages the symlinks resolve to
  native/         native addon sources (landlock-run)
  apps/cli/       the dsh CLI (the harness entry)
  apps/web/       the frontend + built dist
  bin/node        the platform Node binary the child runs on
```

electron-builder ships this as an `extraResource` at
`Contents/Resources/harness`, and `src/main.ts` spawns
`Resources/harness/bin/node` + `Resources/harness/apps/cli/lib/bin.js` with the
harness root as the child working directory. Because every symlink is relative
to that tree, the bundled runtime resolves identically on any machine of the
same OS/arch.

### Platform matrix

Each target platform needs its own harness: the bundled `bin/node` and the
native addons are OS/arch-specific. Regenerate `build/harness` on each target
platform (or per-target in CI) before packaging that platform. The current
configuration targets **macOS arm64** (`mac.target: dmg`); `win.target: nsis`
is declared but needs a Windows-built harness.

### Signing

No signing is configured (`electron-builder.yml` has no `mac.sign` identity).
Artifacts are unsigned: on first open, macOS Gatekeeper may block them (open
via right-click → Open, or add a `Developer ID Application` certificate to
distribute). Provide a certificate before public distribution.

### Size

The bundled harness is multi-GB uncompressed (≈2 GB), dominated by
`node_modules`; the compressed `.dmg` is on the order of a few hundred MB to
~1 GB. This is the inherent footprint of shipping the full harness runtime
standalone, and is the accepted trade-off for a zero-external-dependency app.

## Release process

The app is **not code-signed**, so updates are a manual-download flow rather
than a silent swap. On startup (and hourly), and from the Settings → About
"check for updates" button (through a preload bridge), the main process fetches
the manifest (`updates/releases.json`, `DSH_UPDATE_URL` overrides) and compares
the latest version against `app.getVersion()`. When a newer release exists it
prompts the user to open the per-platform installer URL. The web `download/`
page and the desktop update check read the same manifest, so **one deploy
publishes both the site and the update channel**.

### 1. Bump the app version

The release version lives in **`apps/desktop/package.json` → `version`**. It
feeds three things: `app.getVersion()` (shown dynamically by the About section
and compared against the manifest), electron-builder's installer filenames
(`DeepSeek Harness-<version>-arm64.dmg`), and — derived from those filenames —
the manifest's `latest`. So bump this one field to the new version:

```sh
# e.g. 0.1.0-rc.5 → 0.1.0-rc.6
```

The scheme is `0.1.0-rc.N`; `generate-release-json` orders versions
numerically, so `rc.6` correctly outranks `rc.5` (and `0.10.0` outranks
`0.9.0`). The root `package.json` version is the monorepo workspace version —
bump it too if you keep them in sync, but only the desktop one is user-visible.

### 2. Build and package

```sh
pnpm --filter @deepseek-ai/dsh-desktop run build:harness   # assemble the self-contained runtime
pnpm desktop:pack                                          # electron-builder: .dmg (mac) / .nsis .exe (win)
```

Artifacts land in `apps/desktop/dist/`. Each target OS/arch needs its own
harness (`build/harness` bundles a platform Node + native addons), so regenerate
it on the target platform before packing that platform. Building the Windows
`.exe` on macOS needs wine (or build on a Windows host).

### 3. Generate the update manifest

```sh
DSH_RELEASE_NOTES="…本次更新的说明…" pnpm --filter @deepseek-ai/dsh-desktop run generate-release-json
```

`scripts/generate-release-json.mjs` scans `dist/` for installers and writes
`dist/releases.json` (single-latest structure): `latest.version`, `latest.date`,
`releaseNotes`, and per-platform URLs rooted at `DSH_UPDATE_BASE` (default
`https://deepseek.pinesound.cn/updates/`).

### 4. Stage into the web site (the upload location)

```sh
pnpm --filter @deepseek-ai/dsh-desktop run stage-release      # --dry-run to preview
```

`scripts/stage-release.mjs` copies `dist/releases.json` and the installers
(`.dmg`/`.exe`) into **`deepseek-harness-web/updates/`** — the site root's
`updates/` folder — and prunes stale installers left from older releases. This
is the single upload location: everything the update check and download page
need lives under `updates/`.

### 5. Deploy the site

```sh
cd ../deepseek-harness-web && python3 deploy.py
```

`deploy.py` uploads the whole `deepseek-harness-web/` repo root (including
`download/` and `updates/`) to the OSS bucket root, served at
`https://deepseek.pinesound.cn/`. Because the desktop default
`DSH_UPDATE_URL` is `https://deepseek.pinesound.cn/updates/releases.json` and
the download page fetches `/updates/releases.json` (same origin), no further
configuration is needed. `deploy.py` wipes the bucket then uploads, so the repo
root is the source of truth.

### 6. The web pages

The release is installable from the web through the pages under
`deepseek-harness-web/`:

- **`download/index.html`** — the download page, **required** for a web
  release. Reads `updates/releases.json` and renders the latest version, date,
  release notes, and per-platform install buttons. Always include this in any
  release.
- **`index.html`** — the site homepage (link to `download/`).
- **`privacy/`, `data-processing/`** — supporting pages (already part of the
  site).

`deploy.py` serves every file under the repo root automatically (site root =
bucket root), so a new page is published by just adding it at the root and
re-deploying. If you add a page, link it from the homepage or the download page
so it is discoverable.

## Notes

- `asar: false` and `npmRebuild: false` are deliberate (see
  `electron-builder.yml` comments): the harness stays as real on-disk files for
  the child and its native addons, and native addons are not rebuilt for the
  Electron ABI because they never load under Electron.
- The profile data (`~/.dsh/profiles/web`) is created and read on the host the
  app runs on; it is not part of the packaged artifact.
