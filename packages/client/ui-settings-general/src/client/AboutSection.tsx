/**
 * The About section: PineSound company introduction and a software-update check.
 *
 * The update check is a client-side placeholder: it compares the build version
 * against a fixed known-latest constant and reports up-to-date, pending a real
 * update channel. The two constants are product metadata, not tunables.
 */

import { useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './AboutSection.module.css'

/** This build's version, mirrored from apps/desktop/package.json. */
const APP_VERSION = '0.1.0-rc.5'

/** Latest version known to this build; the update check compares against it. */
const LATEST_VERSION = APP_VERSION

type UpdateStatus = 'idle' | 'checking' | 'upToDate'

/** Full component props for the About section. */
export type AboutSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsLocale<'settings'>

/**
 * Render the About section: company copy and a check-updates control.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the About section element tree.
 */
export function AboutSection({ t }: AboutSectionComponentProps) {
  const [status, setStatus] = useState<UpdateStatus>('idle')
  const checking = status === 'checking'
  const check = (): void => {
    if (checking) return
    setStatus('checking')
    window.setTimeout(() => { setStatus('upToDate') }, 600)
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
        {status === 'upToDate' && !checking
          ? <p className={css.status} role="status">{t('about.upToDate')} · v{LATEST_VERSION}</p>
          : null}
      </div>
    </div>
  )
}
