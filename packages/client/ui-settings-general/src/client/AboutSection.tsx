/**
 * The About section: PineSound company introduction and a software-update check.
 *
 * The "check for updates" button asks the desktop main process (via the preload
 * bridge) for the latest release and shows a download link when one is newer;
 * on a plain-web surface without the bridge it reports up-to-date.
 */

import { useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './AboutSection.module.css'

/** This build's version, mirrored from apps/desktop/package.json. */
const APP_VERSION = '0.1.0-rc.5'

/** The update-check bridge the desktop preload injects (absent on plain web). */
interface DshAppBridge {
  checkUpdate: () => Promise<{
    readonly status: 'up-to-date' | 'update-available' | 'error'
    readonly current: string
    readonly latest?: string | undefined
    readonly notes?: string | undefined
    readonly url?: string | undefined
  }>
}

type UpdateState =
  | { readonly status: 'idle' }
  | { readonly status: 'checking' }
  | { readonly status: 'up-to-date' }
  | { readonly status: 'available'; readonly latest: string; readonly notes?: string | undefined; readonly url?: string | undefined }
  | { readonly status: 'error'; readonly detail?: string | undefined }

/** Full component props for the About section. */
export type AboutSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsLocale<'settings'>

/**
 * Render the About section: company copy and a check-updates control.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the About section element tree.
 */
export function AboutSection({ t }: AboutSectionComponentProps) {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  const checking = state.status === 'checking'
  const check = (): void => {
    if (checking) return
    const bridge = (window as { dshApp?: DshAppBridge }).dshApp
    if (bridge === undefined) {
      // No desktop bridge (plain web): nothing newer is known here.
      setState({ status: 'up-to-date' })
      return
    }
    setState({ status: 'checking' })
    void bridge.checkUpdate().then(
      (result) => {
        if (result.status === 'update-available') {
          setState({ status: 'available', latest: result.latest ?? '', notes: result.notes, url: result.url })
        } else if (result.status === 'up-to-date') {
          setState({ status: 'up-to-date' })
        } else {
          setState({ status: 'error', detail: result.notes })
        }
      },
      () => { setState({ status: 'error' }) },
    )
  }
  return (
    <div className={css.section}>
      <div className={css.company}>
        <h3 className={css.companyName}>{t('about.companyName')}</h3>
        <p className={css.tagline}>{t('about.companyTagline')}</p>
        <p className={css.intro}>{t('about.companyIntro')}</p>
      </div>
      <div className={css.product}>
        <p className={css.productName}>{t('about.product')}</p>
        <dl className={css.version}>
          <dt>{t('about.currentVersion')}</dt>
          <dd data-version>{APP_VERSION}</dd>
        </dl>
        <button
          type="button"
          className={css.check}
          disabled={checking}
          aria-busy={checking || undefined}
          onClick={check}
        >
          {checking ? t('about.checking') : t('about.checkUpdates')}
        </button>
        {state.status === 'up-to-date' && !checking
          ? <p className={css.status} role="status">{t('about.upToDate')} · v{APP_VERSION}</p>
          : null}
        {state.status === 'available'
          ? (
            <p className={css.status} role="status">
              {t('about.updateAvailable')} · v{state.latest}
              {state.notes === undefined || state.notes.length === 0 ? '' : ` — ${state.notes}`}
            </p>
          )
          : null}
        {state.status === 'available' && state.url !== undefined
          ? <a className={css.download} href={state.url} target="_blank" rel="noreferrer">{t('about.download')}</a>
          : null}
        {state.status === 'error'
          ? <p className={css.status} role="status">{t('about.updateCheckFailed')}{state.detail === undefined || state.detail.length === 0 ? '' : `: ${state.detail}`}</p>
          : null}
      </div>
    </div>
  )
}
