/**
 * Which Loader plugins the running application requires and must not be toggled,
 * and which plugins a deployment explicitly allows the user to toggle.
 *
 * The guard is default-open with two code-editable lists:
 *  - {@link REQUIRED_PLUGINS} is the blacklist of load-bearing core plugins that
 *    must never be disabled (disabling one tears the process or the management
 *    surface down).
 *  - {@link USER_TOGGLEABLE_PLUGINS} is the whitelist of plugins a deployment
 *    explicitly permits the user to toggle; a whitelisted name overrides the
 *    blacklist for that plugin.
 * A plugin on neither list is toggleable by default. Edit these lists (they are
 * plain constants) to change what the plugin-inventory `protected` flag reports
 * and what `setEnabled` refuses to disable.
 * @module @deepseek-ai/dsh-plugin-inventory/required
 */

/**
 * Blacklist: plugin module names required by the application and must not be
 * toggled. Keep this to the true core: the entry tree, the Remote RPC spine
 * every Remote depends on, and the session/agent spines. `cordis:required` is a
 * test seam for the unit tests.
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

/**
 * Whitelist: plugin module names a deployment explicitly permits the user to
 * toggle. A name here overrides the blacklist, so a whitelisted plugin is never
 * reported `protected` even if it is also required. Everything else is
 * toggleable by default, so this is the place to force a specific plugin open.
 */
const USER_TOGGLEABLE_PLUGINS = new Set([
  '@deepseek-ai/dsh-image-recognition',
  '@deepseek-ai/dsh-image-recognition-http',
  '@deepseek-ai/dsh-tool-image-recognition',
])

/**
 * Whether a Loader module is required by the application and must not be toggled.
 * The blacklist wins over the default-open stance unless the name is explicitly
 * whitelisted.
 * @param moduleName - the Loader module specifier.
 * @returns true when the plugin is `protected` (cannot be disabled).
 */
export function isRequiredPlugin(moduleName: string): boolean {
  return REQUIRED_PLUGINS.has(moduleName) && !USER_TOGGLEABLE_PLUGINS.has(moduleName)
}

/**
 * Whether a Loader module may be toggled by the user. Default-open: a plugin is
 * toggleable unless the blacklist marks it required and it is not whitelisted.
 * @param moduleName - the Loader module specifier.
 * @returns true when the plugin can be enabled or disabled.
 */
export function isUserToggleable(moduleName: string): boolean {
  return !isRequiredPlugin(moduleName)
}
