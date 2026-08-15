// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SkillManagerSettingsTab,
  type SkillManagerSettingsTabInjected,
  type SkillManagerSettingsTabProps,
} from '../src/client/SkillManagerSettingsTab.tsx'
// Loads the `LocaleNamespaceMap` augmentation so `PropsLocale<'settings.skillManager'>` carries `t`.
import type {} from '../src/client/index.ts'
import { en, type SkillManagerLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: SkillManagerLocaleKey): string => en[key]) as SkillManagerSettingsTabProps['t']

type Entry = NonNullable<Awaited<ReturnType<SkillManagerSettingsTabInjected['list']>>>['skills'][number]

const ENTRY: Entry = {
  name: 'my-skill',
  description: 'A demo skill',
  source: 'user-dsh',
  provider: 'filesystem',
  invocation: { modelInvocable: true, userInvocable: true },
  managed: true,
}

function props(
  list: SkillManagerSettingsTabInjected['list'],
  install: SkillManagerSettingsTabInjected['install'] = async () => ({ ok: true as const }),
  uninstall: SkillManagerSettingsTabInjected['uninstall'] = async () => ({ ok: true as const }),
  setEnabled: SkillManagerSettingsTabInjected['setEnabled'] = async () => ({ ok: true as const }),
  setDescription: SkillManagerSettingsTabInjected['setDescription'] = async () => ({ ok: true as const }),
): SkillManagerSettingsTabProps {
  return { t, list, install, uninstall, setEnabled, setDescription } as SkillManagerSettingsTabProps
}

describe('SkillManagerSettingsTab', () => {
  it('renders skills with invocation tags and manage/read-only labels', async () => {
    const list = vi.fn(async () => ({
      skills: [
        ENTRY,
        { ...ENTRY, name: 'bundled-one', description: 'A bundled skill', source: 'bundled', managed: false },
      ],
    }))
    render(<SkillManagerSettingsTab {...props(list)} />)

    expect(await screen.findByText('my-skill')).toBeTruthy()
    expect(screen.getByText('A demo skill')).toBeTruthy()
    expect(screen.getByText(en.managed)).toBeTruthy()
    expect(screen.getByText(en.notManaged)).toBeTruthy()
    expect(screen.getAllByText(`${en.model} · ${en.enabled}`)).toHaveLength(2)
    expect(screen.getByText(`${en.source}: user-dsh`)).toBeTruthy()
  })

  it('installs a skill from the selected source and spec', async () => {
    const list = vi.fn(async () => ({ skills: [] }))
    const install = vi.fn(async () => ({ ok: true as const, name: 'new-skill' }))
    render(<SkillManagerSettingsTab {...props(list, install)} />)

    const input = await screen.findByRole('textbox', { name: en.installSpec })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'npm' } })
    fireEvent.change(input, { target: { value: '@scope/skill-pack' } })
    fireEvent.click(screen.getByRole('button', { name: en.install }))
    expect(install).toHaveBeenCalledWith({ source: 'npm', spec: '@scope/skill-pack' })
    expect(await screen.findByText(`${en.installed}: new-skill`)).toBeTruthy()
  })

  it('toggles model invocation via setEnabled', async () => {
    const list = vi.fn(async () => ({ skills: [ENTRY] }))
    const setEnabled = vi.fn(async () => ({ ok: true as const }))
    render(<SkillManagerSettingsTab {...props(list, undefined, undefined, setEnabled)} />)

    await screen.findByText('my-skill')
    fireEvent.click(screen.getByRole('button', { name: `${en.model} · ${en.enabled}` }))
    expect(setEnabled).toHaveBeenCalledWith('my-skill', { model: false })
    expect(await screen.findByText(en.updated)).toBeTruthy()
  })

  it('edits the skill description', async () => {
    const list = vi.fn(async () => ({ skills: [ENTRY] }))
    const setDescription = vi.fn(async () => ({ ok: true as const }))
    render(<SkillManagerSettingsTab {...props(list, undefined, undefined, undefined, setDescription)} />)

    await screen.findByText('my-skill')
    fireEvent.click(screen.getByRole('button', { name: en.editDescription }))
    const input = screen.getByRole('textbox', { name: en.descriptionPlaceholder })
    fireEvent.change(input, { target: { value: 'A new description' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect(setDescription).toHaveBeenCalledWith('my-skill', 'A new description')
    expect(await screen.findByText(en.updated)).toBeTruthy()
  })

  it('deletes a managed skill', async () => {
    const list = vi.fn(async () => ({ skills: [ENTRY] }))
    const uninstall = vi.fn(async () => ({ ok: true as const }))
    render(<SkillManagerSettingsTab {...props(list, undefined, uninstall)} />)

    await screen.findByText('my-skill')
    fireEvent.click(screen.getByRole('button', { name: en.uninstall }))
    expect(uninstall).toHaveBeenCalledWith('my-skill')
    expect(await screen.findByText(en.updated)).toBeTruthy()
  })

  it('shows a load failure and retries', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ skills: [] })
    render(<SkillManagerSettingsTab {...props(list)} />)

    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(en.skillsEmpty)).toBeTruthy()
  })
})
