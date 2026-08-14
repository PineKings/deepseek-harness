/**
 * The `image-recognition-http` settings section layered over the composition
 * entry. Asserts the provider's key stays on the image-recognition credential
 * plane even when the stored section names the chat model's ref: a stale
 * `apiKeyEnv` must never resolve (or overwrite) `DEEPSEEK_API_KEY`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { ImageRecognitionRuntime, type ImageRecognitionRequest } from '@deepseek-ai/dsh-image-recognition'
import * as irHttpPlugin from '@deepseek-ai/dsh-image-recognition-http'
import { IMAGE_RECOGNITION_HTTP_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-image-recognition-http'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const request: ImageRecognitionRequest = {
  image: { kind: 'base64', base64: 'aGVsbG8=', mediaType: 'image/png' },
}

async function boot(): Promise<{ ctx: Context; fiber: Fiber }> {
  const ctx = new Context()
  await ctx.plugin(ImageRecognitionRuntime, {})
  await ctx.plugin(MemorySettings).await()
  const fiber = ctx.plugin(irHttpPlugin, {})
  await fiber.await()
  return { ctx, fiber }
}

/** Recognize once and return the Authorization header the provider sent. */
async function recognizeOnce(ctx: Context): Promise<string | undefined> {
  const fetchMock = vi.fn(async (_url: string, _init?: { headers?: Record<string, string> }) =>
    jsonResponse({ choices: [{ message: { content: 'a cat' } }] }))
  vi.stubGlobal('fetch', fetchMock)
  await ctx.imageRecognition.recognize(request)
  const init = fetchMock.mock.calls[0]?.[1]
  return init?.headers?.['authorization']
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.IMAGE_RECOGNITION_API_KEY
  delete process.env.DEEPSEEK_API_KEY
})

describe('image-recognition-http settings section', () => {
  it('resolves the image-recognition credential plane by default', async () => {
    process.env.IMAGE_RECOGNITION_API_KEY = 'ir-secret'
    const bench = await boot()
    expect(await recognizeOnce(bench.ctx)).toBe('Bearer ir-secret')
    await bench.ctx.fiber.dispose()
  })

  it('ignores a stored chat-model ref so image recognition never reads the model key', async () => {
    process.env.IMAGE_RECOGNITION_API_KEY = 'ir-secret'
    process.env.DEEPSEEK_API_KEY = 'model-secret'
    const bench = await boot()
    await bench.ctx.settings.update(IMAGE_RECOGNITION_HTTP_SETTINGS_NAMESPACE, {
      apiKeyEnv: 'DEEPSEEK_API_KEY',
    })
    expect(await recognizeOnce(bench.ctx)).toBe('Bearer ir-secret')
    await bench.ctx.fiber.dispose()
  })

  it('serves a stored endpoint to the next recognition without re-registering the provider', async () => {
    process.env.IMAGE_RECOGNITION_API_KEY = 'ir-secret'
    const bench = await boot()
    await bench.ctx.settings.update(IMAGE_RECOGNITION_HTTP_SETTINGS_NAMESPACE, {
      baseURL: 'https://vision.stored.test/v1',
    })
    const fetchMock = vi.fn(async (_url: string) => jsonResponse({ choices: [{ message: { content: 'x' } }] }))
    vi.stubGlobal('fetch', fetchMock)
    await bench.ctx.imageRecognition.recognize(request)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://vision.stored.test/v1/chat/completions')
    await bench.ctx.fiber.dispose()
  })

  it('releases the namespace when the plugin unloads', async () => {
    const bench = await boot()
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('image-recognition-http')
    await bench.fiber.dispose()
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).not.toContain('image-recognition-http')
    await bench.ctx.fiber.dispose()
  })
})
