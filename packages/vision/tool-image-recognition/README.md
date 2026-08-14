# @deepseek-ai/dsh-tool-image-recognition

Model-facing image-recognition consumer. Registers a bundled `image-recognition`
skill and a `recognize_image` tool, and hooks `agent/pre-step` to deterministically
inject the skill body when a step input carries an image, so the model recognizes
the image before continuing the task.

## Config

| Key | Type | Meaning |
|---|---|---|
| `detectImageBlocks` | boolean | Inject the skill body when a step input carries an image content block (default true). |
| `detectImagePaths` | boolean | Inject the skill body when a step input text names an image file path or URL (default true). |

Detection is a cheap signal (image content block or path/URL in text), never an
image-byte read. The injection guarantees the skill instructions are present; the
model still drives the actual `recognize_image` call.

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`recognize_image` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-image-recognition). The tool takes an `image` (file path, https URL, or data URL) and an optional `prompt` naming what to extract, and returns the recognized text from the configured provider.

#### Token effect

Fixed schema cost per request while the tool is visible.

#### KV Cache effect

Prefix-stable while the tool definition and visibility are unchanged.

### Skill body

#### What the model sees

The `image-recognition` skill appears in the session skill catalog and loads through the `skill` tool; its body instructs the model to recognize an image with `recognize_image` first and act on the recognized text as ground truth. The rendered body is:

##### Skill body template

```markdown
<skill_content name="image-recognition">
<skill_instructions>
When the task involves an image (an attached image, an image file path, or an image URL), FIRST recognize its content before continuing the task:
1. Determine which image the task refers to from the conversation (attachment, path, or URL).
2. Call `recognize_image` with that image and, when useful, a `prompt` naming what to extract.
3. Use the recognized text as ground truth to complete the original task.
Do not guess at image contents from a filename or description — run `recognize_image` and act on its result.
</skill_instructions>
</skill_content>
```

#### Token effect

The catalog entry costs one line; loading the skill body costs its full text once per load.

#### KV Cache effect

Prefix-stable until the skill body loads; the loaded body appends as a new suffix.

### Image-task injection

#### What the model sees

When a step input carries an image (an image content block, or a text block naming an image file path or URL — see Config), the plugin injects the `image-recognition` skill body as a plugin-sourced user message at the front of the step.

#### Token effect

One injected user message per image-bearing step while detection is on.

#### KV Cache effect

Injected messages append after the reusable prefix, forming a per-step suffix that resets when no image is present.

### System prompt section

#### What the model sees

A `tool:image-recognition` system-prompt section adds the guidance below:

##### System prompt guidance

```markdown
When a task involves an image, recognize it first with `recognize_image` before continuing; do not infer image contents from a filename or description.
```

#### Token effect

One fixed system-prompt sentence per request.

#### KV Cache effect

Prefix-stable while the guidance text is unchanged.

## Known Limitations and Deferred Work

- **Dormant until configured:** the image-task injection is gated on a usable
  provider, so without a configured endpoint the capability is inert and the
  model is not guided to recognition. Direct `recognize_image` calls then throw
  a clear `ImageRecognitionError`.
- Path/URL detection is heuristic and can be disabled; misdetections are possible.
- Requires a configured, available provider — see `dsh-image-recognition-http`.
