import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ImageRecognitionRuntime, {
  type ImageRecognitionProvider,
  type ImageRecognitionRequest,
  type ImageRecognitionResult,
} from '@deepseek-ai/dsh-image-recognition'

/** A scripted recognition provider for contract tests. */
function makeProvider(
  id: string,
  available: boolean,
  recognize: (request: ImageRecognitionRequest) => Promise<ImageRecognitionResult>,
): ImageRecognitionProvider {
  return { id, available: () => available, recognize: request => recognize(request) }
}

const available = true
const unavailable = false

function recognizeResult(marker: string): ImageRecognitionResult {
  return { text: marker }
}

/** Mount an ImageRecognitionRuntime on a fresh root context with the given config. */
async function mountRuntime(
  config: ConstructorParameters<typeof ImageRecognitionRuntime>[1] = {},
): Promise<{ ctx: Context; runtime: ImageRecognitionRuntime }> {
  const ctx = new Context()
  await ctx.plugin(ImageRecognitionRuntime, config)
  return { ctx, runtime: ctx.imageRecognition }
}

describe('ImageRecognitionRuntime registration', () => {
  it('registers a provider and unregisters it via the returned disposer', async () => {
    const { runtime } = await mountRuntime()

    const dispose = runtime.registerProvider(makeProvider('http', available, () => Promise.resolve(recognizeResult('cat'))))
    await expect(runtime.recognize({ image: { kind: 'url', url: 'https://e.test/c.png' } })).resolves.toMatchObject({ text: 'cat' })

    dispose()
    await expect(runtime.recognize({ image: { kind: 'url', url: 'https://e.test/c.png' } }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_RECOGNITION_PROVIDER_UNAVAILABLE' }))
  })

  it('throws IMAGE_RECOGNITION_DUPLICATE_PROVIDER on a duplicate id', async () => {
    const { runtime } = await mountRuntime()
    runtime.registerProvider(makeProvider('http', available, () => Promise.resolve(recognizeResult('a'))))
    expect(() => runtime.registerProvider(makeProvider('http', available, () => Promise.resolve(recognizeResult('a')))))
      .toThrow(expect.objectContaining({ code: 'IMAGE_RECOGNITION_DUPLICATE_PROVIDER' }))
  })

  it('disposes provider registrations when the contributing fiber is disposed (HMR safety)', async () => {
    const { ctx, runtime } = await mountRuntime()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.imageRecognition.registerProvider(makeProvider('http', available, () => Promise.resolve(recognizeResult('a'))))
    }, { inject: ['imageRecognition'] }))
    await expect(runtime.recognize({ image: { kind: 'url', url: 'https://e.test/c.png' } })).resolves.toMatchObject({ text: 'a' })
    await fiber.dispose()
    await expect(runtime.recognize({ image: { kind: 'url', url: 'https://e.test/c.png' } }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_RECOGNITION_PROVIDER_UNAVAILABLE' }))
  })
})

describe('ImageRecognitionRuntime selection', () => {
  it('picks the configured provider when registered and available', async () => {
    const { runtime } = await mountRuntime({ provider: 'b' })
    runtime.registerProvider(makeProvider('a', available, () => Promise.resolve(recognizeResult('a'))))
    runtime.registerProvider(makeProvider('b', available, () => Promise.resolve(recognizeResult('b'))))
    await expect(runtime.recognize({ image: { kind: 'url', url: 'https://e.test/c.png' } })).resolves.toMatchObject({ text: 'b' })
  })

  it('rejects a configured provider that is not registered', async () => {
    const { runtime } = await mountRuntime({ provider: 'missing' })
    await expect(runtime.recognize({ image: { kind: 'url', url: 'https://e.test/c.png' } }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_RECOGNITION_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('rejects a configured provider that is registered but unavailable', async () => {
    const { runtime } = await mountRuntime({ provider: 'http' })
    runtime.registerProvider(makeProvider('http', unavailable, () => Promise.resolve(recognizeResult('a'))))
    await expect(runtime.recognize({ image: { kind: 'url', url: 'https://e.test/c.png' } }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_RECOGNITION_PROVIDER_CONFIGURED_UNAVAILABLE' }))
  })

  it('auto-selects the single usable provider when none is configured', async () => {
    const { runtime } = await mountRuntime()
    runtime.registerProvider(makeProvider('http', unavailable, () => Promise.resolve(recognizeResult('a'))))
    runtime.registerProvider(makeProvider('other', available, () => Promise.resolve(recognizeResult('other'))))
    await expect(runtime.recognize({ image: { kind: 'url', url: 'https://e.test/c.png' } })).resolves.toMatchObject({ text: 'other' })
  })

  it('rejects multiple usable providers without a configured pin', async () => {
    const { runtime } = await mountRuntime()
    runtime.registerProvider(makeProvider('a', available, () => Promise.resolve(recognizeResult('a'))))
    runtime.registerProvider(makeProvider('b', available, () => Promise.resolve(recognizeResult('b'))))
    await expect(runtime.recognize({ image: { kind: 'url', url: 'https://e.test/c.png' } }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_RECOGNITION_PROVIDER_AMBIGUOUS' }))
  })
})
