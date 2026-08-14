/**
 * Register a configurable HTTP vision provider in `ctx.imageRecognition`. The
 * user points `baseURL` and a model at an OpenAI-compatible chat-completions
 * endpoint; the provider encodes the image as a data URL and returns recognized
 * text. Key and endpoint are user-editable through the settings section.
 * @module @deepseek-ai/dsh-image-recognition-http
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-image-recognition'
import {
  ImageRecognitionHttpProvider,
  IMAGE_RECOGNITION_DEFAULT_MAX_TOKENS,
  IMAGE_RECOGNITION_DEFAULT_MODEL,
} from './provider.ts'
import type { ImageRecognitionHttpProviderOptions } from './provider.ts'

export {
  ImageRecognitionHttpProvider,
  IMAGE_RECOGNITION_DEFAULT_MAX_TOKENS,
  IMAGE_RECOGNITION_DEFAULT_MODEL,
  IMAGE_RECOGNITION_HTTP_PROVIDER_ID,
} from './provider.ts'
export type { ImageRecognitionHttpProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'image-recognition-http'

/** The image-recognition seam this provider registers into. */
export const inject = ['imageRecognition']

const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each recognition; defaults to `DEEPSEEK_API_KEY`. */
  apiKeyEnv?: string
  /** OpenAI-compatible endpoint base; `/chat/completions` is appended. */
  baseURL?: string
  /** Vision model name. Defaults to `deepseek-v4-flash`. */
  model?: string
  /** Upper bound on generated tokens. Defaults to 2048. */
  maxTokens?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  model: z.string().default(IMAGE_RECOGNITION_DEFAULT_MODEL),
  maxTokens: z.number().step(1).min(1).default(IMAGE_RECOGNITION_DEFAULT_MAX_TOKENS),
})

/** Environment variable naming this provider's endpoint. */
const BASE_URL_ENV = 'DSH_IMAGE_RECOGNITION_BASE_URL'

/** Settings namespace carrying this provider's endpoint, model, and key reference. */
export const IMAGE_RECOGNITION_HTTP_SETTINGS_NAMESPACE = settingsNamespace('image-recognition-http')

/**
 * Project one resolved section into the options the provider serves its next
 * recognition with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns options for one recognition.
 */
function resolveOptions(ctx: Context, config: Config): ImageRecognitionHttpProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      // Without the seam the environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    baseURL: config.baseURL
      ?? launchEnvironmentOf(ctx).get(BASE_URL_ENV)?.value
      ?? '',
    model: config.model ?? IMAGE_RECOGNITION_DEFAULT_MODEL,
    maxTokens: config.maxTokens ?? IMAGE_RECOGNITION_DEFAULT_MAX_TOKENS,
    recordRequest: (request) => {
      ctx.get('agents')?.currentInitiator()?.session.append(
        'image-recognition/llm-request',
        request,
      )
    },
  }
}

/** Register the HTTP image-recognition provider with `ctx.imageRecognition`. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, IMAGE_RECOGNITION_HTTP_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    // The registration carries no resolved value: the provider projects the
    // section per recognition, so a committed change needs no re-registration.
    onChange: () => {},
  })
  ctx.imageRecognition.registerProvider(
    new ImageRecognitionHttpProvider(() => resolveOptions(ctx, current())),
  )
}
