# @deepseek-ai/dsh-host-plugin-inventory

[English](README.md) | 中文

当前 Cordis Loader 树的 Host 投影，带逐插件启用/停用。`PluginInventoryGateway` 注册 `pluginInventory` 服务，并发布两个由 Typert 生成的直接 Remote：`pluginInventory/list` 与 `pluginInventory/setEnabled`。`list` 直接读取 `ctx.loader.entries()`，跳过结构性的 group 行，再按 Loader 顺序返回其余条目，并且只包含 Loader 条目 id、模块标识、有效启用状态与当前根 Fiber 阶段。

阶段为 `pending`、`loading`、`active`、`failed` 或 `unloading`；条目没有存活的根 Fiber 时则为 `null`。该快照刻意只表示调用当下：Loader 仍是唯一的生命周期权威，本包不拥有缓存、历史、来源模型或事件流。`setEnabled` 通过 `ctx.loader.update` 实时切换单条条目，并把显式 `disabled` 覆盖写进 profile 的用户补丁层，使选择在重启后保留（bundle 默认禁用的行需要 `disabled: false` 覆盖才能保持启用）。

每条条目带 `protected` 标记。守卫默认保护：所有随包插件都是应用必需（停用一个被其他插件注入的插件会破坏依赖者；启用一个服务不可用的插件会导致启动失败），所以 `setEnabled` 拒绝它们、UI 隐藏开关。只有部署通过 opt-in bundle 添加的插件（`src/required.ts` 的 `USER_TOGGLEABLE_PLUGINS`）可切换。Web 插件列表 tab 按当前状态分组：已停用插件在主列表带"启用"按钮（可重新启用），已启用插件放在可折叠的"系统插件"区——用户自加的已启用插件仍保留"停用"按钮，必需插件则无任何开关。公开 payload 类型位于 `./types`，Typert 生成由 `./typert` 与 `./remote` 导出的 Host 和 Client Remote 产物。

该服务仅供 Remote 使用，刻意不声明同进程 Cordis `Context` merge。Client 包通过显式的 [`api-remotes`](../../api/remotes/README.md) 组合消费它，而不导入 Host 实现。

## 模型体验

无，因为这个仅限 Host 的清单投影不注册提示词、工具、消息或提供方请求。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制与暂缓事项

- **仅表示调用当下** —— 结果不包含持久的失败历史或订阅；只要不存在存活的根 Fiber，就会报告 `null`，而不区分其原因。
- **无来源、不能增删** —— 服务不识别条目由哪个 bundle、profile 或 override 引入，也不能添加或移除插件。启用/停用持久化到 profile 的用户补丁层；profile 未挂载（任何 bundle 都没有）的行无法从这里切换。
