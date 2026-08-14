# Agent Note：页面内开关插件

Status: implemented

English | [中文](2026-08-14-plugin-enable-disable-in-page.md)

## 问题

Web UI 的插件列表是只读的：它展示 Loader 的条目和生命周期状态，但不能在页面内开关插件。
用户希望能在页面内启用/停用插件，且重启后保留选择。

## 决策

把 `PluginInventoryGateway`（`packages/host/plugin-inventory`）从只读投影扩展为可启停。
新增第二个直接 Remote `pluginInventory/setEnabled(entryId, enabled)`，它：

1. 调用 `ctx.loader.update(entryId, { disabled: !enabled })` —— `Entry.update`
   实时 dispose/重启插件 fiber（与 HMR 配置刷新用的同一条运行时路径）。
2. 把显式 `disabled` 覆盖写进 profile 的用户补丁层（`cordis.patch.yml`），使选择在重启后保留。

持久化经 `persistPluginDisabled`（`src/persist.ts`）实现：原子 upsert
`- id: <rowId> disabled: true|false`。状态**始终显式写入**——重新启用写
`disabled: false`，因为删掉该行会回落到 bundle 自身的 `disabled` 默认，而不是用户的选择。

补丁行的 id 用条目的裸 `options.id`，而非带组前缀的 Loader 树 id
（`include:<rowId>`）；两者不同，只有裸 id 能命中 patch 的 `applyEntryPatches` 目标查找。

Web 插件列表 tab（`ui-settings-plugin-inventory`）在每张展开卡片的详情区加启用/停用按钮，
绑定该 Remote，切换后重新拉取列表。列表分组：可切换插件在主列表带按钮，必需的系统插件
放在一个可折叠的"系统插件"区，无任何开关。

**门卫：** 每条条目带 `protected` 标记。规则默认保护——停用一个被其他插件注入的插件会破坏
依赖者，启用一个服务不可用的插件会导致启动失败（坏切换后都会表现为
`dsh-tool-ralph: pending (waiting for service: workflowEngine)`）。所以 `setEnabled`
拒绝、UI 隐藏所有随包插件的开关；只有通过 opt-in bundle 添加的插件
（`src/required.ts` 的 `USER_TOGGLEABLE_PLUGINS`）可切换。

## 持久化注意

仅运行时 toggle 对由 bundle patch 启用的行不持久，因为 `Entry.update` 写回的是补丁后的整棵树，
而 patch 层在下一次读取时会重放。把覆盖写进 profile 的 `cordis.patch.yml`（最后应用的用户层）
才是持久的。web profile 的 HMR 关闭，所以立即生效来自 `loader.update`，而非文件写入；
文件只在重启时起作用。

## 验证

- `persistPluginDisabled` 单测：追加、覆盖 bundle 默认禁用、去重已有覆盖。
- `PluginInventoryGateway.setEnabled` 测试：实时切换 Loader 条目。
- `remoteMethods` 包含 `setEnabled`。
- 实机：在插件列表 tab 切换某插件，确认其 fiber phase 变化且 profile
  `cordis.patch.yml` 带上覆盖；重启后确认选择仍保留。

## 备选方案

- **仅运行时 toggle（不持久）。** 已否决：用户要求选择在重启后保留，而裸的
  `loader.update` 对 bundle patch 禁用的行无法保证这一点。
- **把补丁后的整棵树写回 base config 以持久化。** 已否决：profile 根配置是空条目列表，
  把整棵组合树倒进去会破坏它。持久写必须落到用户补丁层。

## 后果

- **代价：** 网关从只读变为可写，新增一个 Remote 和一条写 profile patch 的路径；
  对 profile 未挂载（任何 bundle 都没有）的行不支持切换；重新启用总是写
  `disabled: false`，所以即使默认启用的插件被用户重新打开，patch 也会带一行。
- **收益：** 用户可在页面内开关插件，且选择在重启后保留——复用 Loader 现有的运行时
  update 路径，并在最后应用的用户层写显式覆盖。
