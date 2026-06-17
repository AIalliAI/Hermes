import { useEffect, useMemo, useRef, useState } from 'react'

import type { DesktopAuthProvider, DesktopConnectionProbeResult } from '@/global'

export type RemoteAuthMode = 'oauth' | 'token'
export type RemoteProbeStatus = 'idle' | 'probing' | 'done' | 'error'

export interface UseRemoteAuthProbeOptions {
  // The gateway URL the user has entered (trimmed internally).
  url: string
  // Only probe when true — e.g. remote mode is selected. When false the hook
  // resets to idle so no stale control renders.
  enabled: boolean
  // Auth mode from the saved config, used until a fresh probe lands.
  savedAuthMode: RemoteAuthMode
  // True when a previously-saved remote exists (token set or OAuth connected),
  // so the matching control shows immediately on re-open with no flicker.
  hasSavedRemote: boolean
  // Label to show when the gateway advertises no named providers.
  fallbackProviderLabel: string
}

export interface UseRemoteAuthProbeResult {
  probeStatus: RemoteProbeStatus
  probe: DesktopConnectionProbeResult | null
  authMode: RemoteAuthMode
  // Whether we KNOW how this gateway authenticates yet. Until we do, neither the
  // OAuth button nor the token box should render (authMode defaults to 'token',
  // so without this gate the token box flashes for OAuth gateways while probing).
  authResolved: boolean
  providerLabel: string
  // True when EVERY advertised provider is username/password (gateway /login
  // renders a credential form rather than an OAuth redirect) — only the button
  // copy changes; the session/cookie/ws-ticket machinery is identical.
  isPasswordProvider: boolean
}

const URL_RE = /^https?:\/\//i

/**
 * Debounced probe of a remote gateway URL → its auth scheme (OAuth/password vs
 * static session token), with flicker-free resolution rules. Shared by
 * Settings → Gateway and the first-run connect overlay so both render the right
 * control identically. Mirrors hermes_cli's `/api/status` + `/api/auth/providers`
 * contract via window.hermesDesktop.probeConnectionConfig.
 */
export function useRemoteAuthProbe({
  url,
  enabled,
  savedAuthMode,
  hasSavedRemote,
  fallbackProviderLabel
}: UseRemoteAuthProbeOptions): UseRemoteAuthProbeResult {
  const [probeStatus, setProbeStatus] = useState<RemoteProbeStatus>('idle')
  const [probe, setProbe] = useState<DesktopConnectionProbeResult | null>(null)
  const probeSeq = useRef(0)

  const trimmedUrl = url.trim()

  useEffect(() => {
    if (!enabled || !trimmedUrl || !URL_RE.test(trimmedUrl)) {
      setProbeStatus('idle')
      setProbe(null)

      return
    }

    const desktop = window.hermesDesktop

    if (!desktop?.probeConnectionConfig) {
      return
    }

    const seq = ++probeSeq.current
    setProbeStatus('probing')

    const timer = setTimeout(() => {
      desktop
        .probeConnectionConfig(trimmedUrl)
        .then(result => {
          if (seq !== probeSeq.current) {
            return
          }

          setProbe(result)
          setProbeStatus(result.reachable ? 'done' : 'error')
        })
        .catch(() => {
          if (seq !== probeSeq.current) {
            return
          }

          setProbe(null)
          setProbeStatus('error')
        })
    }, 500)

    return () => clearTimeout(timer)
  }, [enabled, trimmedUrl])

  // Effective auth mode: a reachable probe wins; otherwise fall back to the
  // saved config's mode so a re-open doesn't flicker.
  const authMode: RemoteAuthMode = useMemo(() => {
    if (probeStatus === 'done' && probe && probe.authMode !== 'unknown') {
      return probe.authMode
    }

    return savedAuthMode
  }, [probe, probeStatus, savedAuthMode])

  const authResolved = useMemo(() => {
    if (probeStatus === 'done') {
      return true
    }

    return probeStatus === 'idle' && hasSavedRemote
  }, [probeStatus, hasSavedRemote])

  const providerLabel = useMemo(() => {
    const providers: DesktopAuthProvider[] = probe?.providers ?? []

    if (providers.length === 1) {
      return providers[0].displayName || providers[0].name
    }

    if (providers.length > 1) {
      return providers.map(p => p.displayName || p.name).join(' / ')
    }

    return fallbackProviderLabel
  }, [probe, fallbackProviderLabel])

  const isPasswordProvider = useMemo(() => {
    const providers: DesktopAuthProvider[] = probe?.providers ?? []

    return providers.length > 0 && providers.every(p => p.supportsPassword)
  }, [probe])

  return { probeStatus, probe, authMode, authResolved, providerLabel, isPasswordProvider }
}
