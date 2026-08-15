import { useEffect, useId, useState, type ReactNode } from 'react'
import type {
  InstallResult, MarketplaceEntry, MarketplaceSnapshot,
} from '@deepseek-ai/dsh-api-remotes/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './PluginMarketplaceSettingsTab.module.css'

/** Registration-side Remote face used by the marketplace tab. */
export interface PluginMarketplaceSettingsTabInjected {
  /** Fetch the remote marketplace catalog with each entry's installed state. */
  marketplaceList: () => Promise<MarketplaceSnapshot>
  /** Install a marketplace plugin by id; may return pending build consent. */
  marketplaceInstall: (id: string, consentBuilds?: readonly string[]) => Promise<InstallResult>
  /** Uninstall a marketplace plugin by id; the host persists the change. */
  marketplaceUninstall: (id: string) => Promise<InstallResult>
}

/** Full component props assembled by the Settings slot renderer. */
export type PluginMarketplaceSettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<PluginMarketplaceSettingsTabInjected>

/**
 * The marketplace's combined order: recommended picks first, then the catalog's
 * `priority` (higher closer to the front), then id as a stable tie-break.
 * Sorting lives on the client so the wire order is never trusted for display.
 */
function compareMarketplace(a: MarketplaceEntry, b: MarketplaceEntry): number {
  if (a.recommended !== b.recommended) return a.recommended ? -1 : 1
  const priorityDelta = (b.priority ?? 0) - (a.priority ?? 0)
  if (priorityDelta !== 0) return priorityDelta
  return a.id.localeCompare(b.id)
}

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly entries: readonly MarketplaceEntry[] }

/** A pending build-consent prompt for one marketplace install. */
interface ConsentState {
  readonly id: string
  readonly builds: readonly string[]
}

