import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImageRecognitionRequest } from '@deepseek-ai/dsh-image-recognition'
import {
  ImageRecognitionHttpProvider,
  type ImageRecognitionHttpProviderOptions,
} from '../src/provider.ts'

/** A stub vision endpoint. */
function stubFetch(response: Partial<Response>): void {
  vi.stubGlobal('fetch', vi.fn(async () => response))
}

function makeProvider(overrides: Partial<ImageRecognitionHttpProviderOptions> = {}): ImageRecognitionHttpProvider {
  return new ImageRecognitionHttpProvider(() => ({
    resolveApiKey: async () => 'key',
    baseURL: 'https://vision.example.com/v1',
    model: 'vision-model',
    maxTokens: 128,
    ...overrides,
  }))
}

const request: ImageRecognitionRequest = {
  image: { kind: 'base64', base64: 'aGVsbG8=', mediaType: 'image/png' },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ImageRecognitionHttpProvider.available', () => {
  it('is unavailable when no baseURL is configured', () => {
    expect(makeProvider({ baseURL: '' }).available()).toBe(false)
  })

  it('is available when a baseURL is configured', () => {
    expect(makeProvider().available()).toBe(true)
  })
})

describe('ImageRecognitionHttpProvider.recognize', () => {
  it('returns the recognized text from a 200 response', async () => {
    stubFetch({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'a cat' } }] }) })
    await expect(makeProvider().recognize(request)).resolves.toEqual({ text: 'a cat' })
  })

  it('sends the image as a data URL to the configured endpoint', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: { body?: string }) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'x' } }] }) }))
    vi.stubGlobal('fetch', fetchMock)
    await makeProvider({ baseURL: 'https://v.example.com/v1' }).recognize(request)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://v.example.com/v1/chat/completions')
    const body = JSON.parse(init?.body ?? '{}') as { messages: Array<{ content: Array<{ type: string; image_url: { url: string } }> }> }
    expect(body.messages[0]!.content[1]!.image_url.url).toBe('data:image/png;base64,aGVsbG8=')
  })

  it('normalizes a trailing slash on the endpoint base', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: { body?: string }) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'x' } }] }) }))
    vi.stubGlobal('fetch', fetchMock)
    await makeProvider({ baseURL: 'https://v.example.com/v1/' }).recognize(request)
    expect(fetchMock.mock.calls[0]![0]).toBe('https://v.example.com/v1/chat/completions')
  })

  it('sends a file-path image as a base64 data URL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-ir-'))
    writeFileSync(join(dir, 'img.png'), Buffer.from('hello', 'utf8'))
    const fetchMock = vi.fn(async (_url: string, _init?: { body?: string }) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'x' } }] }) }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await makeProvider().recognize({ image: { kind: 'file-path', filePath: join(dir, 'img.png') } })
      const [, init] = fetchMock.mock.calls[0]!
      const body = JSON.parse(init?.body ?? '{}') as { messages: Array<{ content: Array<{ image_url?: { url: string } }> }> }
      expect(body.messages[0]!.content[1]!.image_url!.url).toBe('data:image/png;base64,aGVsbG8=')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('throws IMAGE_RECOGNITION_PROVIDER_CREDENTIAL_MISSING without a key', async () => {
    await expect(makeProvider({ apiKey: '', resolveApiKey: async () => undefined }).recognize(request))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_RECOGNITION_PROVIDER_CREDENTIAL_MISSING' }))
  })

  it('throws IMAGE_RECOGNITION_PROVIDER_CREDENTIAL_MISSING without a model', async () => {
    await expect(makeProvider({ model: '' }).recognize(request))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_RECOGNITION_PROVIDER_CREDENTIAL_MISSING' }))
  })

  it('maps a non-2xx response to IMAGE_RECOGNITION_PROVIDER_ERROR', async () => {
    stubFetch({ ok: false, status: 429, json: async () => ({ error: { message: 'rate limited' } }) })
    await expect(makeProvider().recognize(request))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_RECOGNITION_PROVIDER_ERROR' }))
  })

  it('maps a network failure to IMAGE_RECOGNITION_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
    await expect(makeProvider().recognize(request))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_RECOGNITION_PROVIDER_ERROR' }))
  })
})
