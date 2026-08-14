/**
 * Model-facing image-recognition consumer. Registers a bundled `image-recognition`
 * skill and a `recognize_image` tool, and — when a step's input carries an image
 * — deterministically injects the skill body before the model acts, so the model
 * recognizes the image first and then continues the task.
 * @module @deepseek-ai/dsh-tool-image-recognition
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { isModelInvocable, renderSkillContent } from '@deepseek-ai/dsh-skill'
import type { ImageInput, ImageRecognitionResult } from '@deepseek-ai/dsh-image-recognition'

export const name = 'tool-image-recognition'
export const inject = ['imageRecognition', 'skills', 'systemPrompt', 'tools']

const SKILL_NAME = 'image-recognition'

/** The `{kind:'plugin'}` source stamped on every injection this plugin makes. */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'tool-image-recognition' }

/** The bundled recognition skill body, injected verbatim when an image task is detected. */
const SKILL_CONTENT = [
  '## Image recognition',
  'When the task involves an image (an attached image, an image file path, or an image URL), FIRST recognize its content before continuing the task:',
  '',
  '1. Determine which image the task refers to from the conversation (attachment, path, or URL).',
  '2. Call `recognize_image` with that image and, when useful, a `prompt` naming what to extract (e.g. "transcribe the text", "describe the scene", "read the numbers").',
  '3. Use the recognized text as ground truth to complete the original task.',
  '',
  'Do not guess at image contents from a filename or description — run `recognize_image` and act on its result.',
].join('\n')

/** Plugin config (all optional). */
export interface Config {
  /** Inject the skill body when a step input carries an image content block. */
  detectImageBlocks?: boolean
  /** Inject the skill body when a step input text names an image file path or URL. */
  detectImagePaths?: boolean
}

export const Config: z<Config> = z.object({
  detectImageBlocks: z.boolean().default(true),
  detectImagePaths: z.boolean().default(true),
})

/**
 * Whether a step input carries an image: an image content block, or a text
 * block naming an image file path / image URL. Never reads image bytes — it is
 * a cheap signal for whether to inject the recognition skill.
 * @param messages - the step's claimed batch.
 * @param detectBlocks - whether image content blocks count as a signal.
 * @param detectPaths - whether image file paths / URLs in text count as a signal.
 * @returns true when any supported image signal is present.
 */
export function hasImageSignal(
  messages: readonly UserMessage[],
  detectBlocks: boolean,
  detectPaths: boolean,
): boolean {
  return messages.some(message =>
    message.content.some((block) => {
      if (block.type === 'image') return detectBlocks
      if (block.type !== 'text') return false
      return detectPaths && IMAGE_TEXT_RE.test(block.text)
    }),
  )
}

/** An image file path or image URL named in text. */
const IMAGE_TEXT_RE = /\.(?:png|jpe?g|webp|gif)\b|https?:\/\/[^\s]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s]*)?/i

/** Normalize a tool `image` argument into the seam's {@link ImageInput}. */
function toImageInput(image: string): ImageInput {
  if (image.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(image)
    if (match === null) throw new Error('recognize_image: invalid data URL')
    // RegExpExecArray group access types as string | undefined; the anchored
    // pattern guarantees both groups when it matches.
    const mediaType = match[1]
    const base64 = match[2]
    if (mediaType === undefined || base64 === undefined) throw new Error('recognize_image: invalid data URL')
    return { kind: 'base64', base64, mediaType }
  }
  if (/^https?:\/\//.test(image)) return { kind: 'url', url: image }
  return { kind: 'file-path', filePath: image }
}

/**
 * Install the recognition skill, tool, deterministic injection, and prompt
 * section.
 * @param ctx - plugin context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const detectBlocks = config.detectImageBlocks ?? true
  const detectPaths = config.detectImagePaths ?? true

  ctx.skills.register({
    name: SKILL_NAME,
    source: 'runtime',
    description: 'Recognize and describe the contents of an image (objects, scenes, and text) so you can continue a task about it.',
    whenToUse: 'Use whenever the task involves an attached, referenced, or named image and you need to know what it contains.',
    invocation: { modelInvocable: true, userInvocable: true },
    content: SKILL_CONTENT,
  })

  const recognizeImageTool = defineTool({
    name: 'recognize_image',
    description: 'Recognize the contents of an image (objects, scenes, and text) through the configured image provider and return the recognized text.',
    parameters: {
      image: { type: 'string', required: true, description: 'The image to recognize: a file path, an https URL, or a data: URL.' },
      prompt: { type: 'string', description: 'Optional recognition focus, e.g. "transcribe the text" or "describe the scene".' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
        },
      },
      render: (_args, value: ImageRecognitionResult) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const result = await ctx.imageRecognition.recognize({
        image: toImageInput(args.image),
        ...args.prompt !== undefined ? { prompt: args.prompt } : {},
      }, exec.signal)
      return result
    },
    presentCall(args) {
      return { card: 'generic', title: 'Recognize image', kind: 'read', rawInput: args.image }
    },
  })
  ctx.tools.register(recognizeImageTool)

  // Deterministic injection: when the step input carries an image, prepend the
  // recognition skill body so the model recognizes it before other actions.
  // Delegate first, then prepend onto the decision (never veto, never rewrite).
  ctx.on('agent/pre-step', async (
    { agent, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    if (!hasImageSignal(decision.messages, detectBlocks, detectPaths)) return decision
    signal.throwIfAborted()
    const lookup = { cwd: agent.session.header.cwd, signal, scope: agent }
    const skill = await ctx.skills.get(SKILL_NAME, lookup)
    signal.throwIfAborted()
    if (skill === undefined || !isModelInvocable(skill)) return decision
    const injection = createUserMessage({
      content: [{ type: 'text', text: renderSkillContent(skill) }],
      source: { ...PLUGIN_SOURCE, form: 'instructions', summary: 'recognize image first' },
    })
    return { kind: 'enter', messages: [injection, ...decision.messages] }
  })

  ctx.systemPrompt.section({
    name: 'tool:image-recognition',
    order: 115,
    text: 'When a task involves an image, recognize it first with `recognize_image` before continuing; do not infer image contents from a filename or description.',
  })
}
