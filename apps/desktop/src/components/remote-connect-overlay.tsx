import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { useRemoteAuthProbe } from '@/app/settings/use-remote-connect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { AlertCircle, Check, Globe, Loader2, LogIn, Monitor } from '@/lib/icons'
import { $desktopBoot } from '@/store/boot'
import { notify, notifyError } from '@/store/notifications'

type BusyAction = 'connect' | 'local' | 'signin' | 'test' | null

// First-run connect screen for the standalone "Hermes Remote" flavor. The main
// process sets the 'backend.needs-remote' boot phase (only ever in the remote
// flavor) when nothing is configured, instead of bootstrapping a local backend.
// This overlay wraps the SAME connection IPC as Settings → Gateway (probe →
// sign-in/token → test → apply) so a fresh client connects to a remote gateway
// without a terminal. "Use a local backend instead" opts into the bundled
// backend (the local-optional path).
export function RemoteConnectOverlay() {
  const boot = useStore($desktopBoot)
  const { t } = useI18n()
  const g = t.settings.gateway
  const c = t.boot.connect

  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [oauthConnected, setOauthConnected] = useState(false)
  const [busy, setBusy] = useState<BusyAction>(null)

  const trimmedUrl = url.trim()

  // Only show (and only probe) when the main process is waiting for a remote
  // config. The phase is authoritative — it's set exclusively on the remote
  // flavor's connect-first gate — so it doubles as the flavor guard.
  const visible = boot.phase === 'backend.needs-remote'

  const { authMode, authResolved, isPasswordProvider, probeStatus, providerLabel } = useRemoteAuthProbe({
    enabled: visible,
    fallbackProviderLabel: t.boot.failure.identityProvider,
    hasSavedRemote: oauthConnected,
    savedAuthMode: 'token',
    url
  })

  if (!visible) {
    return null
  }

  const canConnect = Boolean(trimmedUrl) && (authMode === 'oauth' ? oauthConnected : Boolean(token.trim()))

  const remotePayload = () => ({
    mode: 'remote' as const,
    remoteAuthMode: authMode,
    remoteToken: authMode === 'token' ? token.trim() || undefined : undefined,
    remoteUrl: trimmedUrl
  })

  const signIn = async () => {
    if (!trimmedUrl) {
      notify({ kind: 'warning', title: g.incompleteTitle, message: c.enterUrlFirst })

      return
    }

    setBusy('signin')

    try {
      // Persist the URL + oauth mode first so the login window has a target,
      // without flipping the live connection yet.
      await window.hermesDesktop?.saveConnectionConfig({
        mode: 'remote',
        remoteAuthMode: 'oauth',
        remoteUrl: trimmedUrl
      })
      const result = await window.hermesDesktop?.oauthLoginConnectionConfig(trimmedUrl)

      if (result?.connected) {
        setOauthConnected(true)
        notify({ kind: 'success', title: g.signedIn, message: g.connectedTo(providerLabel) })
      } else {
        notify({
          kind: 'warning',
          title: t.boot.failure.signInIncompleteTitle,
          message: t.boot.failure.signInIncompleteMessage
        })
      }
    } catch (err) {
      notifyError(err, g.signInFailed)
    } finally {
      setBusy(null)
    }
  }

  const test = async () => {
    if (!canConnect) {
      notify({
        kind: 'warning',
        title: g.incompleteTitle,
        message: authMode === 'oauth' ? c.signInRequired : c.tokenRequired
      })

      return
    }

    setBusy('test')

    try {
      const result = await window.hermesDesktop?.testConnectionConfig(remotePayload())
      notify({
        kind: 'success',
        title: g.reachableTitle,
        message: g.connectedTo(result?.baseUrl ?? trimmedUrl, result?.version ?? undefined)
      })
    } catch (err) {
      notifyError(err, g.testFailed)
    } finally {
      setBusy(null)
    }
  }

  // applyConnectionConfig tears down the (absent) primary backend and reloads
  // the window from the main process; on reload startHermes() resolves the
  // freshly-saved remote and connects. No further work here.
  const connect = async () => {
    if (!canConnect) {
      notify({
        kind: 'warning',
        title: g.incompleteTitle,
        message: authMode === 'oauth' ? c.signInRequired : c.tokenRequired
      })

      return
    }

    setBusy('connect')

    try {
      await window.hermesDesktop?.applyConnectionConfig(remotePayload())
    } catch (err) {
      notifyError(err, c.connectFailed)
      setBusy(null)
    }
  }

  // Opt into the bundled local backend (the local-optional path). The main
  // process persists the choice and reloads into the normal bootstrap flow.
  const switchToLocal = async () => {
    setBusy('local')

    try {
      await window.hermesDesktop?.useLocalConnectionConfig()
    } catch (err) {
      notifyError(err, c.connectFailed)
      setBusy(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-(--ui-chat-surface-background) p-6">
      <div className="w-full max-w-[34rem] overflow-hidden rounded-xl border border-(--stroke-nous) bg-(--ui-chat-bubble-background) shadow-nous">
        <div className="flex items-start gap-3 px-5 py-4">
          <Globe className="mt-0.5 size-5 text-(--theme-primary)" />
          <div>
            <h2 className="text-[0.9375rem] font-semibold tracking-tight">{c.title}</h2>
            <p className="mt-1 text-[0.8125rem] leading-5 text-(--ui-text-tertiary)">{c.description}</p>
          </div>
        </div>

        <div className="grid gap-3 p-5">
          <div className="grid gap-1.5">
            <label className="text-[length:var(--conversation-caption-font-size)] font-medium text-(--ui-text-secondary)">
              {c.urlTitle}
            </label>
            <Input
              autoFocus
              className="h-9"
              onChange={event => {
                setUrl(event.target.value)
                // An OAuth session is minted for a specific gateway origin, so
                // editing the URL invalidates a prior "signed in" — clear it to
                // avoid connecting with an origin-mismatched session (and to
                // re-show the correct control for the new URL).
                setOauthConnected(false)
              }}
              placeholder="https://gateway.example.com/hermes"
              value={url}
            />
          </div>

          {probeStatus === 'probing' ? (
            <div className="flex items-center gap-2 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
              <Loader2 className="size-4 animate-spin" />
              {g.probing}
            </div>
          ) : null}

          {probeStatus === 'error' ? (
            <div className="flex items-start gap-2 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {g.probeError}
            </div>
          ) : null}

          {authResolved && authMode === 'oauth' ? (
            <div className="grid gap-1.5">
              <label className="text-[length:var(--conversation-caption-font-size)] font-medium text-(--ui-text-secondary)">
                {g.authTitle}
              </label>
              {oauthConnected ? (
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-(--ui-stroke-secondary) bg-(--ui-bg-tertiary) px-3 py-1 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-primary)">
                  <Check className="size-3 text-primary" /> {g.signedIn}
                </span>
              ) : (
                <Button className="w-fit" disabled={busy !== null || !trimmedUrl} onClick={() => void signIn()}>
                  {busy === 'signin' ? <Loader2 className="animate-spin" /> : <LogIn />}
                  {isPasswordProvider ? g.signIn : g.signInWith(providerLabel)}
                </Button>
              )}
            </div>
          ) : null}

          {authResolved && authMode === 'token' ? (
            <div className="grid gap-1.5">
              <label className="text-[length:var(--conversation-caption-font-size)] font-medium text-(--ui-text-secondary)">
                {c.tokenTitle}
              </label>
              <Input
                autoComplete="off"
                className="h-9 font-mono"
                onChange={event => setToken(event.target.value)}
                placeholder={g.pasteSessionToken}
                type="password"
                value={token}
              />
            </div>
          ) : null}

          <div className="mt-1 flex flex-wrap items-center justify-end gap-3">
            <Button
              className="mr-auto"
              disabled={busy !== null || !canConnect}
              onClick={() => void test()}
              size="sm"
              variant="text"
            >
              {busy === 'test' ? <Loader2 className="animate-spin" /> : null}
              {c.test}
            </Button>
            <Button disabled={busy !== null || !canConnect} onClick={() => void connect()} size="sm">
              {busy === 'connect' ? <Loader2 className="animate-spin" /> : null}
              {c.connect}
            </Button>
          </div>

          <div className="mt-2 border-t border-(--ui-stroke-tertiary) pt-3">
            <Button disabled={busy !== null} onClick={() => void switchToLocal()} size="sm" variant="ghost">
              {busy === 'local' ? <Loader2 className="animate-spin" /> : <Monitor />}
              {c.useLocal}
            </Button>
            <p className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
              {c.useLocalHint}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
