/**
 * Which Loader plugins the running application requires and must not be toggled.
 *
 * The guard is a default-protect rule: every shipped/known plugin is required by
 * the application, so toggling it can tear the process down — disabling a plugin
 * that another plugin injects breaks the dependent, and enabling one whose
 * service is unavailable fails the boot. Only plugins a deployment explicitly
 * adds through an opt-in bundle (the "user/extra" plugins) are safe to enable or
 * disable. Add every new opt-in bundle's plugin module names to
 * {@link USER_TOGGLEABLE_PLUGINS}.
 * @module @deepseek-ai/dsh-plugin-inventory/required
 */

/**
 * Plugin module names a deployment may enable or disable. Every other module is
 * required by the application and surfaced as `protected`. Extend this set when
 * a new opt-in bundle adds plugins the UI should let the user toggle.
 */
const USER_TOGGLEABLE_PLUGINS = new Set([
  '@deepseek-ai/dsh-image-recognition',
  '@deepseek-ai/dsh-image-recognition-http',
  '@deepseek-ai/dsh-tool-image-recognition',
  // Test seam: a `cordis:` builtin the unit tests use as a toggleable entry.
  'cordis:user-toggleable',
])

/** Whether a Loader module is required by the application and must not be toggled. */
export function isRequiredPlugin(moduleName: string): boolean {
  return !USER_TOGGLEABLE_PLUGINS.has(moduleName)
}
