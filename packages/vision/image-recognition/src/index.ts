/**
 * Service Definition for the image-recognition capability seam
 * (`ctx.imageRecognition`): a provider registry and provider-selecting
 * execution. Duplicate ids are rejected. At execution time, a configured
 * provider must exist and be usable; without one, exactly one usable provider is
 * required, so selection never depends on registration order.
 * @module @deepseek-ai/dsh-image-recognition
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  ImageRecognitionError,
  type ImageRecognitionProvider,
  type ImageRecognitionRequest,
  type ImageRecognitionResult,
} from './types.ts'

export { ImageRecognitionError } from './types.ts'
export type {
  ImageInput,
  ImageRecognitionProvider,
  ImageRecognitionRequest,
  ImageRecognitionResult,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    imageRecognition: ImageRecognitionRuntime
  }
}

/** Selection inputs for execution-time provider resolution. */
interface Selection {
  /** The configured provider id for this capability, if any. */
  readonly configuredId?: string
  /** Providers registered for this capability kind. */
  readonly providers: ReadonlyMap<string, ImageRecognitionProvider>
}

/**
 * Config for the image-recognition seam. `provider` pins which provider wins;
 * optional (a single registered usable provider auto-selects). Operational
 * overrides such as environment variables feed these same fields rather than
 * introduce a hidden priority chain.
 */
export interface ImageRecognitionRuntimeConfig {
  /** Explicit provider id. Omitted = auto-select when exactly one usable. */
  readonly provider?: string
}

/**
 * The image-recognition service. Registered as `ctx.imageRecognition` (one
 * instance per context).
 *
 * Selection semantics (resolved at execution time, never order-dependent):
 * - A configured id registered and `available()` → that provider.
 * - A configured id not registered → `IMAGE_RECOGNITION_PROVIDER_CONFIGURED_MISSING`.
 * - A configured id registered but unavailable → `IMAGE_RECOGNITION_PROVIDER_CONFIGURED_UNAVAILABLE`.
 * - No id, exactly one registered usable provider → that provider.
 * - No id, multiple usable providers → `IMAGE_RECOGNITION_PROVIDER_AMBIGUOUS`.
 * - No id, no usable provider → `IMAGE_RECOGNITION_PROVIDER_UNAVAILABLE`.
 */
export class ImageRecognitionRuntime extends Service {
  /**
   * Provider selection config. `$DSH_IMAGE_RECOGNITION_PROVIDER` is equivalent
   * to `provider` and is NOT a hidden priority chain.
   */
  static Config: z<ImageRecognitionRuntimeConfig> = z.object({
    provider: z.string(),
  })

  private providers = new Map<string, ImageRecognitionProvider>()
  private readonly providerId: string | undefined

  constructor(ctx: Context, config: ImageRecognitionRuntimeConfig = {}) {
    super(ctx, 'imageRecognition')
    this.providerId = config.provider ?? process.env.DSH_IMAGE_RECOGNITION_PROVIDER
  }

  /**
   * Register a recognition provider. Throws {@link ImageRecognitionError}
   * `IMAGE_RECOGNITION_DUPLICATE_PROVIDER` if its id is already registered.
   * Returns a disposer; disposed with the calling fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerProvider(provider: ImageRecognitionProvider): () => void {
    const providers = this.providers
    if (providers.has(provider.id)) {
      throw new ImageRecognitionError(
        `an image-recognition provider with id "${provider.id}" is already registered`,
        'IMAGE_RECOGNITION_DUPLICATE_PROVIDER',
      )
    }
    const dispose = this.ctx.effect(function* () {
      providers.set(provider.id, provider)
      yield () => providers.delete(provider.id)
    }, 'imageRecognition.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is
    // synchronous fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /**
   * Whether a provider can currently serve recognition. True when a configured
   * provider is registered and usable, or exactly one usable provider is
   * registered without a pin. Cheap and side-effect-free (no network): it reads
   * only the registry and each provider's local `available()` check, so a
   * consumer can gate its surface on configuration without attempting a call.
   * @returns whether recognition is currently configured and usable.
   */
  available(): boolean {
    try {
      resolveProvider({
        providers: this.providers,
        ...this.providerId !== undefined ? { configuredId: this.providerId } : {},
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * Run one recognition through the selected provider. Resolves the provider at
   * call time with the selection rules above; throws {@link ImageRecognitionError}
   * when the capability cannot run.
   * @param request - the image and optional recognition prompt.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the recognized text.
   */
  async recognize(request: ImageRecognitionRequest, signal?: AbortSignal): Promise<ImageRecognitionResult> {
    const provider = resolveProvider({
      providers: this.providers,
      ...this.providerId !== undefined ? { configuredId: this.providerId } : {},
    })
    return provider.recognize(request, signal)
  }
}

/** Resolve the selected provider or throw the matching {@link ImageRecognitionError}. */
function resolveProvider(selection: Selection): ImageRecognitionProvider {
  const { configuredId, providers } = selection
  if (configuredId !== undefined) {
    const provider = providers.get(configuredId)
    if (!provider) {
      throw new ImageRecognitionError(
        `configured image-recognition provider "${configuredId}" is not registered`,
        'IMAGE_RECOGNITION_PROVIDER_CONFIGURED_MISSING',
      )
    }
    if (!provider.available()) {
      throw new ImageRecognitionError(
        `configured image-recognition provider "${configuredId}" is registered but unavailable`,
        'IMAGE_RECOGNITION_PROVIDER_CONFIGURED_UNAVAILABLE',
      )
    }
    return provider
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  const [single] = usable
  if (single === undefined) {
    throw new ImageRecognitionError('no usable image-recognition provider is registered', 'IMAGE_RECOGNITION_PROVIDER_UNAVAILABLE')
  }
  if (usable.length > 1) {
    const ids = usable.map(provider => provider.id).join(', ')
    throw new ImageRecognitionError(
      `multiple usable image-recognition providers are registered (${ids}); configure one explicitly`,
      'IMAGE_RECOGNITION_PROVIDER_AMBIGUOUS',
    )
  }
  return single
}

export default ImageRecognitionRuntime
