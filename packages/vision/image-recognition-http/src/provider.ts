/**
 * An OpenAI-compatible chat-completions vision provider for
 * `ctx.imageRecognition`. Encodes the image as a data URL and sends it to a
 * user-configured `baseURL`/`model` endpoint, returning the recognized text.
 * @module @deepseek-ai/dsh-image-recognition-http/provider
 */

import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import {
  ImageRecognitionError,
  type ImageInput,
  type ImageRecognitionProvider,
  type ImageRecognitionRequest,
  type ImageRecognitionResult,
} from '@deepseek-ai/dsh-image-recognition'
import type {} from '@deepseek-ai/dsh-session/types'

export const IMAGE_RECOGNITION_HTTP_PROVIDER_ID = 'http'

/** Secret-free vision request body recorded before dispatch. */
export interface ImageRecognitionLlmRequest {
  readonly model: string
  readonly max_tokens: number
  readonly messages: readonly unknown[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Secret-free vision request body recorded before dispatch. */
    'image-recognition/llm-request': ImageRecognitionLlmRequest
  }
}

export const IMAGE_RECOGNITION_DEFAULT_MODEL = 'qwen3-vl-flash'
export const IMAGE_RECOGNITION_DEFAULT_MAX_TOKENS = 2048
export const IMAGE_RECOGNITION_DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

const USER_AGENT = 'deepseek-harness/0.0.1'

/** Options the provider serves one recognition with, resolved by the plugin. */
export interface ImageRecognitionHttpProviderOptions {
  /** Literal API key, when configured. */
  readonly apiKey?: string
  /** Resolve the key from the credential/ambient plane per recognition. */
  readonly resolveApiKey: () => Promise<string | undefined>
  /** Endpoint base; `/chat/completions` is appended. */
  readonly baseURL: string
  /** Vision model name. */
  readonly model: string
  /** Upper bound on generated tokens. */
  readonly maxTokens: number
  /** Record the outgoing LLM request for the session log. */
  readonly recordRequest?: (request: ImageRecognitionLlmRequest) => void
}

const MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** Best-effort media type for a file path; undefined when the extension is unknown. */
function mediaTypeForPath(filePath: string): string | undefined {
  return MEDIA_TYPE_BY_EXTENSION[extname(filePath).toLowerCase()]
}

/** Whether the value is a network (fetch) AbortError. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** Resolve the request's image to a data URL or plain URL the endpoint accepts. */
async function imageSource(input: ImageInput): Promise<string> {
  switch (input.kind) {
    case 'base64':
      return `data:${input.mediaType};base64,${input.base64}`
    case 'url':
      return input.url
    case 'file-path': {
      const mediaType = mediaTypeForPath(input.filePath)
      if (mediaType === undefined) {
        throw new ImageRecognitionError(
          `cannot infer media type for "${input.filePath}"; pass the image as base64 with an explicit media type`,
          'IMAGE_RECOGNITION_PROVIDER_ERROR',
        )
      }
      const bytes = await readFile(input.filePath)
      return `data:${mediaType};base64,${bytes.toString('base64')}`
    }
  }
}

/**
 * A vision endpoint that recognizes image content through the OpenAI-compatible
 * chat-completions protocol.
 */
export class ImageRecognitionHttpProvider implements ImageRecognitionProvider {
  readonly id = IMAGE_RECOGNITION_HTTP_PROVIDER_ID

  constructor(private readonly resolveOptions: () => ImageRecognitionHttpProviderOptions) {}

  available(): boolean {
    return URL.canParse(this.resolveOptions().baseURL)
  }

  async recognize(request: ImageRecognitionRequest, signal?: AbortSignal): Promise<ImageRecognitionResult> {
    // Snapshot the section once per recognition so live settings changes apply.
    const options = this.resolveOptions()
    const apiKey = options.apiKey ?? (await options.resolveApiKey())
    if (apiKey === undefined || apiKey.length === 0) {
      throw new ImageRecognitionError(
        'image-recognition provider has no API key configured; set one in the plugin settings or environment',
        'IMAGE_RECOGNITION_PROVIDER_CREDENTIAL_MISSING',
      )
    }
    if (options.model.length === 0) {
      throw new ImageRecognitionError(
        'image-recognition provider has no model configured; set one in the plugin settings',
        'IMAGE_RECOGNITION_PROVIDER_CREDENTIAL_MISSING',
      )
    }
    const source = await imageSource(request.image)
    const payload = {
      model: options.model,
      max_tokens: options.maxTokens,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: request.prompt ?? 'Describe the contents of this image.' },
          { type: 'image_url', image_url: { url: source } },
        ],
      }],
    }
    options.recordRequest?.(payload)

    let response: Response
    try {
      response = await fetch(`${options.baseURL}/chat/completions`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(payload),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error) {
      if (isAbortError(error)) {
        throw new ImageRecognitionError('image recognition aborted', 'IMAGE_RECOGNITION_ABORTED', { cause: error })
      }
      throw new ImageRecognitionError(`image recognition network failure: ${String(error)}`, 'IMAGE_RECOGNITION_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      let detail = ''
      try {
        const body = (await response.json()) as { error?: { message?: unknown } }
        detail = typeof body.error?.message === 'string' ? `: ${body.error.message}` : ''
      } catch {
        // Non-JSON error bodies carry no structured detail.
      }
      throw new ImageRecognitionError(
        `image-recognition provider returned ${response.status}${detail}`,
        'IMAGE_RECOGNITION_PROVIDER_ERROR',
      )
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.length === 0) {
      throw new ImageRecognitionError('image-recognition provider returned no text', 'IMAGE_RECOGNITION_PROVIDER_ERROR')
    }
    return { text: content }
  }
}
