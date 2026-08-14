# Agent Note: Image-recognition capability (opt-in bundle)

Status: implemented

English | [中文](2026-08-14-image-recognition-capability.zh.md)

## Problem

The harness had no way to recognize image contents as a first-class step of a
task. A multimodal model can `read_image`, but nothing detects an image task and
routes it through a user-configured recognition provider first. The user wanted
an image-capability plugin, modeled on the web-search provider: fill in a
provider address + API key in the settings page, and have the model recognize an
image before continuing.

## Decision

Add a complete capability seam over four new packages under `packages/vision/`,
mirroring the web-search three-role shape (Service Definition / Provider /
Consumer), plus an opt-in bundle:

- **Service Definition** `@deepseek-ai/dsh-image-recognition`: `ctx.imageRecognition`
  provider registry + provider-selecting `recognize()` (mirrors `ctx.web`):
  duplicate ids rejected, order-independent selection,
  `ImageRecognitionError` taxonomy.
- **Provider** `@deepseek-ai/dsh-image-recognition-http`: a user-configurable
  OpenAI-compatible chat-completions vision provider. `baseURL` + `model` live in
  a live settings section; the key rides the credentials domain via a
  credential-ref. Logs the secret-free vision request as the
  `image-recognition/llm-request` session event.
- **Consumer** `@deepseek-ai/dsh-tool-image-recognition`: registers a
  `recognize_image` tool and a bundled `image-recognition` skill, and hooks
  `agent/pre-step` to **deterministically inject** the skill body when a step
  input carries an image (an image content block or an image file path/URL), so
  the model recognizes the image before other actions.
- **Bundle** `@deepseek-ai/dsh-image-recognition-bundle`: mounts the three above;
  **opt-in** — it is not in any default profile's bundles list.
- **Settings card**: an `image-recognition` card in the Plugins settings page
  (endpoint + key), cloned from the web-search card.

The mechanism is deterministic-injection-plus-model-driven-execution: the
pre-step injection guarantees the skill instructions are present, while the model
still drives the actual `recognize_image` call (consistent with every existing
plugin — the model is the final decider of tool use).

## Enabling

A user opts in per profile by adding `@deepseek-ai/dsh-image-recognition-bundle`
to the profile's `dsh.profile.bundles` (or `dsh plugin --profile <name> add
...`), then configures the endpoint and key in the Plugins settings page.

## Verification

- `packages/vision/*` unit tests: SD selection semantics, provider HTTP
  error/abort mapping, and the image-signal detection function.
- Full host program typechecks.
- Real use: opt in the bundle, attach an image, confirm `recognize_image` runs
  and the task continues from its result.

## Alternatives considered

- **Built-in multimodal `read_image` as the mechanism.** Rejected: the user
  wanted a configurable provider (address + key) surfaced in the settings page,
  modeled on web-search, not a fixed multimodal path.
- **Prompt-guidance only (register the skill, let the model self-route).**
  Rejected: the user asked for a deterministic guarantee that the model
  recognizes an image first; the pre-step injection delivers that while the model
  still drives the actual tool call.

## Consequences

- **Costs:** a new capability seam of four packages plus a client card; the
  opt-in bundle needs a configured provider before it works; image-task path/URL
  detection is heuristic and can be disabled.
- **Buys:** recognition becomes a first-class step with a provider the user
  controls, the harness follows the capability-seam and
  deterministic-injection-plus-model-driven-execution patterns, and the feature
  is opt-in per profile (no default-behavior change).
