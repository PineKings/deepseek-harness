# vision/

Image-recognition capability family over the DeepSeek Harness: a Service
Definition seam, a user-configurable HTTP vision provider, and the model-facing
recognition consumer (tool + skill + deterministic image-task injection). The
opt-in bundle composes them for a profile.

| Package | Role |
|---|---|
| [`image-recognition/`](image-recognition/README.md) | Service Definition: `ctx.imageRecognition` provider registry + selection + `ImageRecognitionError` |
| [`image-recognition-http/`](image-recognition-http/README.md) | Provider: user-configured OpenAI-compatible chat-completions vision endpoint |
| [`tool-image-recognition/`](tool-image-recognition/README.md) | Consumer: `recognize_image` tool, `image-recognition` skill, deterministic image-task injection |
| [`../bundle/image-recognition`](../bundle/image-recognition/README.md) | Opt-in bundle mounting the seam, provider, and consumer |

A capability seam keeps Service Definition / Provider / Consumer roles separate
([capability seams](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md));
the opt-in bundle is how a deployment turns image recognition on per profile.
