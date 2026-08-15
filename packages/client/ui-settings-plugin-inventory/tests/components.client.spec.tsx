// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginInventorySettingsTab } from '../src/client/PluginInventorySettingsTab.tsx'
import type {
  PluginInventorySettingsTabInjected,
  PluginInventorySettingsTabProps,
} from '../src/client/PluginInventorySettingsTab.tsx'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

type Snapshot = Awaited<ReturnType<PluginInventorySettingsTabInjected['list']>>
const t = ((key: PluginInventoryLocaleKey): string => en[key]) as PluginInventorySettingsTabProps['t']

function props(
  list: PluginInventorySettingsTabInjected['list'],
  installPlugin: PluginInventorySettingsTabInjected['installPlugin'] = async () => ({ ok: true as const, restartRequired: true }),
  installedBundles: PluginInventorySettingsTabInjected['installedBundles'] = async () => ({ installed: [] }),
  uninstall: PluginInventorySettingsTabInjected['uninstall'] = async () => ({ ok: true as const, restartRequired: true }),
): PluginInventorySettingsTabProps {
  return {
    t,
    list,
    setEnabled: vi.fn(async () => {}),
    installPlugin,
    installedBundles,
    uninstall,
  } as PluginInventorySettingsTabProps
}

const SNAPSHOT = {
  entries: [
    { entryId: '8a1b2c3d', moduleName: '@deepseek-ai/cordis-plugin-hmr', enabled: true, fiberPhase: 'active' },
    { entryId: 'pending', moduleName: 'cordis:pending-name', enabled: true, fiberPhase: 'pending' },
    { entryId: 'loading', moduleName: '@fixture/loading-name', enabled: true, fiberPhase: 'loading' },
    { entryId: 'failed', moduleName: '@fixture/failed-name', enabled: true, fiberPhase: 'failed' },
    { entryId: 'unloading', moduleName: '@fixture/unloading-name', enabled: true, fiberPhase: 'unloading' },
    { entryId: 'unobserved', moduleName: '@fixture/unobserved-name', enabled: true, fiberPhase: null },
    { entryId: 'disabled-entry', moduleName: '@deepseek-ai/dsh-host-directory-picker-native', enabled: false, fiberPhase: null },
  ],
} as unknown as Snapshot

