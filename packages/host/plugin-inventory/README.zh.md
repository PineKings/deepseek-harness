# @deepseek-ai/dsh-host-plugin-inventory

[English](README.md) | 中文

当前 Cordis Loader 树的 Host 投影，带逐插件启用/停用。`PluginInventoryGateway` 注册 `pluginInventory` 服务，并发布两个由 Typert 生成的直接 Remote：`pluginInventory/list` 与 `pluginInventory/setEnabled`。`list` 直接读取 `ctx.loader.entries()`，跳过结构性的 group 行，再按 Loader 顺序返回其余条目，并且只包含 Loader 条目 id、模块标识、有效启用状态与当前根 Fiber 阶段。

阶段为 `pending`、`loading`、`active`、`failed` 或 `unloading`；条目没有存活的根 Fiber 时则为 `null`。该快照刻意只表示调用当下：Loader 仍是唯一的生命周期权威，本包不拥有缓存、历史、来源模型或事件流。`setEnabled` 通过 `ctx.loader.update` 实时切换单条条目，并把显式 `disabled` 覆盖写进 profile 的用户补丁层，使选择在重启后保留（bundle 默认禁用的行需要 `disabled: false` 覆盖才能保持启用）。

每条条目带 `protected` 标记。`src/required.ts` 中的守卫默认开放，含两个可由代码编辑的名单：`REQUIRED_PLUGINS`（黑名单，即不可停用的承重核心——入口树、Remote RPC 主干、session 与 agent 主干）与 `USER_TOGGLEABLE_PLUGINS`（白名单，覆盖黑名单、对显式可开关的插件生效）；未列入任何名单的插件默认可切换。随包 base bundle 的完整依赖图分类见 [`docs/plugin-system.md`](../../../docs/plugin-system.md)。`setEnabled` 拒绝停用必需插件；`apply` 真正失败的插件会经 loader 自身的启动错误被拒绝，而仅仅等待依赖（PENDING）的插件会保持启用，待依赖就绪后自动激活。Web 插件列表 tab 渲染单一扁平列表，包含所有条目：每项按真实启用状态显示，可切换插件带"启用"或"停用"按钮（这样 bundle 默认禁用的插件也能重新启用），必需插件只显示只读说明。

网关还通过 `availableBundles`/`installPlugin`/`installedBundles`/`uninstall` 管理安装。`availableBundles` 列出 `src/bundles.ts`（`AVAILABLE_BUNDLES`）中策展的离线可安装可选 bundle；该目录目前为空，直到有可选 bundle 随包——profile 的默认 bundle（`dsh-base`、`dsh-web-app`、`dsh-image-recognition-bundle`）是部署的一部分，非可选插件，`uninstall` 拒绝移除它们。`installedBundles` 列出 profile 中用户安装的依赖（即可卸载的那些）。`uninstall` 用 `pnpm remove` 完整移除用户安装的依赖（同时删除依赖与它声明的 bundle 层，和安装一样受 `dshAllowPluginInstall` 门禁），对已组合的离线可选 bundle 仅取消组合，并拒绝内置默认 bundle。`installPlugin` 在可写的 profile 目录对任意 `pnpm add` specifier 运行 pnpm——用内置进 harness 的 pnpm，或当没有内置 pnpm（如开发 checkout）时用 PATH 上的 `pnpm`，只有两者都不存在才显式报错——裸 npm 包名、tarball 路径或 URL（含 GitHub archive `.tar.gz`）、git/GitHub 仓库地址，所有社区安装来源共用同一条路径。registry 安装受 `dshAllowPluginInstall` 上下文标志门禁，仅桌面启动会开启；裸包名 spec 会依次尝试 `src/install.ts` 中排序的 `INSTALL_REGISTRIES` 镜像源列表，直到其中一个成功——官方 npm 源排在最后作为保底，只有所有镜像源都不可达才报错，而 git/tarball/path spec 只运行一次、不经过镜像源。裸包名 spec 还会带上 `--minimum-release-age-exclude`，使刚发布的插件也能安装。

由于 pnpm 11 默认拦截依赖的构建脚本，当有脚本被拦截时安装分两阶段：首次调用把被拦截的包作为 `pendingBuilds` 返回而非失败，设置页 tab 以沙箱警告展示这些包供用户逐包同意，重试时把已同意的集合放在 `consentBuilds` 里——宿主把恰好这些包的按包 `allowBuilds` map（pnpm ≥11）与 `onlyBuiltDependencies` 数组（pnpm 10）直接写进 profile 的 `pnpm-workspace.yaml`，然后重新安装。直接写配置而非运行 `pnpm approve-builds`，不依赖这些包是否处于 pnpm 的 pending 状态。当 boot 提供了 `dshReloadProfile` 句柄时，网关在写入后重组合运行中的树，使插件立即生效（`restartRequired: false`）；否则安装持久化 profile 清单，需重启生效（`restartRequired: true`）。公开 payload 类型位于 `./types`，Typert 生成由 `./typert` 与 `./remote` 导出的 Host 和 Client Remote 产物。

插件市场通过 `marketplaceList`/`marketplaceInstall`/`marketplaceUninstall` 暴露。目录放在静态网站宿主上（默认 `https://deepseek.pinesound.cn/plugins/plugins.json`，可用 `DSH_MARKETPLACE_URL` 覆盖）：一个索引 JSON 列出插件，旁边每个插件的 JSON 规定安装方式（`git`、`npm`、`tarball` 或 `bundle`）以及 pnpm specifier 和依赖名。`marketplaceList` 叠加持久化安装表——`$DSH_HOME/plugin-marketplace/installed.json` 下的一小份 JSON 文档——把每条标记为已安装；该表是判断是否已安装的权威依据。`marketplaceInstall` 把安装方式映射到既有安装路径（git/npm/tarball 走 registry Remote，bundle 走离线组合），成功后在表中记录安装，并沿用同样的两阶段构建脚本同意流程；`marketplaceUninstall` 从表中解析依赖名，执行既有卸载并删除表行。每个插件的 spec URL 由固定目录基地址加插件 id 推导（绝不取自目录内容），因此恶意目录无法把应用指向任意 URL。

该服务仅供 Remote 使用，刻意不声明同进程 Cordis `Context` merge。Client 包通过显式的 [`api-remotes`](../../api/remotes/README.md) 组合消费它，而不导入 Host 实现。

## 模型体验

无，因为这个仅限 Host 的清单投影不注册提示词、工具、消息或提供方请求。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制与暂缓事项

- **仅表示调用当下** —— 结果不包含持久的失败历史或订阅；只要不存在存活的根 Fiber，就会报告 `null`，而不区分其原因。
- **无来源、不能增删** —— 服务不识别条目由哪个 bundle、profile 或 override 引入，也不能添加或移除插件。启用/停用持久化到 profile 的用户补丁层；profile 未挂载（任何 bundle 都没有）的行无法从这里切换。
