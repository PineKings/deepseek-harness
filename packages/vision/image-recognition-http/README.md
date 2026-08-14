# @deepseek-ai/dsh-image-recognition-http

A user-configurable HTTP vision provider for `ctx.imageRecognition`. It calls an
OpenAI-compatible `/chat/completions` endpoint with the image encoded as a data
URL and returns the recognized text.

## Config

| Key | Type | Meaning |
|---|---|---|
| `baseURL` | string | Endpoint base; `/chat/completions` is appended. Blank inherits `$DSH_IMAGE_RECOGNITION_BASE_URL`, else unavailable. |
| `apiKey` | string (secret) | Literal key; prefer `apiKeyEnv`. |
| `apiKeyEnv` | string (credential-ref) | Credential reference resolved per recognition; defaults to `DEEPSEEK_API_KEY`. |
| `model` | string | Vision model name; defaults to `deepseek-v4-flash`. |
| `maxTokens` | number | Generated-token bound; defaults to 2048. |

The endpoint and key are editable live through the `image-recognition-http`
settings section. The key never rides a response: it is resolved per recognition
from the credentials domain, falling back to the launch environment.

A recognition under an initiating Agent appends the log-only
`image-recognition/llm-request` session event carrying the secret-free request
body before dispatch.

## Known Limitations and Deferred Work

- The provider assumes an OpenAI-compatible vision endpoint; non-standard
  endpoints must be adapted via `baseURL`/`model` (or a new provider).
- `file-path` inputs require an inferable media type from the extension.
