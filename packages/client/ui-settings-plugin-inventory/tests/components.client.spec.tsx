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
  bundles: PluginInventorySettingsTabInjected['availableBundles'] = async () => ({ available: [] }),
  installPlugin: PluginInventorySettingsTabInjected['installPlugin'] = async () => ({ ok: true as const, restartRequired: true }),
  uninstall: PluginInventorySettingsTabInjected['uninstall'] = async () => ({ ok: true as const, restartRequired: true }),
): PluginInventorySettingsTabProps {
  return {
    t,
    list,
    availableBundles: bundles,
    installPlugin,
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

  it('renders the installable bundles with install and uninstall actions', async () => {
    const installPlugin = vi.fn<PluginInventorySettingsTabInjected['installPlugin']>(async () => ({ ok: true, restartRequired: true }))
    const uninstall = vi.fn<PluginInventorySettingsTabInjected['uninstall']>(async () => ({ ok: true, restartRequired: true }))
    const bundles: PluginInventorySettingsTabInjected['availableBundles'] = async () => ({
      available: [
        { name: '@deepseek-ai/dsh-new-bundle', installed: false },
        { name: '@deepseek-ai/dsh-installed-bundle', installed: true },
      ],
    })
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT, bundles, installPlugin, uninstall)} />)

    expect(await screen.findByText(en.available)).toBeTruthy()
    expect(screen.getByText('@deepseek-ai/dsh-new-bundle')).toBeTruthy()
    expect(screen.getByText('@deepseek-ai/dsh-installed-bundle')).toBeTruthy()

    // Install a not-installed bundle.
    fireEvent.click(screen.getByRole('button', { name: en.install }))
    expect(installPlugin).toHaveBeenCalledWith({ type: 'bundle', name: '@deepseek-ai/dsh-new-bundle' })
    expect(await screen.findByText(en.restartRequired)).toBeTruthy()

    // Uninstall an installed bundle.
    fireEvent.click(screen.getByRole('button', { name: en.uninstall }))
    expect(uninstall).toHaveBeenCalledWith('@deepseek-ai/dsh-installed-bundle')
  })
})
