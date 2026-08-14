# @deepseek-ai/dsh-image-recognition-bundle

Opt-in image-recognition bundle for a profile. Its `cordis.patch.yml` mounts the
capability seam (`@deepseek-ai/dsh-image-recognition`), the configurable HTTP
provider (`@deepseek-ai/dsh-image-recognition-http`), and the model-facing
consumer (`@deepseek-ai/dsh-tool-image-recognition`).

The bundle is **not** in any default profile's bundles list. Enable it per
profile by adding this package to the profile's `dsh.profile.bundles` (or
`dsh plugin --profile <name> add @deepseek-ai/dsh-image-recognition-bundle`),
then configure the endpoint and key in the Plugins settings page
(`image-recognition` card).

## Known Limitations and Deferred Work

- Requires the user to supply a vision provider endpoint and key; recognition is
  unavailable until both are configured.
