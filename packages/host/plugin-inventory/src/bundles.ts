/**
 * The curated catalog of optional bundles a deployment may install offline.
 *
 * A bundle here is an npm package that is already resolvable from the running
 * installation (it is shipped in the harness or declared as a dependency of the
 * app), so "installing" it only means composing it into the profile's
 * `dsh.profile.bundles` — no network or package manager required. Add a new
 * shipped optional bundle to {@link AVAILABLE_BUNDLES} to make it installable
 * from the plugin list.
 * @module @deepseek-ai/dsh-plugin-inventory/bundles
 */

/**
 * Bundle package names a deployment may compose offline. Keep this to bundles
 * that are guaranteed resolvable from the installation anchor.
 */
export const AVAILABLE_BUNDLES: readonly string[] = [
  '@deepseek-ai/dsh-image-recognition-bundle',
]
