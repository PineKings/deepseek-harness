import { useEffect, useId, useState, type ReactNode } from 'react'
import type {
  SkillInstallSpec, SkillInvocationPatch, SkillManagerEntry, SkillManagerSnapshot,
} from '@deepseek-ai/dsh-api-remotes/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './SkillManagerSettingsTab.module.css'

/** Registration-side Remote face used by the section. */
export interface SkillManagerSettingsTabInjected {
  /** Read a current Host skill snapshot. */
  list: () => Promise<SkillManagerSnapshot>
  /** Install a skill from a git/npm/tarball/local source. */
  install: (spec: SkillInstallSpec) => Promise<{ ok: true; name?: string }>
  /** Delete a user-root skill. */
  uninstall: (name: string) => Promise<{ ok: true; name?: string }>
  /** Toggle a skill's model/user invocation surfaces. */
  setEnabled: (name: string, patch: SkillInvocationPatch) => Promise<{ ok: true; name?: string }>
  /** Edit a skill's description. */
  setDescription: (name: string, description: string) => Promise<{ ok: true; name?: string }>
}

/** Full component props assembled by the Settings slot renderer. */
export type SkillManagerSettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.skillManager'>
  & InjectFace<SkillManagerSettingsTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly entries: readonly SkillManagerEntry[] }

const SOURCES: readonly SkillInstallSpec['source'][] = ['git', 'npm', 'tarball', 'local']

