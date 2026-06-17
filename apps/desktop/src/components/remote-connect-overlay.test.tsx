import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesktopConnectionProbeResult } from '@/global'
import { $desktopBoot } from '@/store/boot'

import { RemoteConnectOverlay } from './remote-connect-overlay'

// The first-run connect screen for the standalone "Hermes Remote" flavor. It is
// driven entirely by the authoritative 'backend.needs-remote' boot phase (the
// main process only ever sets it on the remote flavor's connect-first gate) and
// wraps the same connection-config IPC as Settings → Gateway.

function tokenProbe(): DesktopConnectionProbeResult {
  return { authMode: 'token', baseUrl: 'https://gw.example.com', error: null, providers: [], reachable: true, version: '1.0' }
}

function oauthProbe(): DesktopConnectionProbeResult {
  return {
    authMode: 'oauth',
    baseUrl: 'https://gw.example.com',
    error: null,
    providers: [{ displayName: 'Nous Research', name: 'nous' }],
    reachable: true,
    version: '1.0'
  }
}

function fakeDesktop(probe: DesktopConnectionProbeResult) {
  return {
    probeConnectionConfig: vi.fn(async () => probe),
    saveConnectionConfig: vi.fn(async () => ({})),
    applyConnectionConfig: vi.fn(async () => ({})),
    testConnectionConfig: vi.fn(async () => ({ baseUrl: probe.baseUrl, ok: true, version: probe.version })),
    oauthLoginConnectionConfig: vi.fn(async () => ({ ok: true, baseUrl: probe.baseUrl, connected: true })),
    useLocalConnectionConfig: vi.fn(async () => ({ ok: true }))
  }
}

function setPhase(phase: string) {
  $desktopBoot.set({
    error: null,
    fakeMode: false,
    message: '',
    phase,
    progress: 0,
    running: false,
    timestamp: Date.now(),
    visible: true
  })
}

afterEach(() => {
  cleanup()
  delete (window as { hermesDesktop?: unknown }).hermesDesktop
})

beforeEach(() => {
  setPhase('backend.needs-remote')
})

describe('RemoteConnectOverlay', () => {
  it('is hidden unless the boot phase is backend.needs-remote', () => {
    ;(window as { hermesDesktop?: unknown }).hermesDesktop = fakeDesktop(tokenProbe())
    setPhase('backend.ready')

    render(<RemoteConnectOverlay />)

    expect(screen.queryByText('Connect to Hermes')).toBeNull()
  })

  it('shows the connect screen on the needs-remote phase', () => {
    ;(window as { hermesDesktop?: unknown }).hermesDesktop = fakeDesktop(tokenProbe())

    render(<RemoteConnectOverlay />)

    expect(screen.getByText('Connect to Hermes')).toBeTruthy()
    expect(screen.getByText(/Use a local backend instead/i)).toBeTruthy()
  })

  it('token gateway: typing a URL reveals the token box and Connect applies a remote config', async () => {
    const desktop = fakeDesktop(tokenProbe())

    ;(window as { hermesDesktop?: unknown }).hermesDesktop = desktop

    render(<RemoteConnectOverlay />)

    fireEvent.change(screen.getByPlaceholderText('https://gateway.example.com/hermes'), {
      target: { value: 'https://gw.example.com' }
    })

    // After the debounced probe resolves to token auth, the token box appears.
    const tokenInput = await screen.findByPlaceholderText(/Paste session token/i)
    fireEvent.change(tokenInput, { target: { value: 'sess-token-123' } })

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() =>
      expect(desktop.applyConnectionConfig).toHaveBeenCalledWith({
        mode: 'remote',
        remoteAuthMode: 'token',
        remoteToken: 'sess-token-123',
        remoteUrl: 'https://gw.example.com'
      })
    )
  })

  it('oauth gateway: typing a URL reveals a sign-in button instead of a token box', async () => {
    const desktop = fakeDesktop(oauthProbe())

    ;(window as { hermesDesktop?: unknown }).hermesDesktop = desktop

    render(<RemoteConnectOverlay />)

    fireEvent.change(screen.getByPlaceholderText('https://gateway.example.com/hermes'), {
      target: { value: 'https://gw.example.com' }
    })

    expect(await screen.findByRole('button', { name: /Sign in with Nous Research/i })).toBeTruthy()
    expect(screen.queryByPlaceholderText(/Paste session token/i)).toBeNull()
  })

  it('editing the URL after OAuth sign-in clears the stale "signed in" state', async () => {
    const desktop = fakeDesktop(oauthProbe())

    ;(window as { hermesDesktop?: unknown }).hermesDesktop = desktop

    render(<RemoteConnectOverlay />)

    const urlInput = screen.getByPlaceholderText('https://gateway.example.com/hermes')
    fireEvent.change(urlInput, { target: { value: 'https://gw-a.example.com' } })

    fireEvent.click(await screen.findByRole('button', { name: /Sign in with Nous Research/i }))

    // After a successful sign-in the "Signed in" pill replaces the button.
    await screen.findByText('Signed in')

    // Editing the URL invalidates the origin-bound OAuth session: the pill must
    // go away and the sign-in button must return for the new URL.
    fireEvent.change(urlInput, { target: { value: 'https://gw-b.example.com' } })

    expect(await screen.findByRole('button', { name: /Sign in with Nous Research/i })).toBeTruthy()
    expect(screen.queryByText('Signed in')).toBeNull()
  })

  it('"Use a local backend instead" opts into the local bootstrap path', async () => {
    const desktop = fakeDesktop(tokenProbe())

    ;(window as { hermesDesktop?: unknown }).hermesDesktop = desktop

    render(<RemoteConnectOverlay />)

    fireEvent.click(screen.getByRole('button', { name: /Use a local backend instead/i }))

    await waitFor(() => expect(desktop.useLocalConnectionConfig).toHaveBeenCalledTimes(1))
  })
})
