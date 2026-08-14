# Agent Note：web profile 之上的 Electron 桌面外壳

Status: implemented

English | [中文](2026-08-13-desktop-electron-shell.md)

## 问题

harness 以无头 CLI 形态交付：`dsh web` 启动一个 loopback webserver 并托管 React
SPA，用户需在浏览器标签页打开。作为桌面分发，用户应双击应用即可获得原生窗口，
无需输入 URL、无需维护浏览器标签。打包需同时覆盖 macOS 与 Windows。

## 决策

新增 `apps/desktop`（`@deepseek-ai/dsh-desktop`）：一个刻意保持轻量的 Electron
主进程。它把真正的 `dsh` CLI 作为子进程拉起，运行 `web` profile，绑定 loopback 并
使用 OS 分配的端口（`--host 127.0.0.1 --port 0`），解析 profile 打印的就绪 URL 行
（`dsh web: http://127.0.0.1:<port>`），再把 `BrowserWindow` 指向该地址。harness
本身——其 Cordis 插件、webserver、静态前端 dist 与 WebSocket 传输——完全不动，
行为与 `dsh web` 一致。

选择 Electron 而非 Tauri，是因为后端是重型 Node/TS monorepo：Electron 自带 Node
运行时，且 harness 的 native addon（如 `node-pty` PTY）保持在**系统 Node ABI** 上，
因为被拉起的 `dsh` 是独立的 Node 子进程。Tauri 外壳则需 Rust sidecar、跨平台
triple，并把 native addon 针对 WebView 宿主重新编译。

外壳以子进程方式拉起 `dsh`，而非进程内 import CLI：桌面主进程只 import
`electron` 与 `node:*`，因此不进入 workspace 的 TypeScript 程序与相关门禁。端口
交接通过解析打印的就绪 URL 完成；`--port 0` 让 OS 分配空闲端口。

## 打包

`electron-builder` 产出未签名的 macOS `.dmg` 与 Windows `.nsis` 产物。native
addon 从 asar 归档解包（`asarUnpack`），以便被拉起的系统 Node 子进程按路径
`dlopen`。子进程在目标平台需要一个 Node 运行时：开发流程用 PATH `node`；打包后的
应用必须随包携带一个 Node 二进制（通过 electron-builder 的 `extraResource`，经
`DSH_NODE` env 缝隙解析）。签名/公证暂不纳入范围，待提供证书后再接入。

## 验证

- `pnpm run build` 后 `pnpm desktop:dev` 打开绑定到 harness loopback server 的
  窗口；WebSocket 传输可用。
- `apps/desktop/tests/ready-port.spec.ts` 覆盖就绪 URL 解析（唯一纯函数），含
  带 LAN 后缀的就绪行。
- 在 macOS 与 Windows 各运行一次，确认窗口、生命周期与关闭即退出。

## 备选方案

- **用 Tauri 而非 Electron。** 已否决：后端是重型 Node/TS monorepo。Tauri 外壳
  需要 Rust sidecar、跨平台 triple，并把 native addon 针对 WebView 宿主重新编译，
  同时仍要分发一个独立 Node 运行时。Electron 自带 Node，且 harness 的 native
  addon 保持在系统 Node ABI 上。
- **进程内 import CLI（`runProfile`）而非子进程。** 已否决：桌面主进程将引入整个
  harness，进入 workspace 的 TypeScript 程序与相关门禁。子进程方式让外壳只 import
  `electron` 与 `node:*`。

## 后果

- **代价：** harness 运行在子进程中，生命周期需跨进程边界协调（通过解析打印的就绪
  URL 完成端口交接）；打包后的应用必须在目标平台随包携带 Node 运行时；在接入签名前，
  未签名产物会被 Gatekeeper / SmartScreen 拦截。
- **收益：** 外壳是零后端改动、无 workspace 门禁摩擦的薄封装，`dsh web` 行为
  原样保留，且 harness 的 native addon 按系统 Node ABI 加载——无需为 PTY 做
  Electron 专属重编译。
