# 插件系统

[English](plugin-system.md) | 中文

本参考文档说明插件在 harness 中如何被安装、组合与注入，以及随包 `dsh-base` bundle 如何划分为系统必需插件与自由可选插件。它是关于插件系统当前运作方式的参考；它所依赖的 Cordis 运行时语义见 [cordis primer](cordis-primer.md) 与 [Cordis API](cordis-api/context.md)，包组合总览见 [architecture.md](architecture.md)。

## 三条主线

插件就是一个普通的 npm（或 workspace）包，它按名称被组合进某个 profile，通过 Node 模块解析加载，并挂载成 Cordis fiber——只有当它所注入的服务激活后才会运行。支撑这一点的是三条主线：**组合**（profile 挂载哪些插件）、**解析**（一个名称如何变成已加载的代码）、**激活**（插件何时真正运行）。

## 安装与组合

没有"按名称下载并注册插件代码"的代码。"安装"一个插件意味着两件事：它是 profile（或安装）的 `node_modules` 里一个可解析的 npm 包，并且它出现在某个组合层里。

profile 是一个目录（`$DSH_HOME/profiles/<name>`），其 `package.json` 在 `dsh.profile.bundles` 下列出有序的 **bundle**。每个 bundle 是一个包，带 `dsh.bundle.patch` 字段，指向一个 `cordis.patch.yml`——一个由 loader patch 条目组成的顶层数组。当 `dsh --profile web` 启动时，`apps/cli` 的 `composeProfile` 把各 bundle 的 patch、profile 自身的 `cordis.patch.yml`、首页级 `$DSH_HOME/cordis.patch.yml`、任何 `--patch` 覆盖以及 telemetry 开关按序叠成一个 patch 列表；`boot` 安装 `Loader` 服务，并在 profile 的空 `cordis.yml`（仅用于把 Loader 的 `baseUrl` 锚定到 profile 目录）之上挂载一个根 `include` 条目；include 通过 `applyEntryPatches` 读取其 patch 列表，并通过 `EntryGroup.update` 把组合出的行事务性地对账为存活的 entry 树——创建、更新或停用每条 `Entry`；每个 entry 通过 Node `internal.import` 按 `name`（其模块标识符）导入插件模块，在 entry 自身上下文里插值 `!!js` 的 config 与 `disabled` 表达式，并把模块挂载为 Cordis fiber。

bundle 先按安装锚点、再按 profile 目录解析；一个扁平软链闭包（`healProfilesModuleFallback`）保证每个随包插件都能从任意 profile 被 Node 解析。`dsh plugin add <package>` 本质上是在 profile 目录里执行 `pnpm add`，之后任何声明了 `dsh.bundle` 的已安装包会被并入 `dsh.profile.bundles`。`verify-cordis-config` 门禁强制了两条安装路径背后的不变量：组合所引用的每个裸插件 specifier 都必须出现在负责解析它的包的 `dependencies` 里。

## 注入与激活

函数插件具名导出 `name`、`inject`、`Config`、`apply`（无 default 导出）；服务插件默认导出一个 `Service` 子类，构造时自行注册；对象插件是 `{ apply }`。`inject` 列出插件所需的服务。

服务由 `Service` 子类通过 `super(ctx, name)` 提供，它在上下文 store 里注册实例。`ctx.<name>` 读取走一个属性代理，沿 fiber 树遍历插件的祖先（拓扑敏感）；`ctx.get(name)` 读全局 store，只返回其 fiber 处于 active 状态的提供者。这就是为什么一条声明过的注入只有当其提供者在插件祖先链中激活后才是可读的。

激活顺序由服务可用性决定。注入服务缺失的 fiber 保持 `PENDING`，永不运行 `apply`；当提供者出现时它会被反应式唤醒。树稳定后，宿主审计每条启用条目（`assertEntriesActivated`），把任何 `PENDING` 条目视为启动失败并列出缺失服务。典型例子是注入 `workflowEngine` 的工具（如 `dsh-tool-ralph`）在工作流引擎提供者未挂载时保持 pending。

## 系统必需插件与可选插件

"必需"是一个依赖图属性：当停用某插件会令承重服务不可用、进而让注入该服务的核心插件保持 `PENDING` 时，它就是系统必需插件。随包 `dsh-base` bundle 是每种模式都会挂载的共享核心。按这一属性对它的行分组：

| 插件（模块标识符） | 承重服务 | 类别 |
|---|---|---|
| `cordis-plugin-loader` | loader entry 树本身 | 必需 |
| `dsh-typert-registry` | `ctx.typert`（Remote RPC 类型注册表） | 必需 |
| `dsh-typert-loader` | Remote RPC 类型加载 | 必需 |
| `dsh-api-gateway` | `ctx.typertGateway`（RPC 调用） | 必需 |
| `dsh-agent` | `ctx.agents` | 必需 |
| `dsh-session` | `ctx.sessions` | 必需 |
| `dsh-llm` | `ctx.llm` | 必需 |
| `dsh-tools` | `ctx.tools`（工具注册表） | 必需 |
| `dsh-system-prompt` | 系统提示词组装 | 必需 |
| `dsh-agent-loop` | `ctx.agentLoop`（注入 agents/sessions/llm/tools/systemPrompt） | 必需 |
| `dsh-settings-file` | 用户设置文档（配置） | 必需 |
| `dsh-credentials-local` | 凭据存储（密钥） | 必需 |
| `dsh-base` 中其余所有行 | 无（叶子能力） | 可选 |

`dsh-agent-loop` 是最大的承重消费方：它注入 `['agents', 'sessions', 'llm', 'tools', 'systemPrompt']`，因此停用它或它的任一注入提供者都会让整个 agent 运行时保持 `PENDING`。配置与凭据行之所以必需，是因为去掉它们就失去了树的其余部分所读取的配置与密钥主干。

可选行是叶子能力，停用只移除某个功能、绝不破坏核心：`hmr`、`timer`、`web` 及其搜索、shell 与 terminal 提供者、`skill`、`goal`、`plan-mode`、`compaction`、`subagent`、`workflow`、`sandbox` 及各具体 sandbox 提供者、`approval` 与 `permission`、`telemetry`、`spill`、`todo`，以及各条 `tool-*` 与 `command-*` 行。

有两组边界情况值得说明。安全主干——`dsh-sandbox`、`dsh-fs-sandbox`、`dsh-sandbox-policy`、`dsh-permission-presets`、`dsh-user-approval`——对默认的"工作区可写 + 询问"姿态是必需的，但部署可以放宽它。web profile 还会组合 `dsh-web-app`（宿主传输、连接、前端服务）与可选的 `dsh-image-recognition-bundle`；`dsh-headless` 组合 `dsh-base` 加 headless runner 各行。这些 bundle 的行只在挂载它们的模式内才是必需的。

## 插件清单的 `protected` 标志

插件清单宿主把每条 loader entry 投影为 `enabled = !entry.disabled` 与 `protected = isRequiredPlugin(entry.options.name)`。`src/required.ts` 里的 `isRequiredPlugin` 是一个默认开放的守卫：除非某个模块标识符出现在一个小的显式集合里——目前是 loader、typert 主干、`dsh-session`、`dsh-agent`——否则每个插件都可切换。这个集合是上面依赖图派生必需列表的保守子集：它没有保护 `dsh-agent-loop`、`dsh-llm`、`dsh-tools`、`dsh-system-prompt` 或 `dsh-api-gateway`。这里给出的完整依赖图分类，正是将来若要把守卫改成"反映不可停用核心"时用于扩展该集合的依据。
