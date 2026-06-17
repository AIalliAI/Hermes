/**
 * Tests for electron/flavor.cjs.
 *
 * Run with: node --test electron/flavor.test.cjs
 * (Wired into npm test:desktop:platforms in package.json.)
 *
 * Pure flavor resolution: env wins, then a bundled flavor.json, then 'full';
 * junk values fall back to 'full'; identity is derived per flavor. This is the
 * decision the remote-flavor connect-first gate in main.cjs keys off.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { flavorIdentity, isRemoteFlavor, normalizeFlavor, readFlavorFile, resolveFlavor } = require('./flavor.cjs')

test('normalizeFlavor accepts known flavors case-insensitively, else null', () => {
  assert.equal(normalizeFlavor('full'), 'full')
  assert.equal(normalizeFlavor('remote'), 'remote')
  assert.equal(normalizeFlavor('REMOTE'), 'remote')
  assert.equal(normalizeFlavor('  remote  '), 'remote')
  assert.equal(normalizeFlavor('nope'), null)
  assert.equal(normalizeFlavor(''), null)
  assert.equal(normalizeFlavor(undefined), null)
})

test('resolveFlavor: env wins over file and default', () => {
  assert.equal(resolveFlavor({ env: 'remote' }), 'remote')
  assert.equal(resolveFlavor({ env: 'full' }), 'full')
})

test('resolveFlavor: junk env falls through to file, then default', () => {
  assert.equal(resolveFlavor({ env: 'garbage' }), 'full')
})

test('resolveFlavor: defaults to full with no env and no readable file', () => {
  assert.equal(resolveFlavor({}), 'full')
  assert.equal(resolveFlavor({ candidatePaths: ['/no/such/flavor.json'] }), 'full')
})

test('resolveFlavor: reads a bundled flavor.json when env is unset', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-flavor-'))
  const file = path.join(dir, 'flavor.json')

  try {
    fs.writeFileSync(file, JSON.stringify({ flavor: 'remote' }))
    assert.equal(resolveFlavor({ candidatePaths: [file] }), 'remote')
    // Env still wins over the file.
    assert.equal(resolveFlavor({ env: 'full', candidatePaths: [file] }), 'full')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('readFlavorFile: first valid candidate wins; malformed/missing are skipped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-flavor-'))
  const missing = path.join(dir, 'missing.json')
  const malformed = path.join(dir, 'malformed.json')
  const good = path.join(dir, 'good.json')

  try {
    fs.writeFileSync(malformed, '{ not json')
    fs.writeFileSync(good, JSON.stringify({ flavor: 'remote' }))
    assert.equal(readFlavorFile([missing, malformed, good]), 'remote')
    assert.equal(readFlavorFile([missing, malformed]), null)
    assert.equal(readFlavorFile([]), null)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('flavorIdentity: per-flavor product name + deep-link protocol', () => {
  assert.deepEqual(flavorIdentity('full'), { flavor: 'full', protocol: 'hermes', productName: 'Hermes' })
  assert.deepEqual(flavorIdentity('remote'), {
    flavor: 'remote',
    protocol: 'hermes-remote',
    productName: 'Hermes Remote'
  })
  // Unknown / undefined falls back to the full identity.
  assert.equal(flavorIdentity('nope').protocol, 'hermes')
  assert.equal(flavorIdentity().protocol, 'hermes')
})

test('isRemoteFlavor', () => {
  assert.equal(isRemoteFlavor('remote'), true)
  assert.equal(isRemoteFlavor('full'), false)
  assert.equal(isRemoteFlavor('garbage'), false)
  assert.equal(isRemoteFlavor(undefined), false)
})