describe('PluginInventorySettingsTab', () => {
  it('renders runtime status only for enabled plugins', async () => {
    const deferred = Promise.withResolvers<Snapshot>()
    const list = vi.fn(() => deferred.promise)
    const view = render(<PluginInventorySettingsTab {...props(list)} />)
    expect(screen.getByText(en.loading)).toBeTruthy()

    await act(async () => { deferred.resolve(SNAPSHOT) })
    expect(list).toHaveBeenCalledOnce()
    expect(screen.getByRole('searchbox', { name: en.search })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.catalog })).toBeTruthy()
    expect(view.container.querySelector('[data-plugin-count]')?.textContent).toBe('7')
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
    expect(screen.getAllByText(en.enabledTag)).toHaveLength(6)
    expect(screen.getByText(en.disabledTag)).toBeTruthy()
    for (const value of [
      'Mounted',
      'Waiting for dependencies',
      'Loading',
      'Mount failed',
      'Unloading',
      'Not mounted',
    ]) {
      expect(screen.getByRole('img', { name: value })).toBeTruthy()
    }
    const active = screen.getByRole('button', { name: 'hmr, Mounted, Enabled' })
    expect(active.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(active)
    expect(active.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.querySelector('[data-loader-entry]')?.textContent).toBe('8a1b2c3d')
    expect(screen.getByText(en.configuration)).toBeTruthy()
    expect(screen.getByText(en.cordis)).toBeTruthy()
    fireEvent.click(active)
    expect(view.container.querySelector('[data-loader-entry]')).toBeNull()

    fireEvent.click(active)
    fireEvent.change(screen.getByRole('searchbox', { name: en.search }), {
      target: { value: 'disabled-entry' },
    })
    expect(view.container.querySelector('[data-loader-entry]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'directory-picker-native, Disabled' }))
    expect(screen.getAllByText(en.disabledTag)).toHaveLength(2)
    expect(screen.queryByText(en.cordis)).toBeNull()
    expect(screen.queryByText(en.unobserved)).toBeNull()
  })

  it('renders every plugin in one flat list, toggling by state and guarding required plugins', async () => {
    const grouped = {
      entries: [
        { entryId: 'recog', moduleName: '@deepseek-ai/dsh-image-recognition', enabled: true, protected: false, fiberPhase: 'active' },
        { entryId: 'recog-http', moduleName: '@deepseek-ai/dsh-image-recognition-http', enabled: false, protected: false, fiberPhase: null },
        { entryId: 'hmr', moduleName: '@deepseek-ai/cordis-plugin-hmr', enabled: true, protected: true, fiberPhase: 'active' },
      ],
    } as unknown as Snapshot
    render(<PluginInventorySettingsTab {...props(async () => grouped)} />)

    // No separate system section: all three entries share one flat list.
    expect(screen.queryByText('System plugins')).toBeNull()
    expect((await screen.findByRole('searchbox', { name: en.search })).getAttribute('aria-label')).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)

    // A toggleable enabled plugin carries a disable button.
    fireEvent.click(screen.getByRole('button', { name: 'image-recognition, Mounted, Enabled' }))
    expect(screen.getByRole('button', { name: en.disable })).toBeTruthy()

    // A toggleable disabled plugin carries an enable button.
    fireEvent.click(screen.getByRole('button', { name: 'image-recognition-http, Disabled' }))
    expect(screen.getByRole('button', { name: en.enable })).toBeTruthy()

    // A required plugin shows the required note, never a toggle.
    fireEvent.click(screen.getByRole('button', { name: 'hmr, Mounted, Enabled' }))
    expect(screen.getByText(en.required)).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.disable })).toBeNull()
  })

  it('filters by module name or Loader entry id', async () => {
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT)} />)
    const search = await screen.findByRole('searchbox', { name: en.search })

    fireEvent.change(search, { target: { value: 'disabled-entry' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('directory-picker-native')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'cordis-plugin-hmr' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('hmr')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'not-a-plugin' } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(en.emptySearch)).toBeTruthy()
  })

  it('shows a generic failure and retries into the empty state', async () => {
    const list = vi.fn<PluginInventorySettingsTabInjected['list']>()
      .mockRejectedValueOnce(new Error('private transport detail'))
      .mockResolvedValueOnce({ entries: [] })
    render(<PluginInventorySettingsTab {...props(list)} />)

    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    expect(screen.queryByText('private transport detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(en.empty)).toBeTruthy()
  })

  it('contains a synchronous Remote failure and ignores a result after unmount', async () => {
    const syncFailure = vi.fn(() => { throw new Error('namespace unavailable') }) as PluginInventorySettingsTabInjected['list']
    const failed = render(<PluginInventorySettingsTab {...props(syncFailure)} />)
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    failed.unmount()

    const deferred = Promise.withResolvers<Snapshot>()
    const pending = render(<PluginInventorySettingsTab {...props(() => deferred.promise)} />)
    pending.unmount()
    await act(async () => { deferred.resolve(SNAPSHOT) })

    const deferredFailure = Promise.withResolvers<Snapshot>()
    const pendingFailure = render(<PluginInventorySettingsTab {...props(() => deferredFailure.promise)} />)
    pendingFailure.unmount()
    await act(async () => { deferredFailure.reject(new Error('late failure')) })
  })

  it('installs a registry plugin by package name', async () => {
    const installPlugin = vi.fn<PluginInventorySettingsTabInjected['installPlugin']>(async () => ({ ok: true, restartRequired: true }))
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT, installPlugin)} />)

    const input = await screen.findByRole('textbox', { name: en.installSpec })
    fireEvent.change(input, { target: { value: '@scope/plugin' } })
    fireEvent.click(screen.getByRole('button', { name: en.install }))
    expect(installPlugin).toHaveBeenCalledWith({ type: 'registry', spec: '@scope/plugin' })
    expect(await screen.findByText(en.restartRequired)).toBeTruthy()
  })

  it('shows an immediate-activation note when a live reload activates the plugin', async () => {
    const installPlugin = vi.fn<PluginInventorySettingsTabInjected['installPlugin']>(async () => ({ ok: true, restartRequired: false }))
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT, installPlugin)} />)

    const input = await screen.findByRole('textbox', { name: en.installSpec })
    fireEvent.change(input, { target: { value: '@scope/plugin' } })
    fireEvent.click(screen.getByRole('button', { name: en.install }))
    expect(await screen.findByText(en.installed)).toBeTruthy()
    expect(screen.queryByText(en.restartRequired)).toBeNull()
  })

  it('pauses for build consent and retries with the approved set', async () => {
    const installPlugin = vi.fn<PluginInventorySettingsTabInjected['installPlugin']>()
      .mockResolvedValueOnce({ ok: true, restartRequired: false, pendingBuilds: ['node-pty', 'protobufjs'] })
      .mockResolvedValueOnce({ ok: true, restartRequired: true })
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT, installPlugin)} />)

    const input = await screen.findByRole('textbox', { name: en.installSpec })
    fireEvent.change(input, { target: { value: '@scope/native-plugin' } })
    fireEvent.click(screen.getByRole('button', { name: en.install }))
    // The consent dialog lists the blocked packages and the sandbox warning.
    expect(await screen.findByRole('dialog', { name: en.consentTitle })).toBeTruthy()
    expect(screen.getByText(en.consentBody)).toBeTruthy()
    expect(screen.getByText('node-pty')).toBeTruthy()
    expect(screen.getByText('protobufjs')).toBeTruthy()
    // Both are checked by default; approving retries with exactly that set.
    fireEvent.click(screen.getByRole('button', { name: en.consentAllow }))
    expect(installPlugin).toHaveBeenLastCalledWith({
      type: 'registry',
      spec: '@scope/native-plugin',
      consentBuilds: ['node-pty', 'protobufjs'],
    })
    expect(await screen.findByText(en.restartRequired)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('cancelling consent leaves the spec in the field for a retry', async () => {
    const installPlugin = vi.fn<PluginInventorySettingsTabInjected['installPlugin']>(
      async () => ({ ok: true, restartRequired: false, pendingBuilds: ['node-pty'] }),
    )
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT, installPlugin)} />)

    const input = await screen.findByRole('textbox', { name: en.installSpec })
    fireEvent.change(input, { target: { value: '@scope/native-plugin' } })
    fireEvent.click(screen.getByRole('button', { name: en.install }))
    expect(await screen.findByRole('dialog', { name: en.consentTitle })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.consentCancel }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.installSpec }).value)
      .toBe('@scope/native-plugin')
  })

  it('lists user-installed plugins and uninstalls one', async () => {
    const installedBundles = vi.fn<PluginInventorySettingsTabInjected['installedBundles']>(
      async () => ({ installed: [{ name: 'user-plugin' }] }),
    )
    const uninstall = vi.fn<PluginInventorySettingsTabInjected['uninstall']>(
      async () => ({ ok: true, restartRequired: true }),
    )
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT, undefined, installedBundles, uninstall)} />)

    expect(await screen.findByText('user-plugin')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.uninstall }))
    expect(uninstall).toHaveBeenCalledWith('user-plugin')
    expect(await screen.findByText(en.restartRequired)).toBeTruthy()
  })

  it('omits the installed section when nothing is installed', async () => {
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT)} />)
    expect(screen.queryByRole('heading', { name: en.installedPlugins })).toBeNull()
  })
})
