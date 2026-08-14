# Agent Note：图像识别能力（可选 bundle）

Status: implemented

English | [中文](2026-08-14-image-recognition-capability.md)

## 问题

harness 此前无法把"识别图像内容"作为任务的一等步骤。多模态模型可以 `read_image`，
但没有东西检测图像任务、并通过用户配置的识别提供方先路由它。用户想要一个仿网页
搜索的图像能力插件：在设置页填写供应商地址 + API Key，让模型先识别图像再继续任务。

## 决策

在 `packages/vision/` 下新增四个包，构成完整能力缝，镜像 web-search 的三角色形态
（Service Definition / Provider / Consumer），外加一个可选 bundle：

- **Service Definition** `@deepseek-ai/dsh-image-recognition`：`ctx.imageRecognition`
  提供方注册表 + 按提供方选择的 `recognize()`（镜像 `ctx.web`）：重复 id 拒绝、
  选择与注册顺序无关、`ImageRecognitionError` 分类。
- **Provider** `@deepseek-ai/dsh-image-recognition-http`：可配置的
  OpenAI 兼容 chat-completions 视觉提供方。`baseURL` + `model` 在实时 settings
  区段；密钥经 credential-ref 走凭据域。把不含密钥的视觉请求记录为
  `image-recognition/llm-request` 会话事件。
- **Consumer** `@deepseek-ai/dsh-tool-image-recognition`：注册 `recognize_image`
  工具和一个内置 `image-recognition` 技能，并挂接 `agent/pre-step`，当一步输入
  携带图像（图像内容块或图像文件路径/URL）时**确定性注入**技能体，让模型先识别
  再做其他动作。
- **Bundle** `@deepseek-ai/dsh-image-recognition-bundle`：挂载以上三者；**可选**——
  不在任何默认 profile 的 bundles 列表里。
- **设置页卡片**：在插件设置页新增 `image-recognition` 卡片（接口地址 + 密钥），
  仿 web-search 卡片。

机制是"确定性注入 + 模型驱动执行"：pre-step 注入保证技能指令在场，而模型仍驱动
实际的 `recognize_image` 调用（与所有既有插件一致——模型是工具使用的最终决策者）。

## 启用

用户按 profile 启用，把 `@deepseek-ai/dsh-image-recognition-bundle` 加入该 profile
的 `dsh.profile.bundles`（或 `dsh plugin --profile <name> add ...`），然后在插件
设置页配置接口地址和密钥。

## 验证

- `packages/vision/*` 单测：SD 选择语义、provider 的 HTTP 错误/中止映射、图像信号
  检测函数。
- 全量 host 程序类型检查通过。
- 实机：启用 bundle，附加一张图，确认 `recognize_image` 运行且任务基于其结果继续。

## 备选方案

- **用内置多模态 `read_image` 作为机制。** 已否决：用户想要一个可配置的提供方
  （地址 + 密钥），在设置页露出，仿 web-search，而不是固定的多模态路径。
- **仅 prompt 引导（注册技能、让模型自主路由）。** 已否决：用户要求确定性保证——
  模型先识别图像；pre-step 注入实现这一点，同时模型仍驱动实际工具调用。

## 后果

- **代价：** 新增四个包 + 一个客户端卡片组成的能力缝；可选 bundle 需要先配置提供方
  才能工作；图像任务的路径/URL 检测是启发式的，可关闭。
- **收益：** 识别成为一等步骤，且提供方由用户掌控；harness 遵循能力缝与
  "确定性注入 + 模型驱动执行"模式；功能按 profile 可选，不改变默认行为。
