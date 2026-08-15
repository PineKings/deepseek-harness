# Agent Note：插件市场

Status: implemented

[English](2026-08-15-plugin-marketplace.md) | 中文

## 问题

插件设置页只能通过在文本框里输入任意 pnpm specifier 来安装插件。缺少一个可供浏览的策展目录，
也没有与 profile 自身 bundle 组合相独立的、关于用户已安装哪些社区插件的持久记录。
市场需要一份远程目录、每个插件的安装规定，以及一张权威的"是否已安装"表。

## 决策

给 `PluginInventoryGateway`（`packages/host/plugin-inventory`）新增插件市场。

**目录**（`src/marketplace.ts`）。静态网站宿主提供一份索引 JSON
（`plugins/plugins.json`，默认 URL
`https://deepseek.pinesound.cn/plugins/plugins.json`，可用 `DSH_MARKETPLACE_URL` 覆盖）
列出插件，旁边每个插件的 JSON（`plugins/<id>.json`）规定安装方式——`git`、`npm`、`tarball`
或 `bundle`——以及 pnpm specifier 和落地到 profile `dependencies` 的依赖名。
这些辅助函数是纯函数（拉取 + 解析 + 表格 IO），可在无 Cordis 上下文的单测中测试。

**三个直接 Remote**（`src/index.ts`）：
- `marketplaceList()` 拉取目录，并根据表格把每条标记为已安装。
- `marketplaceInstall(id, consentBuilds?)` 拉取该插件的 spec，映射到既有安装路径——
  git/npm/tarball 走 registry Remote，bundle 走离线组合——成功后写入表格。
  沿用同样的两阶段构建脚本同意流程：`pendingBuilds` 时暂停，重试时把已同意集合放在
  `consentBuilds` 里。
- `marketplaceUninstall(id)` 从表格行解析依赖名（或 bundle 名），执行既有 `uninstall`，
  并删除表行。

**安装表**。`$DSH_HOME/plugin-marketplace/installed.json`
（`dshHomePath('plugin-marketplace')`）下的一小份 JSON 文档，映射
插件 id → `{ method, spec, dependency, installedAt }`。原子写入，是市场列表判断
"是否已安装"的**权威**依据（按产品要求）。

**SSRF 姿态**。每个插件的 spec URL 由固定目录基地址加插件 id 推导
（`marketplaceBaseUrl` + `marketplaceSpecUrl`），绝不读取目录内容，因此恶意目录无法把
应用指向任意 URL。拉取在 harness 服务里用 `global.fetch`（仓库惯例），而不是在 renderer。

**UI**（`ui-settings-plugin-inventory`）。Plugins 设置区新增第三个同级 tab——
`settings.plugins.tab` id 为 `marketplace`，order 20——位于插件列表 tab `all`
（order 10）右侧，两者都在 插件配置（order 0）之后。`PluginMarketplaceSettingsTab`
列出目录卡片（名称、描述、作者、已安装标签、安装/卸载按钮），带自己的构建脚本同意弹窗；
拉取失败只显示可重试的失败态。插件列表 tab 保持单列、不变。
目录条目可带可选的 `recommended` 标志（解析进 `MarketplacePluginMeta.recommended`），
该卡片会渲染「推荐」角标。

## 验证

- `tests/marketplace.spec.ts`（纯函数）：目录/spec 解析、HTTP 错误、表格读写/原子性、
  基地址与 spec URL 推导。
- `tests/inventory.spec.ts`：`marketplaceList` 叠加表格；`marketplaceInstall`（假 pnpm）
  写入表行；`marketplaceUninstall` 删除表行；未知 id 显式报错。全部以临时 `$DSH_HOME` 为根。
- `tests/marketplace-tab.client.spec.tsx`：市场 tab 渲染、安装、卸载、构建脚本同意、
  加载失败重试。
- `pnpm run build:lib:host` 重新生成 Typert Host/Client Remote 产物。

## 备选方案

- **在 Electron 主进程拉取目录再传给 harness。** 已否决：安装本来就必须在 harness 里进行，
  而且其它 package 都用 `global.fetch`；让拉取紧挨着安装，可避免多一条传输通道。
- **用 profile 依赖判断已安装，而不建独立表格。** 已否决：产品要求一张持久表作为权威判断，
  而且 git/tarball 安装解析出的包名无法从 spec 可靠反推，因此表格显式记录依赖名。
