# 更改说明 — deepseek-harness 社区版

本仓库是 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)(MIT)
的**社区衍生版**,由 PineSound 维护。核心 harness——插件架构、agent loop、服务端、前端——**完全保留不变**;
本仓库在其基础上新增了桌面应用与相关产品能力。

- **上游**: https://github.com/deepseek-ai/deepseek-harness(MIT)
- **本仓库**: 新增 `apps/desktop`、若干 host/client 包与发布渠道
- **协议**: [MIT](LICENSE),保留原项目版权
- **桌面仓库**: https://github.com/PineKings/deepseek-harness-desktop
- **发布站**: https://deepseek.pinesound.cn/

## 相比上游的主要改动

### 1. 桌面应用(`apps/desktop`,即 deepseek-harness-desktop)
- 基于 Electron 的桌面外壳,启动真正的 `dsh`(`web` 配置)于回环端口并打开原生窗口,无需浏览器标签页或手动输入 URL。
- 自包含:安装包内置完整 harness 运行时、vendored pnpm 与平台 Node,目标机器**零外部依赖**。
- 跨平台安装包:macOS(`.dmg`)与 Windows(`.nsis`)。
- 中文应用菜单与品牌图标。

### 2. 插件清单与插件市场(`packages/host/plugin-inventory`)
- 可视化插件列表,支持搜索、状态查看与启用/停用。
- 黑白名单守卫:核心系统插件不可停用。
- 经内置 pnpm 从 npm / tarball / GitHub 安装插件,多镜像回退、免重启实时生效。
- 插件市场:持久化安装状态、按优先级排序。

### 3. 技能管理(`packages/host/skill-manager`)
- 在设置页管理本机技能:列表、安装、卸载、启用/停用、编辑描述。

### 4. 图像识别 / 视觉能力
- 通过 OpenAI 兼容 HTTP 视觉提供方(如阿里云 DashScope)为纯文本模型补齐视觉能力。
- 视觉的密钥 / 接口 / 模型与对话主模型**完全独立**配置。
- 新增 settings **命名空间暴露**机制(`configurable` + `exposeSettings`),可在界面编辑第三方 settings 命名空间。

### 5. 更新与发布渠道
- 「关于」页显示动态版本号与「检查更新」,读取线上 `releases.json`。
- 桌面更新与网页发布站读取**同一份**清单,一次发布同时服务桌面与网页。

## 保留范围

本仓库**不改变 harness 后端**。桌面仅是薄启动器;原生插件仍运行在系统 Node ABI 上,从未加载进 Electron。
