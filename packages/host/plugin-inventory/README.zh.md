# @deepseek-ai/dsh-host-plugin-inventory

[English](README.md) | 中文

当前 Cordis Loader 树的 Host 投影，带逐插件启用/停用。`PluginInventoryGateway` 注册 `pluginInventory` 服务，并发布两个由 Typert 生成的直接 Remote：`pluginInventory/list` 与 `pluginInventory/setEnabled`。`list` 直接读取 `ctx.loader.entries()`，跳过结构性的 group 行，再按 Loader 顺序返回其余条目，并且只包含 Loader 条目 id、模块标识、有效启用状态与当前根 Fiber 阶段。

阶段为 `pending`、`loading`、`active`、`failed` 或 `unloading`；条目没有存活的根 Fiber 时则为 `null`。该快照刻意只表示调用当下：Loader 仍是唯一的生命周期权威，本包不拥有缓存、历史、来源模型或事件流。`setEnabled` 通过 `ctx.loader.update` 实时切换单条条目，并把显式 `disabled` 覆盖写进 profile 的用户补丁层，使选择在重启后保留（bundle 默认禁用的行需要 `disabled: false` 覆盖才能保持启用）。

每条条目带 `protected` 标记。`src/required.ts` 中的守卫默认开放，含两个可由代码编辑的名单：`REQUIRED_PLUGINS`（黑名单，即不可停用的承重核心——入口树、Remote RPC 主干、session 与 agent 主干）与 `USER_TOGGLEABLE_PLUGINS`（白名单，覆盖黑名单、对显式可开关的插件生效）；未列入任何名单的插件默认可切换。随包 base bundle 的完整依赖图分类见 [`docs/plugin-system.md`](../../../docs/plugin-system.md)。`setEnabled` 拒绝停用必需插件；启用后会校验 fiber 变为 active（依赖缺失的启用会回滚）。Web 插件列表 tab 渲染单一扁平列表，包含所有条目：每项按真实启用状态显示，可切换插件带"启用"或"停用"按钮（这样 bundle 默认禁用的插件也能重新启用），必需插件只显示只读说明。

网关还通过 `availableBundles`/`install`/`uninstall` 管理安装。`availableBundles` 列出 `src/bundles.ts`（`AVAILABLE_BUNDLES`）中策展的离线可安装可选 bundle，每项在存在于 profile 的 `dsh.profile.bundles` 时标记为已安装。`install` 把离线 bundle 组合进该列表（无需网络）；对 registry spec 则用内置 Node 与 vendored pnpm 在可写的 profile 目录运行 pnpm——registry 安装受 `dshAllowPluginInstall` 上下文标志门禁，仅桌面启动会开启。这些写入持久化 profile 清单，需重启生效。公开 payload 类型位于 `./types`，Typert 生成由 `./typert` 与 `./remote` 导出的 Host 和 Client Remote 产物。

该服务仅供 Remote 使用，刻意不声明同进程 Cordis `Context` merge。Client 包通过显式的 [`api-remotes`](../../api/remotes/README.md) 组合消费它，而不导入 Host 实现。

## 模型体验

无，因为这个仅限 Host 的清单投影不注册提示词、工具、消息或提供方请求。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制与暂缓事项

- **仅表示调用当下** —— 结果不包含持久的失败历史或订阅；只要不存在存活的根 Fiber，就会报告 `null`，而不区分其原因。
- **无来源、不能增删** —— 服务不识别条目由哪个 bundle、profile 或 override 引入，也不能添加或移除插件。启用/停用持久化到 profile 的用户补丁层；profile 未挂载（任何 bundle 都没有）的行无法从这里切换。
