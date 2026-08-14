import { describe, expect, it } from 'vitest'
import { AVAILABLE_BUNDLES } from '../src/bundles.ts'
import { isRequiredPlugin, isUserToggleable } from '../src/required.ts'

describe('isRequiredPlugin (blacklist/whitelist, default-open)', () => {
  it('marks the blacklist core as required', () => {
    for (const name of ['@deepseek-ai/cordis-plugin-loader', '@deepseek-ai/dsh-session', 'cordis:required']) {
      expect(isRequiredPlugin(name)).toBe(true)
      expect(isUserToggleable(name)).toBe(false)
    }
  })

  it('defaults everything else to toggleable', () => {
    for (const name of ['@deepseek-ai/dsh-hmr', '@deepseek-ai/dsh-tool-todo', 'cordis:user-toggleable']) {
      expect(isRequiredPlugin(name)).toBe(false)
      expect(isUserToggleable(name)).toBe(true)
    }
  })

  it('whitelist overrides the blacklist for an explicitly toggleable plugin', () => {
    // image-recognition is on the whitelist, so it is never required.
    for (const name of ['@deepseek-ai/dsh-image-recognition', '@deepseek-ai/dsh-image-recognition-http']) {
      expect(isRequiredPlugin(name)).toBe(false)
      expect(isUserToggleable(name)).toBe(true)
    }
  })
})

describe('AVAILABLE_BUNDLES', () => {
  it('lists the offline-installable optional bundles', () => {
    expect(AVAILABLE_BUNDLES).toContain('@deepseek-ai/dsh-image-recognition-bundle')
    expect(new Set(AVAILABLE_BUNDLES).size).toBe(AVAILABLE_BUNDLES.length)
  })
})
