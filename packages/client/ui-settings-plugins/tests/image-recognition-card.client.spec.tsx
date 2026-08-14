// @vitest-environment jsdom
/**
 * The image-recognition card renders its endpoint, key, and model controls once
 * expanded, mirroring the web-search card. Catches any render-time throw that
 * registration alone would not surface.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { ImageRecognitionCard } from '../src/client/ImageRecognitionCard.tsx'
import { ImageRecognitionCardController, type ImageRecognitionSettings } from '../src/client/image-recognition-card-controller.ts'

afterEach(cleanup)

const t = (key: string): string => key

function renderCard(value: ImageRecognitionSettings = {}) {
  const host = stubSettingsScope<ImageRecognitionSettings>()
  const credentials = {
    describe: vi.fn(() => Promise.resolve({
      rpcId: 'c' as never,
      result: { ok: true as const, value: { credentials: { IMAGE_RECOGNITION_API_KEY: { configured: false, writable: true } } } },
    })),
    set: vi.fn(),
    unset: vi.fn(),
  }
  const controller = new ImageRecognitionCardController(host.scope, { credentials })
  host.publish({ status: 'ready', writable: true, value, user: {} })
  const face = controller.inject()
  render(
    <ImageRecognitionCard
      t={t as never}
      useImageRecognitionCard={selector => selector(face.hooks.imageRecognitionCard.getSnapshot())}
      save={face.save}
      discard={face.discard}
      edit={face.edit}
      resetField={face.resetField}
      clearApiKey={face.clearApiKey}
      useSessions={() => [] as never}
      useWorkspaces={() => [] as never}
    />,
  )
  // The card's controls sit behind its disclosure header.
  fireEvent.click(screen.getByRole('button', { name: /expand: imageRecognitionTitle/ }))
  return { host, controller, credentials }
}

describe('ImageRecognitionCard', () => {
  it('renders the endpoint, key, and model controls once expanded', () => {
    renderCard()
    // Each getByLabelText throws when its control is absent.
    expect(screen.getByLabelText('imageRecognitionApiKey')).toBeTruthy()
    expect(screen.getByLabelText('imageRecognitionBaseUrl')).toBeTruthy()
    expect(screen.getByLabelText('imageRecognitionModel')).toBeTruthy()
  })

  it('clears the configured credential through the clear-key button', () => {
    const { credentials } = renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'imageRecognitionClearKey' }))
    expect(credentials.unset).toHaveBeenCalledWith({ ref: 'IMAGE_RECOGNITION_API_KEY' })
  })

  it('ignores a stale model apiKeyEnv so the image-recognition key never overwrites the chat key', () => {
    const { credentials } = renderCard({ apiKeyEnv: 'DEEPSEEK_API_KEY' })
    fireEvent.click(screen.getByRole('button', { name: 'imageRecognitionClearKey' }))
    expect(credentials.unset).toHaveBeenCalledWith({ ref: 'IMAGE_RECOGNITION_API_KEY' })
  })
})
