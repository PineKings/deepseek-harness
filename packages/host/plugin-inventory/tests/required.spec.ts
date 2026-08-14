import { describe, expect, it } from 'vitest'
import { AVAILABLE_BUNDLES } from '../src/bundles.ts'
import { isRequiredPlugin, isUserToggleable } from '../src/required.ts'

describe('isRequiredPlugin (blacklist/whitelist, default-open)', () => {
  it('marks the blacklist core as required', () => {
    for (const name of ['@deepseek-ai/cordis-plugin-loader', '@deepseek-ai/dsh-session', 'cordis:required', 'cordis:include']) {
      expect(isRequiredPlugin(name)).toBe(true)
      expect(isUserToggleable(name)).toBe(false)
    }
  })

  it('whitelists the currently-disabled set as toggleable', () => {
    for (const name of [
      '@deepseek-ai/dsh-tool-pwsh', '@deepseek-ai/dsh-skill-badge',
      '@deepseek-ai/dsh-session-telemetry-otel', '@deepseek-ai/dsh-pwsh-sandbox',
    ]) {
      expect(isRequiredPlugin(name)).toBe(false)
      expect(isUserToggleable(name)).toBe(true)
    }
  })

  it('defaults unknown modules to toggleable', () => {
    for (const name of ['@fixture/never', 'cordis:user-toggleable']) {
      expect(isRequiredPlugin(name)).toBe(false)
      expect(isUserToggleable(name)).toBe(true)
    }
  })
})

describe('AVAILABLE_BUNDLES', () => {
  it('is empty: no optional bundles ship as offline-installable yet', () => {
    expect(AVAILABLE_BUNDLES).toEqual([])
  })
})
