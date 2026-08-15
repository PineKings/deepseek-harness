import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type {
  InstallResult, InstallSpec, InstalledBundlesSnapshot, PluginInventorySnapshot,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button,
  IconChevronDownOutline14,
  IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './PluginInventorySettingsTab.module.css'

/** Registration-side Remote face used by the section. */
export interface PluginInventorySettingsTabInjected {
  /** Read a current Host inventory snapshot. */
  list: () => Promise<PluginInventorySnapshot>
  /** Toggle one plugin entry on or off; persists across a restart. */
  setEnabled: (entryId: PluginInventoryEntry['entryId'], enabled: boolean) => Promise<void>
  /** Install a registry plugin by package name; the host persists the change. */
  installPlugin: (spec: InstallSpec) => Promise<InstallResult>
  /** List the profile's user-installed plugin dependencies (uninstallable ones). */
  installedBundles: () => Promise<InstalledBundlesSnapshot>
  /** Uninstall a user-installed plugin; the host persists the change. */
  uninstall: (name: string) => Promise<InstallResult>
}

type PluginInventoryEntry = PluginInventorySnapshot['entries'][number]
type PluginFiberPhase = PluginInventoryEntry['fiberPhase']

/** Full component props assembled by the Settings slot renderer. */
export type PluginInventorySettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<PluginInventorySettingsTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: PluginInventorySnapshot }

const PHASE_KEYS = {
  pending: 'pending',
  loading: 'loadingPhase',
  active: 'active',
  failed: 'failed',
  unloading: 'unloading',
} satisfies Record<Exclude<PluginFiberPhase, null>, PluginInventoryLocaleKey>

/** Localized accessible label for one root Fiber phase. */
function phaseLabel(
  phase: PluginFiberPhase,
  t: PluginInventorySettingsTabProps['t'],
): string {
  return phase === null ? t('unobserved') : t(PHASE_KEYS[phase])
}

/** Compact a module specifier without guessing whether its Loader id was generated. */
function moduleShortName(moduleName: string): string {
  const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName
  return unscoped
    .replace(/^cordis:/, '')
    .replace(/^cordis-plugin-/, '')
    .replace(/^dsh-(?:host-|client-)?/, '')
}

/** Whether an inventory row matches the local catalog query. */
function matches(entry: PluginInventoryEntry, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true
  return [entry.moduleName, entry.entryId]
    .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
}

