/**
 * The curated catalog of optional bundles a deployment may install offline.
 *
 * A bundle here is an npm package that is already resolvable from the running
 * installation (it is shipped in the harness or declared as a dependency of the
 * app), so "installing" it only means composing it into the profile's
 * `dsh.profile.bundles` — no network or package manager required. Add a new
 * shipped optional bundle to {@link AVAILABLE_BUNDLES} to make it installable
 * from the plugin list.
 *
 * The profile's default bundles (`dsh-base`, `dsh-web-app`, and the
 * `dsh-image-recognition-bundle` that ships in the web template) are composed by
 * default and are NOT offered here as installable or uninstallable — they are
 * part of the deployment, not optional add-ons.
 * @module @deepseek-ai/dsh-plugin-inventory/bundles
 */

/**
 * Bundle package names a deployment may compose offline. Keep this to bundles
 * that are guaranteed resolvable from the installation anchor and are genuinely
 * optional (not default template bundles). Currently empty — no optional
 * bundles ship yet; new ones should be added here to become installable.
 */
export const AVAILABLE_BUNDLES: readonly string[] = []
