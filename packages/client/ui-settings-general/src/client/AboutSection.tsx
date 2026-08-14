/**
 * The About section: PineSound company introduction and a software-update check.
 *
 * The "check for updates" button asks the desktop main process (via the preload
 * bridge) for the latest release and shows a download link when one is newer;
 * on a plain-web surface without the bridge it reports up-to-date.
 */

import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './AboutSection.module.css'

/**
 * Plain-web fallback for the current version when the desktop bridge is absent:
 * there is no packaged identity to report, so the version row shows this rather
 * than a stale hardcoded value. On the desktop the real version comes from
 * `getAppInfo` (`app.getVersion()`).
 */
const FALLBACK_VERSION = '—'

/** The update-check bridge the desktop preload injects (absent on plain web). */
interface DshAppBridge {
  checkUpdate: () => Promise<{
    readonly status: 'up-to-date' | 'update-available' | 'error'
    readonly current: string
    readonly latest?: string | undefined
    readonly date?: string | undefined
    readonly notes?: string | undefined
    readonly url?: string | undefined
  }>
  getAppInfo: () => Promise<{ readonly version: string }>
}

type UpdateState =
  | { readonly status: 'idle' }
  | { readonly status: 'checking' }
  | { readonly status: 'up-to-date' }
  | { readonly status: 'available'; readonly latest: string; readonly date?: string | undefined; readonly notes?: string | undefined; readonly url?: string | undefined }
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
  const [version, setVersion] = useState<string>(FALLBACK_VERSION)
  const checking = state.status === 'checking'
  // Read this build's real version from the desktop main process; plain web has
  // no packaged identity, so it keeps the fallback.
  useEffect(() => {
    const bridge = (window as { dshApp?: DshAppBridge }).dshApp
    if (bridge === undefined) return
    void bridge.getAppInfo().then((info) => { setVersion(info.version) }, () => {})
  }, [])
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
          setState({ status: 'available', latest: result.latest ?? '', date: result.date, notes: result.notes, url: result.url })
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
          <dd data-version>{version}</dd>
        </dl>
        <Button
          className={css.check}
          variant="primary"
          disabled={checking}
          aria-busy={checking || undefined}
          onClick={check}
        >
          {checking ? t('about.checking') : t('about.checkUpdates')}
        </Button>
        {state.status === 'up-to-date' && !checking
          ? <p className={css.status} role="status">{t('about.upToDate')} · v{version}</p>
          : null}
        {state.status === 'available'
          ? (
            <p className={css.status} role="status">
              {t('about.updateAvailable')} · v{state.latest}
              {state.date === undefined || state.date.length === 0 ? '' : ` (${state.date})`}
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
        <div className={css.links}>
          <a className={css.link} href="https://deepseek.pinesound.cn/" target="_blank" rel="noreferrer">{t('about.releaseSite')}</a>
          <a className={css.link} href="https://www.deepseek.com/" target="_blank" rel="noreferrer">{t('about.officialSite')}</a>
        </div>
      </div>
    </div>
  )
}
