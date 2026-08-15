// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PluginMarketplaceSettingsTab,
  type PluginMarketplaceSettingsTabInjected,
  type PluginMarketplaceSettingsTabProps,
} from '../src/client/PluginMarketplaceSettingsTab.tsx'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: PluginInventoryLocaleKey): string => en[key]) as PluginMarketplaceSettingsTabProps['t']

function props(
  marketplaceList: PluginMarketplaceSettingsTabInjected['marketplaceList'],
  marketplaceInstall: PluginMarketplaceSettingsTabInjected['marketplaceInstall'] = async () => ({ ok: true as const, restartRequired: true }),
  marketplaceUninstall: PluginMarketplaceSettingsTabInjected['marketplaceUninstall'] = async () => ({ ok: true as const, restartRequired: true }),
): PluginMarketplaceSettingsTabProps {
  return { t, marketplaceList, marketplaceInstall, marketplaceUninstall } as PluginMarketplaceSettingsTabProps
}

describe('PluginMarketplaceSettingsTab', () => {
  it('renders marketplace entries with a recommended badge and installs one', async () => {
    const list = vi.fn(async () => ({
      entries: [
        { id: 'a', name: 'Alpha', description: 'desc', author: 'Dev', repository: 'https://github.com/dev/alpha', installed: false, recommended: true },
        { id: 'b', name: 'Beta', description: '', installed: false },
      ],
    }))
    const install = vi.fn(async () => ({ ok: true as const, restartRequired: true }))
    render(<PluginMarketplaceSettingsTab {...props(list, install)} />)

    expect(await screen.findByRole('heading', { name: en.marketplace })).toBeTruthy()
    expect(await screen.findByText('Alpha')).toBeTruthy()
    expect(screen.getByText('desc')).toBeTruthy()
    expect(screen.getByText('Dev')).toBeTruthy()
    // The repository link opens the plugin's source in a new tab.
    const repoLink = screen.getByText(en.marketplaceRepo).closest('a')!
    expect(repoLink).toHaveProperty('href', 'https://github.com/dev/alpha')
    // Only the recommended entry carries the badge.
    expect(screen.getAllByText(en.recommended)).toHaveLength(1)
    expect(screen.getByText('Beta')).toBeTruthy()
    // Click the install button on Alpha's card specifically.
    const alphaCard = screen.getByText('Alpha').closest('li')!
    fireEvent.click(within(alphaCard).getByRole('button', { name: en.install }))
    expect(install).toHaveBeenCalledWith('a')
    expect(await screen.findByText(en.restartRequired)).toBeTruthy()
  })

  it('sorts recommended first, then by priority, then id', async () => {
    const list = vi.fn(async () => ({
      entries: [
        { id: 'c', name: 'Charlie', description: '', recommended: true, priority: 1, installed: false },
        { id: 'a', name: 'Alpha', description: '', recommended: true, priority: 3, installed: false },
        // Highest priority of all, but not recommended: it still sorts last.
        { id: 'b', name: 'Beta', description: '', recommended: false, priority: 100, installed: false },
      ],
    }))
    render(<PluginMarketplaceSettingsTab {...props(list)} />)
    const items = await screen.findAllByRole('listitem')
    const names = items.map(item => item.querySelector('strong')?.textContent)
    expect(names).toEqual(['Alpha', 'Charlie', 'Beta'])
  })

  it('uninstalls an installed marketplace entry', async () => {
    const list = vi.fn(async () => ({
      entries: [{ id: 'a', name: 'Alpha', description: '', installed: true }],
    }))
    const uninstall = vi.fn(async () => ({ ok: true as const, restartRequired: true }))
    render(<PluginMarketplaceSettingsTab {...props(list, undefined, uninstall)} />)

    expect(await screen.findByText(en.marketplaceInstalled)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.uninstall }))
    expect(uninstall).toHaveBeenCalledWith('a')
    expect(await screen.findByText(en.restartRequired)).toBeTruthy()
  })

  it('pauses for build consent and retries with the approved set', async () => {
    const list = vi.fn(async () => ({
      entries: [{ id: 'a', name: 'Alpha', description: '', installed: false }],
    }))
    const install = vi.fn()
      .mockResolvedValueOnce({ ok: true, restartRequired: false, pendingBuilds: ['node-pty', 'protobufjs'] })
      .mockResolvedValueOnce({ ok: true, restartRequired: true })
    render(<PluginMarketplaceSettingsTab {...props(list, install)} />)

    await screen.findByText('Alpha')
    fireEvent.click(screen.getByRole('button', { name: en.install }))
    expect(await screen.findByRole('dialog', { name: en.consentTitle })).toBeTruthy()
    expect(screen.getByText('node-pty')).toBeTruthy()
    expect(screen.getByText('protobufjs')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.consentAllow }))
    expect(install).toHaveBeenLastCalledWith('a', ['node-pty', 'protobufjs'])
    expect(await screen.findByText(en.restartRequired)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows a marketplace load failure with a retry', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error('network miss'))
      .mockResolvedValueOnce({ entries: [] })
    render(<PluginMarketplaceSettingsTab {...props(list)} />)

    expect((await screen.findByRole('alert')).textContent).toBe(en.marketplaceLoadFailed)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(en.marketplaceEmpty)).toBeTruthy()
  })

  it('refreshes the marketplace via the header refresh button', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ entries: [{ id: 'a', name: 'Alpha', description: '', installed: false }] })
      .mockResolvedValueOnce({
        entries: [
          { id: 'a', name: 'Alpha', description: '', installed: false },
          { id: 'b', name: 'Beta', description: '', installed: false },
        ],
      })
    render(<PluginMarketplaceSettingsTab {...props(list)} />)

    await screen.findByText('Alpha')
    expect(screen.queryByText('Beta')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.marketplaceRefresh }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText('Beta')).toBeTruthy()
  })
})
