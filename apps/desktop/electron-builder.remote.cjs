/**
 * electron-builder.remote.cjs — packaging config for the standalone
 * "Hermes Remote" flavor.
 *
 * Spreads the base `build` config from package.json and overrides ONLY product
 * identity, so the remote client installs alongside the full Hermes app without
 * sharing its appId / userData / keychain / deep-link scheme. electron-builder
 * uses a `--config <file>` as the complete config (it does NOT merge with the
 * package.json `build` field), hence the explicit spread of `pkg.build`.
 *
 * Build it with the matching npm scripts, which also set
 * HERMES_DESKTOP_FLAVOR=remote so scripts/write-build-stamp.cjs stamps
 * build/flavor.json = { "flavor": "remote" } and vite bakes the same flavor in:
 *   npm run dist:mac:remote   /  dist:win:remote  /  dist:linux:remote
 *
 * Note: icon is intentionally inherited from the base config for now — a
 * dedicated "Hermes Remote" icon set is a follow-up (see the plan). The product
 * name, appId, executable, and protocol are what make it a distinct app.
 */

const pkg = require('./package.json')

const base = pkg.build

// Keep productName and executableName identical so electron-builder's
// productFilename (derived from productName) matches the actual binary name —
// scripts/after-pack.cjs locates the Windows .exe by productFilename to stamp
// its identity, so a divergence would silently skip the stamp.
const PRODUCT_NAME = 'Hermes Remote'

module.exports = {
  ...base,
  appId: 'com.nousresearch.hermes-remote',
  productName: PRODUCT_NAME,
  executableName: PRODUCT_NAME,
  artifactName: 'Hermes-Remote-${version}-${os}-${arch}.${ext}',
  protocols: [
    {
      name: 'Hermes Remote Protocol',
      schemes: ['hermes-remote']
    }
  ],
  mac: {
    ...base.mac,
    extendInfo: {
      ...(base.mac && base.mac.extendInfo),
      CFBundleDisplayName: PRODUCT_NAME,
      CFBundleExecutable: PRODUCT_NAME,
      CFBundleName: PRODUCT_NAME
    }
  },
  dmg: {
    ...base.dmg,
    title: 'Install Hermes Remote'
  },
  win: {
    ...base.win,
    legalTrademarks: PRODUCT_NAME
  },
  linux: {
    ...base.linux,
    synopsis: 'Standalone desktop client for a remote Hermes Agent.'
  },
  nsis: {
    ...base.nsis,
    shortcutName: PRODUCT_NAME,
    uninstallDisplayName: PRODUCT_NAME
  }
}
