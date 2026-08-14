import { describe, expect, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { hasImageSignal } from '../src/index.ts'

function userMessage(blocks: UserMessage['content']): UserMessage {
  return { id: 'u', role: 'user', source: { kind: 'user' }, content: blocks } as UserMessage
}

/** A content block carrying an image signal (the payload is irrelevant here). */
function imageBlock(): UserMessage['content'][number] {
  return { type: 'image', attachment: {} as never } as UserMessage['content'][number]
}

describe('hasImageSignal', () => {
  it('detects an image content block when block detection is on', () => {
    expect(hasImageSignal([userMessage([imageBlock()])], true, true)).toBe(true)
  })

  it('ignores image blocks when block detection is off', () => {
    expect(hasImageSignal([userMessage([imageBlock()])], false, true)).toBe(false)
  })

  it('detects an image file path in text when path detection is on', () => {
    const message = userMessage([{ type: 'text', text: 'transcribe /tmp/screenshot.png' }])
    expect(hasImageSignal([message], true, true)).toBe(true)
  })

  it('detects an image URL in text', () => {
    const message = userMessage([{ type: 'text', text: 'look at https://e.test/photo.JPG' }])
    expect(hasImageSignal([message], true, true)).toBe(true)
  })

  it('ignores plain text with no image signal', () => {
    const message = userMessage([{ type: 'text', text: 'summarize this document' }])
    expect(hasImageSignal([message], true, true)).toBe(false)
  })
})
