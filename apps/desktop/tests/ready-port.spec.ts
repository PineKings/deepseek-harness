import { describe, expect, it } from 'vitest'
import { parseReadyPort } from '../src/ready-port.ts'

describe('parseReadyPort', () => {
  it('extracts the port from a complete readiness line', () => {
    expect(parseReadyPort('dsh web: http://127.0.0.1:38291')).toBe(38291)
  })

  it('ignores lines without a readiness URL', () => {
    expect(parseReadyPort('loading plugins…')).toBeUndefined()
    expect(parseReadyPort('http://192.168.1.5:8080')).toBeUndefined()
  })

  it('matches the loopback URL before a LAN suffix on the same line', () => {
    expect(parseReadyPort('dsh web: http://127.0.0.1:38291 (LAN: http://192.168.1.5:8080)')).toBe(38291)
  })
})
