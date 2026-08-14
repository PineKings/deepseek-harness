# @deepseek-ai/dsh-desktop

Electron desktop shell over the DeepSeek Harness. The Electron main process is a
thin wrapper: it spawns the real `dsh` CLI running the `web` profile on loopback
(an OS-assigned port), parses the readiness URL line the profile prints
(`dsh web: http://127.0.0.1:<port>`), and opens a native window at that address.

The harness — its Cordis plugins, webserver, static frontend dist, and WebSocket
transport — runs exactly as `dsh web` would, as a separate system-Node process,
so native addons keep their system Node ABI.

## Run from a checkout

```sh
pnpm install
pnpm run build          # builds lib + the apps/web frontend dist
pnpm desktop:dev        # opens the desktop window
```

`desktop:dev` builds the frontend dist and the `dsh` CLI, then launches
Electron. Override the spawned Node or `dsh` entry with `DSH_NODE` / `DSH_ENTRY`.

## Package

```sh
pnpm desktop:pack       # electron-builder: mac .dmg / win .nsis in apps/desktop/dist
```

Packaging is unsigned by default; provide a certificate to distribute. The
harness child needs a Node runtime on the target platform — see
`electron-builder.yml` and the notes in `src/main.ts`.
