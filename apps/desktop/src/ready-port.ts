/**
 * Readiness-URL parsing for the desktop shell. Kept as a dependency-free module
 * so it is unit-testable under plain Node: the Electron main process otherwise
 * owns every other responsibility.
 * @module @deepseek-ai/dsh-desktop/ready-port
 */

/** The bind host the desktop always requests: loopback only, never the LAN. */
export const LOOPBACK_HOST = '127.0.0.1' as const

/** Readiness marker the web profile prints once its server is listening. */
export const READY_RE = /http:\/\/127\.0\.0\.1:(\d+)/

/**
 * Extract the listening port from a web-profile readiness line.
 * @param line - a line of child stdout (may already include earlier chunks).
 * @returns the port, or `undefined` when the line carries no readiness URL.
 */
export function parseReadyPort(line: string): number | undefined {
  const match = READY_RE.exec(line)
  return match === null ? undefined : Number(match[1])
}
