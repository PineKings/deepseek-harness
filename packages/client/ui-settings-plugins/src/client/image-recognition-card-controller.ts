/**
 * The image-recognition card's staged form over the `image-recognition-http`
 * settings namespace.
 *
 * The key is the one control that does not live in the section: its literal
 * never rides a response, so the card learns only whether one is configured
 * and writes it through the credentials domain, addressed by the reference the
 * section names. It is still staged with the rest of the form, so one save
 * covers everything the card shows.
 */

import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsScope, SettingsScopeSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  CardForm, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/**
 * Namespace of the HTTP image-recognition provider. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
export const IMAGE_RECOGNITION_NS = 'image-recognition-http'

/** Credential reference the provider resolves when the section names none. */
const DEFAULT_API_KEY_REF = 'IMAGE_RECOGNITION_API_KEY'

/**
 * The main chat model's credential references. Image recognition must never
 * resolve through these, or saving its key would overwrite the model's (and vice
 * versa). A stale section that declares one of them is treated as unset.
 */
const MODEL_API_KEY_REFS = new Set(['DEEPSEEK_API_KEY', 'DEEPSEEK_OFFICIAL_API_KEY'])

/** Form field the credential control stages under. */
const API_KEY_FIELD = 'apiKey'

/** The provider fields this card edits. */
export interface ImageRecognitionSettings {
  /** Credential reference naming the environment key. */
  apiKeyEnv?: string
  /** Provider endpoint; blank inherits the provider default. */
  baseURL?: string
  /** Vision model name; blank inherits the provider default. */
  model?: string
}

/** What the credentials domain last reported, and for which reference. */
interface CredentialState {
  /** Reference this answer describes; a stale response for another one is dropped. */
  ref: string
  /** Whether any layer supplies a value for it. */
  configured: boolean
  /** Whether `credentials.set` can affect it; false disables the control. */
  writable: boolean
}

/** What the image-recognition card renders. */
export interface ImageRecognitionCardState extends CardShell {
  /** Provider endpoint. */
  baseURL: CardFieldState
  /** Vision model name. */
  model: CardFieldState
  /** The staged credential, which starts blank on every load. */
  apiKey: CardFieldState
  /** Whether the Host reports a credential configured for the referenced key. */
  apiKeyConfigured: boolean
  /** Whether the credentials domain accepts a write for it; false disables the control. */
  apiKeyWritable: boolean
}

/** The registration-side face the image-recognition card's slot entry injects. */
export interface ImageRecognitionCardFace extends CardActions {
  /** Delete the configured image-recognition credential, leaving the section empty. */
  clearApiKey: () => void
  hooks: {
    /** Card snapshot bound by the renderer as useImageRecognitionCard. */
    imageRecognitionCard: SnapshotStore<ImageRecognitionCardState>
  }
}

/** Bridges the `image-recognition-http` scope and the credentials domain onto the card. */
export class ImageRecognitionCardController {
  private readonly form: CardForm<ImageRecognitionSettings>
  private readonly store: SnapshotStore<ImageRecognitionCardState>
  private credential: CredentialState = { ref: '', configured: false, writable: true }

  /**
   * @param scope - the bound settings scope for the `image-recognition-http` namespace.
   * @param api - wire face used for the credential the section references.
   */
  constructor(
    private readonly scope: SettingsScope<ImageRecognitionSettings>,
    private readonly api: Pick<IApiClient, 'credentials'>,
  ) {
    this.form = new CardForm(
      scope,
      [textField('baseURL'), textField('model')],
      [{ field: API_KEY_FIELD, write: text => this.writeKey(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    scope.subscribe(() => { void this.readCredential() })
    void this.readCredential()
  }

  private projection(): ImageRecognitionCardState {
    return {
      ...this.form.shell(),
      baseURL: this.form.field('baseURL'),
      model: this.form.field('model'),
      apiKey: this.form.field(API_KEY_FIELD),
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
    }
  }

  /** Ask the credentials domain about the reference the section currently names. */
  private async readCredential(): Promise<void> {
    const ref = refOf(this.scope.getSnapshot())
    if (ref !== this.credential.ref) {
      this.credential = { ref, configured: false, writable: true }
      this.store.set(this.projection())
    }
    let response: Awaited<ReturnType<IApiClient['credentials']['describe']>>
    try {
      response = await this.api.credentials.describe({ refs: [ref] })
    } catch (_credentialReadFailure) {
      return
    }
    if (!response.result.ok || ref !== refOf(this.scope.getSnapshot())) return
    const view = response.result.value.credentials[ref]
    const next: CredentialState = {
      ref,
      configured: view?.configured ?? false,
      writable: view?.writable ?? true,
    }
    if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
    this.credential = next
    this.store.set(this.projection())
  }

  /** Re-read after the Host reports a change to the reference this card watches. */
  refreshCredential(ref: string): void {
    if (ref !== this.credential.ref) return
    void this.readCredential()
  }

  /** Build the face the card's slot registration injects. */
  inject(): ImageRecognitionCardFace {
    return {
      hooks: { imageRecognitionCard: this.store },
      clearApiKey: () => { void this.clearKey() },
      ...this.form.actions(),
    }
  }

  /** Write the staged key, then re-read whether the Host now holds one. */
  private async writeKey(value: string): Promise<boolean> {
    try {
      await this.api.credentials.set({ ref: refOf(this.scope.getSnapshot()), value })
    } catch (_credentialWriteFailure) {
      // Refusals surface through the re-read below.
    }
    await this.readCredential()
    return this.credential.configured
  }

  /** Delete the referenced credential, leaving the section empty (no vision model used). */
  private async clearKey(): Promise<void> {
    try {
      await this.api.credentials.unset({ ref: refOf(this.scope.getSnapshot()) })
    } catch (_credentialUnsetFailure) {
      // Refusals surface through the re-read below.
    }
    await this.readCredential()
  }
}

/** The credential reference the section names, or the provider's default. */
function refOf(snapshot: SettingsScopeSnapshot<ImageRecognitionSettings>): string {
  const declared = snapshot.value?.apiKeyEnv
  // A declared model ref would conflate this card with the chat model; ignore it.
  if (declared === undefined || declared.length === 0 || MODEL_API_KEY_REFS.has(declared)) return DEFAULT_API_KEY_REF
  return declared
}