/** Browse the remote marketplace and install/uninstall its plugins. */
export function PluginMarketplaceSettingsTab({
  marketplaceList, marketplaceInstall, marketplaceUninstall, t,
}: PluginMarketplaceSettingsTabProps): ReactNode {
  const consentId = useId()
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [busy, setBusy] = useState<string | null>(null)
  const [installBusy, setInstallBusy] = useState(false)
  const [note, setNote] = useState<{ kind: 'restart' | 'error'; text: string } | null>(null)
  const [pendingConsent, setPendingConsent] = useState<ConsentState | null>(null)
  const [consentChecked, setConsentChecked] = useState<readonly string[]>([])

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => marketplaceList()).then(
      (snapshot) => { if (current) setState({ status: 'ready', entries: snapshot.entries }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [marketplaceList, request])

  /** Re-fetch the marketplace after a load failure or an install/uninstall. */
  const refresh = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  /** Install a marketplace plugin by id, then re-read. */
  const install = (id: string): void => {
    if (busy !== null) return
    setBusy(id)
    setNote(null)
    void marketplaceInstall(id).then(
      (result) => {
        if (result.pendingBuilds !== undefined && result.pendingBuilds.length > 0) {
          setPendingConsent({ id, builds: result.pendingBuilds })
          setConsentChecked(result.pendingBuilds)
          return
        }
        setNote({ kind: 'restart', text: t(result.restartRequired ? 'restartRequired' : 'installed') })
        setRequest(value => value + 1)
      },
      (error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error)
        setNote({ kind: 'error', text: `${t('installFailed')}: ${detail}` })
      },
    ).finally(() => { setBusy(null) })
  }

  /** Uninstall a marketplace plugin by id, then re-read. */
  const uninstall = (id: string): void => {
    if (busy !== null) return
    setBusy(id)
    setNote(null)
    void marketplaceUninstall(id).then(
      (result) => {
        setNote({ kind: 'restart', text: t(result.restartRequired ? 'restartRequired' : 'uninstalled') })
        setRequest(value => value + 1)
      },
      (error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error)
        setNote({ kind: 'error', text: `${t('uninstallFailed')}: ${detail}` })
      },
    ).finally(() => { setBusy(null) })
  }

  /** Re-submit the paused install with the exact packages the user approved. */
  const confirmConsent = (): void => {
    if (pendingConsent === null || installBusy || consentChecked.length === 0) return
    const { id } = pendingConsent
    const approved = [...consentChecked]
    setInstallBusy(true)
    setNote(null)
    void marketplaceInstall(id, approved).then(
      (result) => {
        setPendingConsent(null)
        setConsentChecked([])
        if (result.pendingBuilds !== undefined && result.pendingBuilds.length > 0) {
          setPendingConsent({ id, builds: result.pendingBuilds })
          setConsentChecked(result.pendingBuilds)
          return
        }
        setNote({ kind: 'restart', text: t(result.restartRequired ? 'restartRequired' : 'installed') })
        setRequest(value => value + 1)
      },
      (error: unknown) => {
        setPendingConsent(null)
        setConsentChecked([])
        const detail = error instanceof Error ? error.message : String(error)
        setNote({ kind: 'error', text: `${t('installFailed')}: ${detail}` })
      },
    ).finally(() => { setInstallBusy(false) })
  }

  /** Dismiss the consent prompt without installing. */
  const cancelConsent = (): void => {
    if (installBusy) return
    setPendingConsent(null)
    setConsentChecked([])
  }

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      <div className={css.titleRow}>
        <h3 className={css.heading}>{t('marketplace')}</h3>
        <button
          className={css.refresh}
          type="button"
          aria-label={t('marketplaceRefresh')}
          disabled={state.status === 'loading'}
          onClick={refresh}
        >
          {state.status === 'loading' ? t('loading') : t('marketplaceRefresh')}
        </button>
      </div>
      {note !== null
        ? <p className={note.kind === 'error' ? css.error : css.restart} role="status">{note.text}</p>
        : null}
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('marketplaceLoadFailed')}</p>
          <button type="button" onClick={refresh}>{t('retry')}</button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        state.entries.length === 0
          ? <p className={css.status}>{t('marketplaceEmpty')}</p>
          : (
            <ul className={css.cards}>
              {[...state.entries].sort(compareMarketplace).map(entry => (
                <li className={css.card} key={entry.id}>
                  <div className={css.header}>
                    <strong className={css.name}>{entry.name}</strong>
                    {entry.recommended ? <span className={css.recommended}>{t('recommended')}</span> : null}
                  </div>
                  {entry.description ? <p className={css.desc}>{entry.description}</p> : null}
                  <div className={css.meta}>
                    {entry.author ? <span className={css.author}>{entry.author}</span> : null}
                    {entry.repository
                      ? <a className={css.repo} href={entry.repository} target="_blank" rel="noreferrer">
                        {t('marketplaceRepo')}
                      </a>
                      : null}
                  </div>
                  <div className={css.actions}>
                    {entry.installed ? <span className={css.installed}>{t('marketplaceInstalled')}</span> : null}
                    <Button
                      className={css.action}
                      variant={entry.installed ? 'outline' : 'primary'}
                      size="sm"
                      disabled={busy === entry.id}
                      aria-busy={busy === entry.id || undefined}
                      onClick={() => {
                        if (entry.installed) uninstall(entry.id)
                        else install(entry.id)
                      }}
                    >
                      {busy === entry.id
                        ? (entry.installed ? t('uninstalling') : t('installing'))
                        : (entry.installed ? t('uninstall') : t('install'))}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )
      ) : null}
      {pendingConsent !== null ? (
        <div
          className={css.overlay}
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) cancelConsent() }}
        >
          <div className={css.consent} role="dialog" aria-modal="true" aria-labelledby={`${consentId}-title`}>
            <h3 id={`${consentId}-title`}>{t('consentTitle')}</h3>
            <p className={css.consentBody}>{t('consentBody')}</p>
            <ul className={css.consentList}>
              {pendingConsent.builds.map(name => (
                <li key={name}>
                  <label>
                    <input
                      type="checkbox"
                      checked={consentChecked.includes(name)}
                      onChange={(event) => {
                        setConsentChecked(current => event.currentTarget.checked
                          ? [...current, name]
                          : current.filter(existing => existing !== name))
                      }}
                    />
                    <code>{name}</code>
                  </label>
                </li>
              ))}
            </ul>
            <div className={css.consentActions}>
              <Button className={css.consentAction} variant="outline" disabled={installBusy} onClick={cancelConsent}>
                {t('consentCancel')}
              </Button>
              <Button
                className={css.consentAction}
                variant="primary"
                disabled={installBusy || consentChecked.length === 0}
                onClick={confirmConsent}
              >
                {installBusy ? t('installing') : t('consentAllow')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
