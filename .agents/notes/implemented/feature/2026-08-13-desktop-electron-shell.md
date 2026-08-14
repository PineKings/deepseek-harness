# Agent Note: Electron desktop shell over the web profile

Status: implemented

English | [中文](2026-08-13-desktop-electron-shell.zh.md)

## Problem

The harness ships as a headless CLI: `dsh web` starts a loopback webserver and
serves the React SPA, which the user opens in a browser tab. For a desktop
distribution the user should double-click an app and get a native window, with
no URL to type and no browser tab to keep alive. Packaging must target macOS and
Windows.

## Decision

Add `apps/desktop` (`@deepseek-ai/dsh-desktop`): a deliberately thin Electron
main process. It spawns the real `dsh` CLI running the `web` profile on loopback
with an OS-assigned port (`--host 127.0.0.1 --port 0`), parses the readiness URL
line the profile prints (`dsh web: http://127.0.0.1:<port>`), and opens a
`BrowserWindow` at that address. The harness — its Cordis plugins, webserver,
static frontend dist, and WebSocket transport — is untouched and runs exactly as
`dsh web` would.

Electron (not Tauri) is the shell because the backend is a heavy Node/TS
monorepo: Electron ships its own Node runtime and the harness keeps its native
addons (e.g. the `node-pty` PTY) on the **system Node ABI**, since the spawned
`dsh` is a separate Node child. A Tauri shell would have forced a Rust sidecar,
per-platform triples, and recompiling native addons against the WebView host.

The shell spawns `dsh` as a subprocess rather than importing the CLI in-process:
the desktop main imports only `electron` and `node:*`, so it stays out of the
workspace TypeScript program and its verification gates. Port handoff is by
parsing the printed readiness URL; the `--port 0` request lets the OS pick a
free port.

## Packaging

`electron-builder` emits unsigned macOS `.dmg` and Windows `.nsis` artifacts.
Native addons are unpacked from the asar archive (`asarUnpack`) so the spawned
system-Node child can `dlopen` them. The child needs a Node runtime on the
target platform: the dev flow uses PATH `node`, while a packaged app must ship a
bundled Node binary (an electron-builder `extraResource` resolved through the
`DSH_NODE` env seam). Signing/notarization is intentionally out of scope until a
certificate is provided.

## Verification

- `pnpm run build` then `pnpm desktop:dev` opens a window bound to the harness
  loopback server; WebSocket transport works.
- `apps/desktop/tests/ready-port.spec.ts` covers readiness-URL parsing (the one
  pure function), including a readiness line carrying a LAN suffix.
- Run on macOS and Windows; confirm the window, lifecycle, and close-to-quit.

## Alternatives considered

- **Tauri instead of Electron.** Rejected: the backend is a heavy Node/TS
  monorepo. A Tauri shell would require a Rust sidecar, per-platform triples,
  and recompiling native addons against the WebView host, while shipping a
  separate Node runtime all the same. Electron embeds Node and the harness keeps
  its native addons on the system Node ABI.
- **Importing the CLI in-process (`runProfile`) instead of a subprocess.**
  Rejected: the desktop main would import the whole harness and enter the
  workspace TypeScript program and its verification gates. The subprocess keeps
  the shell to `electron` plus `node:*` imports only.

## Consequences

- **Costs:** the harness runs in a child process, so lifecycle is coordinated
  across a process boundary (port handoff by parsing the printed readiness URL);
  a packaged app must ship a Node runtime on the target platform; unsigned
  artifacts are blocked by Gatekeeper / SmartScreen until signing is added.
- **Buys:** the shell is a thin wrapper with zero backend change and no
  workspace-gate friction, the `dsh web` behavior is preserved exactly, and the
  harness loads its native addons against the system Node ABI — no
  Electron-specific rebuild for the PTY.
