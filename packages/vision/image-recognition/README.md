# @deepseek-ai/dsh-image-recognition

Service Definition for the image-recognition capability seam (`ctx.imageRecognition`):
a provider registry and provider-selecting execution, mirrored on the web seam.

- A provider registers via `ctx.imageRecognition.registerProvider(provider)`; a
  duplicate `id` throws `IMAGE_RECOGNITION_DUPLICATE_PROVIDER`.
- `recognize(request, signal)` resolves the provider at call time. Selection is
  order-independent: a configured id must be registered and `available()`;
  without a configured id, exactly one usable provider auto-selects. See the
  `ImageRecognitionError` codes for missing/unavailable/ambiguous providers.
- `ImageInput` is a closed union of `file-path`, `base64`, and `url`; a provider
  encodes the kind it serves.

## Config

`provider` pins which provider wins; `$DSH_IMAGE_RECOGNITION_PROVIDER` is the
environment equivalent (not a hidden priority chain).

## Known Limitations and Deferred Work

- The seam is provider-neutral by design; image decoding/encoding lives in the
  provider, not here.
- `ImageRecognitionError` codes are open-string and provider-specific codes are
  tolerated by consumers.
