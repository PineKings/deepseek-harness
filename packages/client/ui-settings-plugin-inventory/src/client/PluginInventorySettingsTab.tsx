import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type {
  AvailableBundlesSnapshot,
  InstallResult,
  InstallSpec,
  PluginInventorySnapshot,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
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
  /** List the offline-installable optional bundles. */
  availableBundles: () => Promise<AvailableBundlesSnapshot>
  /** Install a bundle or registry plugin; the host persists the change. */
  install: (spec: InstallSpec) => Promise<InstallResult>
  /** Un-compose an offline optional bundle. */
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

type BundleState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly snapshot: AvailableBundlesSnapshot }
  | { readonly status: 'error' }

/** Render the current Loader inventory with per-plugin enable/disable and install. */
export function PluginInventorySettingsTab({
  list, setEnabled, availableBundles, install, uninstall, t,
}: PluginInventorySettingsTabProps): ReactNode {
  const catalogId = useId()
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<PluginInventoryEntry['entryId'] | null>(null)
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [busy, setBusy] = useState<PluginInventoryEntry['entryId'] | null>(null)
  const [bundles, setBundles] = useState<BundleState>({ status: 'loading' })
  const [installBusy, setInstallBusy] = useState<string | null>(null)
  const [installNote, setInstallNote] = useState<{ kind: 'restart' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => list()).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [list, request])

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => availableBundles()).then(
      (snapshot) => { if (current) setBundles({ status: 'ready', snapshot }) },
      () => { if (current) setBundles({ status: 'error' }) },
    )
    return () => { current = false }
  }, [availableBundles, request])

  /** Toggle one entry then re-read the inventory. */
  const toggle = (entryId: PluginInventoryEntry['entryId'], enabled: boolean): void => {
    if (busy !== null) return
    setBusy(entryId)
    void setEnabled(entryId, enabled).then(
      () => { setRequest(value => value + 1) },
      () => { /* the next list reflects the unchanged state */ },
    ).finally(() => { setBusy(null) })
  }

  /** Install or uninstall an optional bundle, then re-read the catalog. */
  const mutateBundle = (name: string, mode: 'install' | 'uninstall'): void => {
    if (installBusy !== null) return
    setInstallBusy(name)
    setInstallNote(null)
    const action = mode === 'install'
      ? install({ type: 'bundle', name })
      : uninstall(name)
    void action.then(
      () => {
        setInstallNote({ kind: 'restart', text: t('restartRequired') })
        setRequest(value => value + 1)
      },
      () => { setInstallNote({ kind: 'error', text: t('installFailed') }) },
    ).finally(() => { setInstallBusy(null) })
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
              <button
                className={css.toggle}
                type="button"
                disabled={busy === entry.entryId}
                aria-busy={busy === entry.entryId || undefined}
                onClick={() => { toggle(entry.entryId, true) }}
              >
                {busy === entry.entryId ? t('toggling') : t('enable')}
              </button>
            ) : entry.protected ? (
              <p className={css.required}>{t('required')}</p>
            ) : (
              <button
                className={css.toggle}
                type="button"
                disabled={busy === entry.entryId}
                aria-busy={busy === entry.entryId || undefined}
                onClick={() => { toggle(entry.entryId, false) }}
              >
                {busy === entry.entryId ? t('toggling') : t('disable')}
              </button>
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
          {bundles.status === 'ready' && bundles.snapshot.available.length > 0 ? (
            <section className={css.install} aria-label={t('available')}>
              <h3>{t('available')}</h3>
              {installNote !== null
                ? <p className={installNote.kind === 'error' ? css.installError : css.installRestart} role="status">{installNote.text}</p>
                : null}
              <ul className={css.installList}>
                {bundles.snapshot.available.map(bundle => (
                  <li key={bundle.name} className={css.installRow}>
                    <span className={css.installName}>{bundle.name}</span>
                    <button
                      type="button"
                      className={css.installAction}
                      disabled={installBusy !== null}
                      onClick={() => { mutateBundle(bundle.name, bundle.installed ? 'uninstall' : 'install') }}
                    >
                      {installBusy === bundle.name
                        ? t('installing')
                        : bundle.installed ? t('uninstall') : t('install')}
                    </button>
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
    </div>
  )
}
