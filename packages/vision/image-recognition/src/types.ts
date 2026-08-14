/**
 * Vocabulary for the image-recognition capability seam (`ctx.imageRecognition`).
 * A provider recognizes image content through a user-configured endpoint and
 * returns text the model can continue a task with. The request carries the image
 * to inspect; the result is recognized text. Mirrors the web seam so provider
 * selection, cancellation, errors, and configuration share one owner.
 * @module @deepseek-ai/dsh-image-recognition/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * The image a recognition provider should inspect. A CLOSED discriminated union:
 * the provider encodes the kind; consumers pass the source they hold. A new kind
 * is a coordinated change across the seam, not a plugin extension.
 */
export type ImageInput =
  | { readonly kind: 'file-path'; readonly filePath: string }
  | { readonly kind: 'base64'; readonly base64: string; readonly mediaType: string }
  | { readonly kind: 'url'; readonly url: string }

/**
 * What one recognition-capable backend is asked to do. `prompt` is an optional
 * instruction for what to recognize (e.g. "transcribe the text"); omitted, the
 * provider returns a general description. Cancellation is a direct execution
 * argument, not a request field.
 */
export interface ImageRecognitionRequest {
  /** The image to recognize. */
  readonly image: ImageInput
  /** Optional recognition focus; absent = general description. */
  readonly prompt?: string
}

/** Normalized recognition outcome: the recognized text. */
export interface ImageRecognitionResult {
  /** Recognized or described content the model can act on. */
  readonly text: string
}

/**
 * A recognition-capable backend. Registered with `ctx.imageRecognition`.
 * `id` is a stable string, unique within the capability kind.
 */
export interface ImageRecognitionProvider {
  /** Stable unique id used as the registry key and selection pin. */
  readonly id: string
  /** Cheap local usability check; must not make network calls. */
  available(): boolean
  /** Recognize one image; honor `signal` for cancellation. */
  recognize(request: ImageRecognitionRequest, signal?: AbortSignal): Promise<ImageRecognitionResult>
}

/**
 * Typed image-recognition error with a machine-routable, open-string `code` and
 * chained `cause`. Consumers must tolerate provider-specific codes. Shared codes
 * cover unavailable, missing, unusable, ambiguous, or duplicate providers,
 * cancellation, and provider failure.
 */
export class ImageRecognitionError extends HarnessError {}
