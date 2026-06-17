/**
 * flavor.cjs
 *
 * Pure, electron-free resolution of the desktop "flavor" — which product
 * variant this build is. Two flavors today:
 *   - 'full'   (default): the standard Hermes desktop app. First launch
 *              bootstraps a local Python backend (the legacy behavior).
 *   - 'remote': the standalone "Hermes Remote" client. First launch shows a
 *              connect-to-remote screen instead of bootstrapping; a local
 *              backend stays available as an explicit opt-in.
 *
 * Flavor is fixed at build time. Resolution order (first hit wins):
 *   1. process.env.HERMES_DESKTOP_FLAVOR  (dev runs / CI / the dist:*:remote
 *      npm scripts)
 *   2. a bundled flavor.json `{ "flavor": "remote" }` written by
 *      scripts/write-build-stamp.cjs and shipped via electron-builder
 *      extraResources (read from process.resourcesPath at runtime)
 *   3. 'full'
 *
 * Kept require('electron')-free so it unit-tests with `node --test`, same as
 * connection-config.cjs / backend-probes.cjs. main.cjs passes the candidate
 * flavor.json paths (resourcesPath + the dev build dir) and wires the result
 * into the electron-coupled layers.
 */

const fs = require('node:fs')

const VALID_FLAVORS = ['full', 'remote']

// Product identity derived from flavor. The 'full' flavor keeps the legacy
// values verbatim so existing installs are byte-for-byte unchanged. Only the
// OS-registered deep-link protocol must differ per flavor — two installed apps
// can't both own `hermes://`. The in-app media protocol (registered via
// protocol.handle, scoped to the app's own session) does NOT collide across
// apps, so it stays shared to avoid re-plumbing renderer media URLs.
const FLAVOR_IDENTITY = {
  full: {
    flavor: 'full',
    protocol: 'hermes',
    productName: 'Hermes'
  },
  remote: {
    flavor: 'remote',
    protocol: 'hermes-remote',
    productName: 'Hermes Remote'
  }
}

function normalizeFlavor(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase()
  return VALID_FLAVORS.includes(v) ? v : null
}

function readFlavorFile(candidatePaths) {
  for (const p of candidatePaths || []) {
    if (!p) continue
    try {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
      const flavor = normalizeFlavor(parsed && parsed.flavor)
      if (flavor) return flavor
    } catch {
      // ENOENT or malformed JSON; try the next candidate.
    }
  }
  return null
}

/**
 * Resolve the effective flavor. `env` is process.env.HERMES_DESKTOP_FLAVOR (or
 * undefined); `candidatePaths` is an ordered list of flavor.json locations to
 * consult when the env var is unset. Always returns one of VALID_FLAVORS.
 */
function resolveFlavor({ env, candidatePaths } = {}) {
  return normalizeFlavor(env) || readFlavorFile(candidatePaths) || 'full'
}

function flavorIdentity(flavor) {
  return FLAVOR_IDENTITY[normalizeFlavor(flavor) || 'full'] || FLAVOR_IDENTITY.full
}

function isRemoteFlavor(flavor) {
  return (normalizeFlavor(flavor) || 'full') === 'remote'
}

module.exports = {
  FLAVOR_IDENTITY,
  VALID_FLAVORS,
  flavorIdentity,
  isRemoteFlavor,
  normalizeFlavor,
  readFlavorFile,
  resolveFlavor
}
