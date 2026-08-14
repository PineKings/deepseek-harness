/**
 * The image-recognition provider's card: its endpoint and the key — which is
 * written through the credentials domain, never into the settings section, so
 * the literal never rides a response.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SecretField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { ImageRecognitionCardFace } from './image-recognition-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the image-recognition card. */
export type ImageRecognitionCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<ImageRecognitionCardFace>

/**
 * Render the image-recognition card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function ImageRecognitionCard(props: ImageRecognitionCardProps) {
  const { t } = props
  const state = props.useImageRecognitionCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="imageRecognitionTitle"
      descriptionKey="imageRecognitionDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SecretField
        id="plugin-config-image-recognition-key"
        label={t('imageRecognitionApiKey')}
        hint={t('imageRecognitionApiKeyHint')}
        disabled={!state.apiKeyWritable}
        text={state.apiKey.text}
        configured={state.apiKeyConfigured}
        stateLabel={state.apiKeyConfigured ? t('imageRecognitionApiKeySet') : t('imageRecognitionApiKeyUnset')}
        clearLabel={t('imageRecognitionClearKey')}
        onClear={props.clearApiKey}
        onEdit={(text) => { props.edit('apiKey', text) }}
      />
      <ValueField
        id="plugin-config-image-recognition-endpoint"
        label={t('imageRecognitionBaseUrl')}
        hint={t('imageRecognitionBaseUrlHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.baseURL}
        onEdit={(text) => { props.edit('baseURL', text) }}
        onReset={() => { props.resetField('baseURL') }}
      />
      <ValueField
        id="plugin-config-image-recognition-model"
        label={t('imageRecognitionModel')}
        hint={t('imageRecognitionModelHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.model}
        onEdit={(text) => { props.edit('model', text) }}
        onReset={() => { props.resetField('model') }}
      />
    </PluginCard>
  )
}