/** Render the current Loader inventory with per-plugin enable/disable and install. */
export function PluginInventorySettingsTab({
  list, setEnabled, installPlugin, installedBundles, uninstall, t,
}: PluginInventorySettingsTabProps): ReactNode {
  const catalogId = useId()
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<PluginInventoryEntry['entryId'] | null>(null)
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [busy, setBusy] = useState<PluginInventoryEntry['entryId'] | null>(null)
  const [spec, setSpec] = useState('')
  const [installBusy, setInstallBusy] = useState(false)
  const [installNote, setInstallNote] = useState<{ kind: 'restart' | 'error'; text: string } | null>(null)
  const [pendingConsent, setPendingConsent] = useState<{ spec: string; builds: readonly string[] } | null>(null)
  const [consentChecked, setConsentChecked] = useState<readonly string[]>([])
  const [installed, setInstalled] = useState<InstalledBundlesSnapshot['installed']>([])
  const [uninstallBusy, setUninstallBusy] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => list()).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    // The installed-dependency list is secondary; a failure to load it only
    // hides the uninstall section, never the inventory.
    void Promise.resolve().then(() => installedBundles()).then(
      (snapshot) => { if (current) setInstalled(snapshot.installed) },
      () => {},
    )
    return () => { current = false }
  }, [list, installedBundles, request])

  /** Toggle one entry then re-read the inventory. */
  const toggle = (entryId: PluginInventoryEntry['entryId'], enabled: boolean): void => {
    if (busy !== null) return
    setBusy(entryId)
    void setEnabled(entryId, enabled).then(
      () => { setRequest(value => value + 1) },
      () => { /* the next list reflects the unchanged state */ },
    ).finally(() => { setBusy(null) })
  }

  /** Record a successful install: show the restart/active note, clear, re-list. */
  const installSettled = (result: InstallResult): void => {
    // A live recompose activates the plugin immediately; only fall back to a
    // restart notice when no reload handle exists.
    setInstallNote({ kind: 'restart', text: t(result.restartRequired ? 'restartRequired' : 'installed') })
    setSpec('')
    setRequest(value => value + 1)
  }

  /**
   * Install a plugin by spec, then re-read. A result carrying `pendingBuilds`
   * pauses for the user's per-package build consent instead of settling.
   */
  const installRegistry = (): void => {
    const trimmed = spec.trim()
    if (trimmed.length === 0 || installBusy) return
    setInstallBusy(true)
    setInstallNote(null)
    void installPlugin({ type: 'registry', spec: trimmed }).then(
      (result) => {
        if (result.pendingBuilds !== undefined && result.pendingBuilds.length > 0) {
          // Keep the spec in the field; the modal re-submits it on consent.
          setPendingConsent({ spec: trimmed, builds: result.pendingBuilds })
          setConsentChecked(result.pendingBuilds)
          return
        }
        installSettled(result)
      },
      (error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error)
        setInstallNote({ kind: 'error', text: `${t('installFailed')}: ${detail}` })
      },
    ).finally(() => { setInstallBusy(false) })
  }

  /** Re-submit the paused install with the exact packages the user approved. */
  const confirmConsent = (): void => {
    if (pendingConsent === null || installBusy || consentChecked.length === 0) return
    const { spec: consentedSpec } = pendingConsent
    const approved = [...consentChecked]
    setInstallBusy(true)
    setInstallNote(null)
    void installPlugin({ type: 'registry', spec: consentedSpec, consentBuilds: approved }).then(
      (result) => {
        setPendingConsent(null)
        setConsentChecked([])
        if (result.pendingBuilds !== undefined && result.pendingBuilds.length > 0) {
          setPendingConsent({ spec: consentedSpec, builds: result.pendingBuilds })
          setConsentChecked(result.pendingBuilds)
          return
        }
        installSettled(result)
      },
      (error: unknown) => {
        setPendingConsent(null)
        setConsentChecked([])
        const detail = error instanceof Error ? error.message : String(error)
        setInstallNote({ kind: 'error', text: `${t('installFailed')}: ${detail}` })
      },
    ).finally(() => { setInstallBusy(false) })
  }

  /** Dismiss the consent prompt without installing. */
  const cancelConsent = (): void => {
    if (installBusy) return
    setPendingConsent(null)
    setConsentChecked([])
  }

  /** Uninstall a user-installed plugin dependency, then re-read. */
  const removeInstalled = (name: string): void => {
    if (uninstallBusy !== null) return
    setUninstallBusy(name)
    setInstallNote(null)
    void uninstall(name).then(
      (result) => {
        setInstallNote({ kind: 'restart', text: t(result.restartRequired ? 'restartRequired' : 'uninstalled') })
        setRequest(value => value + 1)
      },
      (error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error)
        setInstallNote({ kind: 'error', text: `${t('uninstallFailed')}: ${detail}` })
      },
    ).finally(() => { setUninstallBusy(null) })
  }

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredEntries = useMemo(
    () => state.status === 'ready'
      ? state.snapshot.entries.filter(entry => matches(entry, normalizedQuery))
      : [],
    [normalizedQuery, state],
  )
  // One flat list carries every plugin: each shows its real state with an
  // enable or disable button, while a required plugin shows only the required
  // note (it cannot be toggled).

  useEffect(() => {
    if (expanded !== null && !filteredEntries.some(entry => entry.entryId === expanded)) {
      setExpanded(null)
    }
  }, [expanded, filteredEntries])

  const retry = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  /** Render one inventory card; the toggle is hidden for protected system plugins. */
  const card = (entry: PluginInventoryEntry): ReactNode => {
    const status = phaseLabel(entry.fiberPhase, t)
    const title = moduleShortName(entry.moduleName)
    const configuration = t(entry.enabled ? 'enabledTag' : 'disabledTag')
    const open = expanded === entry.entryId
    const detailId = `${catalogId}-details-${encodeURIComponent(entry.entryId)}`
    return (
      <li
        className={css.card}
        key={entry.entryId}
        data-plugin-entry={entry.entryId}
        data-open={open ? 'true' : undefined}
      >
        <button
          className={css.cardContent}
          type="button"
          aria-expanded={open}
          aria-controls={detailId}
          aria-label={entry.enabled ? `${title}, ${status}, ${configuration}` : `${title}, ${configuration}`}
          onClick={() => {
            setExpanded(current => current === entry.entryId ? null : entry.entryId)
          }}
        >
          <strong className={css.cardTitle} title={entry.moduleName}>{title}</strong>
          <span className={css.cardTrailing}>
            {entry.enabled ? (
              <span
                className={css.statusDot}
                data-phase={entry.fiberPhase ?? 'unobserved'}
                role="img"
                aria-label={status}
                title={status}
              />
            ) : null}
            <span className={css.configTag} data-enabled={entry.enabled ? 'true' : 'false'}>
              {configuration}
            </span>
            <IconChevronDownOutline14 className={css.chevron} size={12} aria-hidden="true" />
          </span>
        </button>
        {open ? (
          <div className={css.cardDetails} id={detailId}>
            <code className={css.entryValue} data-loader-entry>{entry.entryId}</code>
            <dl className={css.details}>
              <div>
                <dt>{t('configuration')}</dt>
                <dd>{configuration}</dd>
              </div>
              {entry.enabled ? (
                <div>
                  <dt>{t('cordis')}</dt>
                  <dd>{status}</dd>
                </div>
              ) : null}
            </dl>
            {!entry.enabled ? (
              <Button
                className={css.toggle}
                variant="outline"
                size="sm"
                disabled={busy === entry.entryId}
                aria-busy={busy === entry.entryId || undefined}
                onClick={() => { toggle(entry.entryId, true) }}
              >
                {busy === entry.entryId ? t('toggling') : t('enable')}
              </Button>
            ) : entry.protected ? (
              <p className={css.required}>{t('required')}</p>
            ) : (
              <Button
                className={css.toggle}
                variant="outline"
                size="sm"
                disabled={busy === entry.entryId}
                aria-busy={busy === entry.entryId || undefined}
                onClick={() => { toggle(entry.entryId, false) }}
              >
                {busy === entry.entryId ? t('toggling') : t('disable')}
              </Button>
            )}
          </div>
        ) : null}
      </li>
    )
  }

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={retry}>{t('retry')}</button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <>
          <section className={css.install} aria-label={t('installPlugin')}>
            <h3>{t('installPlugin')}</h3>
            <div className={css.installRow}>
              <input
                type="text"
                className={css.installInput}
                value={spec}
                placeholder={t('installSpec')}
                aria-label={t('installSpec')}
                onChange={(event) => { setSpec(event.currentTarget.value) }}
                onKeyDown={(event) => { if (event.key === 'Enter') installRegistry() }}
              />
              <Button
                className={css.installAction}
                variant="primary"
                disabled={installBusy || spec.trim().length === 0}
                onClick={installRegistry}
              >
                {installBusy ? t('installing') : t('install')}
              </Button>
            </div>
            {installNote !== null
              ? <p className={installNote.kind === 'error' ? css.installError : css.installRestart} role="status">{installNote.text}</p>
              : null}
          </section>
          {installed.length > 0 ? (
            <section className={css.installed} aria-label={t('installedPlugins')}>
              <h3>{t('installedPlugins')}</h3>
              <ul className={css.installedList}>
                {installed.map(({ name }) => (
                  <li className={css.installedRow} key={name}>
                    <code className={css.installedName}>{name}</code>
                    <Button
                      className={css.installedAction}
                      variant="outline"
                      size="sm"
                      disabled={uninstallBusy !== null}
                      aria-busy={uninstallBusy === name || undefined}
                      onClick={() => { removeInstalled(name) }}
                    >
                      {uninstallBusy === name ? t('uninstalling') : t('uninstall')}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <div className={css.catalog}>
            <label className={css.search}>
              <IconSearchOutline16 aria-hidden="true" />
              <span className={css.visuallyHidden}>{t('search')}</span>
              <input
                type="search"
                value={query}
                placeholder={t('search')}
                aria-label={t('search')}
                onChange={(event) => { setQuery(event.currentTarget.value) }}
              />
            </label>
            <div className={css.catalogHeading}>
              <h3>{t('catalog')}</h3>
              <span data-plugin-count={filteredEntries.length}>{filteredEntries.length}</span>
            </div>
            {state.snapshot.entries.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
            {state.snapshot.entries.length > 0 && filteredEntries.length === 0
              ? <p className={css.status}>{t('emptySearch')}</p>
              : null}
            {filteredEntries.length > 0 ? (
              <ul className={css.cards}>
                {filteredEntries.map(card)}
              </ul>
            ) : null}
          </div>
        </>
      ) : null}
      {pendingConsent !== null ? (
        <div
          className={css.overlay}
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) cancelConsent() }}
        >
          <div className={css.consent} role="dialog" aria-modal="true" aria-labelledby={`${catalogId}-consent-title`}>
            <h3 id={`${catalogId}-consent-title`}>{t('consentTitle')}</h3>
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
              <Button
                className={css.consentAction}
                variant="outline"
                disabled={installBusy}
                onClick={cancelConsent}
              >
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