/** Render the local skill catalog with install/uninstall and invocation management. */
export function SkillManagerSettingsTab({
  list, install, uninstall, setEnabled, setDescription, t,
}: SkillManagerSettingsTabProps): ReactNode {
  const titleId = useId()
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [source, setSource] = useState<SkillInstallSpec['source']>('git')
  const [spec, setSpec] = useState('')
  const [installBusy, setInstallBusy] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ kind: 'restart' | 'error'; text: string } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [descValue, setDescValue] = useState('')

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => list()).then(
      (snapshot) => { if (current) setState({ status: 'ready', entries: snapshot.skills }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [list, request])

  /** Re-fetch the catalog after a load failure or a mutation. */
  const refresh = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  const installSkill = (): void => {
    const trimmed = spec.trim()
    if (trimmed.length === 0 || installBusy) return
    setInstallBusy(true)
    setNote(null)
    void install({ source, spec: trimmed }).then(
      (result) => {
        setNote({ kind: 'restart', text: result.name !== undefined ? `${t('installed')}: ${result.name}` : t('installed') })
        setSpec('')
        setRequest(value => value + 1)
      },
      (error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error)
        setNote({ kind: 'error', text: `${t('installFailed')}: ${detail}` })
      },
    ).finally(() => { setInstallBusy(false) })
  }

  const removeSkill = (name: string): void => {
    if (busy !== null) return
    setBusy(name)
    setNote(null)
    void uninstall(name).then(
      () => {
        setNote({ kind: 'restart', text: t('updated') })
        setRequest(value => value + 1)
      },
      (error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error)
        setNote({ kind: 'error', text: `${t('uninstallFailed')}: ${detail}` })
      },
    ).finally(() => { setBusy(null) })
  }

  const toggleInvocation = (entry: SkillManagerEntry, key: 'model' | 'user', value: boolean): void => {
    if (busy !== null) return
    setBusy(entry.name)
    setNote(null)
    void setEnabled(entry.name, { [key]: value }).then(
      () => { setNote({ kind: 'restart', text: t('updated') }); setRequest(value => value + 1) },
      (error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error)
        setNote({ kind: 'error', text: `${t('updateFailed')}: ${detail}` })
      },
    ).finally(() => { setBusy(null) })
  }

  const saveDescription = (name: string): void => {
    const value = descValue.trim()
    if (value.length === 0 || busy !== null) return
    setBusy(name)
    setNote(null)
    void setDescription(name, value).then(
      () => { setEditing(null); setNote({ kind: 'restart', text: t('updated') }); setRequest(value => value + 1) },
      (error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error)
        setNote({ kind: 'error', text: `${t('saveFailed')}: ${detail}` })
      },
    ).finally(() => { setBusy(null) })
  }

  const invocationTag = (entry: SkillManagerEntry, key: 'model' | 'user', enabled: boolean): ReactNode => {
    const label = `${t(key)} · ${t(enabled ? 'enabled' : 'disabled')}`
    const handle = entry.managed
      ? () => { toggleInvocation(entry, key, !enabled) }
      : undefined
    return (
      <button
        className={css.invocationTag}
        data-enabled={enabled ? 'true' : 'false'}
        data-managed={entry.managed ? 'true' : 'false'}
        type="button"
        aria-label={label}
        key={key}
        disabled={!entry.managed || busy === entry.name}
        onClick={handle}
      >
        {label}
      </button>
    )
  }

  return (
    <div className={css.section} aria-busy={state.status === 'loading'} aria-labelledby={titleId}>
      <h3 className={css.heading} id={titleId}>{t('tab')}</h3>
      {note !== null
        ? <p className={note.kind === 'error' ? css.error : css.restart} role="status">{note.text}</p>
        : null}
      <section className={css.install} aria-label={t('installSkill')}>
        <h4>{t('installSkill')}</h4>
        <div className={css.installRow}>
          <label className={css.sourceSelect}>
            <span className={css.visuallyHidden}>{t('installSource')}</span>
            <select value={source} onChange={(event) => { setSource(event.currentTarget.value as SkillInstallSpec['source']) }}>
              {SOURCES.map(value => <option value={value} key={value}>{value}</option>)}
            </select>
          </label>
          <input
            type="text"
            className={css.installInput}
            value={spec}
            placeholder={t('installSpec')}
            aria-label={t('installSpec')}
            onChange={(event) => { setSpec(event.currentTarget.value) }}
            onKeyDown={(event) => { if (event.key === 'Enter') installSkill() }}
          />
          <Button className={css.installAction} variant="primary" size="sm" disabled={installBusy || spec.trim().length === 0} onClick={installSkill}>
            {installBusy ? t('installing') : t('install')}
          </Button>
        </div>
      </section>
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={refresh}>{t('retry')}</button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        state.entries.length === 0
          ? <p className={css.status}>{t('skillsEmpty')}</p>
          : (
            <ul className={css.list}>
              {state.entries.map(entry => (
                <li className={css.card} key={entry.name}>
                  <div className={css.cardHead}>
                    <strong className={css.name}>{entry.name}</strong>
                    <span className={css.managedTag} data-managed={entry.managed ? 'true' : 'false'}>
                      {t(entry.managed ? 'managed' : 'notManaged')}
                    </span>
                  </div>
                  {editing === entry.name ? (
                    <div className={css.editRow}>
                      <input
                        type="text"
                        className={css.descInput}
                        value={descValue}
                        aria-label={t('descriptionPlaceholder')}
                        onChange={(event) => { setDescValue(event.currentTarget.value) }}
                        onKeyDown={(event) => { if (event.key === 'Enter') saveDescription(entry.name) }}
                      />
                      <Button className={css.editAction} variant="primary" size="sm" disabled={busy === entry.name || descValue.trim().length === 0} onClick={() => { saveDescription(entry.name) }}>
                        {busy === entry.name ? t('saving') : t('save')}
                      </Button>
                    </div>
                  ) : (
                    <p className={css.desc}>{entry.description}</p>
                  )}
                  <div className={css.meta}>
                    <span className={css.source}>{`${t('source')}: ${entry.source}`}</span>
                    {invocationTag(entry, 'model', entry.invocation.modelInvocable)}
                    {invocationTag(entry, 'user', entry.invocation.userInvocable)}
                  </div>
                  {entry.managed ? (
                    <div className={css.actions}>
                      <Button className={css.action} variant="outline" size="sm"
                        disabled={busy !== null}
                        onClick={() => { setEditing(entry.name); setDescValue(entry.description) }}>
                        {t('editDescription')}
                      </Button>
                      <Button className={css.action} variant="outline" size="sm"
                        disabled={busy === entry.name}
                        aria-busy={busy === entry.name || undefined}
                        onClick={() => { removeSkill(entry.name) }}>
                        {busy === entry.name ? t('uninstalling') : t('uninstall')}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )
      ) : null}
    </div>
  )
}
