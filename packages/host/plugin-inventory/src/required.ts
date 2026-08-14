/**
 * Which Loader plugins the running application requires and must not be toggled.
 *
 * The guard is default-open: every plugin is toggleable unless it is explicitly
 * listed as required. Only the few load-bearing core plugins that other plugins
 * inject and whose disable would tear the process or the management surface
 * down are surfaced as `protected`. Add a module name to
 * {@link REQUIRED_PLUGINS} when a plugin must never be disabled.
 * @module @deepseek-ai/dsh-plugin-inventory/required
 */

/**
 * Plugin module names that are required by the application and must not be
 * toggled. Everything else is toggleable. Keep this to the true core: the entry
 * tree, the Remote RPC spine every Remote depends on, and the session/agent
 * spines. `cordis:required` is a test seam for the unit tests.
 */
const REQUIRED_PLUGINS = new Set([
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/dsh-typert-registry',
  '@deepseek-ai/dsh-typert-loader',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-agent',
  // Test seam: a `cordis:` builtin the unit tests use as a required entry.
  'cordis:required',
])

/** Whether a Loader module is required by the application and must not be toggled. */
export function isRequiredPlugin(moduleName: string): boolean {
  return REQUIRED_PLUGINS.has(moduleName)
}
