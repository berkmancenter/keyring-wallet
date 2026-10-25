/**
 * A tripwire for the hot-updater version. That the native loader makes no
 * network request at app start (so a build without OTA_UPDATE_URL stays
 * dormant) was established by reading 0.36.18's source, not by anything a test
 * can see. A newer version could move a download onto the launch path while
 * every other check stays green, so a version change must fail here and send
 * whoever made it to re-walk that path first.
 *
 * It reads the INSTALLED packages, not the specs in app/package.json: a spec
 * loosened to a range would keep a manifest check green while the resolved
 * version moved.
 */
import fs from 'fs'
import path from 'path'

const CHECKED_VERSION = '0.36.18'

const RECHECK =
  `The "no network request at app start" property was checked for hot-updater ${CHECKED_VERSION} only. ` +
  'Before changing this version, re-walk the launch path and the download call sites as ' +
  'deploy/keyring-ota/README.md "Upgrading hot-updater" describes, record the result in the PR, ' +
  'run the OTA gate leg, and only then update CHECKED_VERSION here.'

// The app's own packages: the loader, the bundle builder, the publisher's
// storage/database plugin and the CLI.
const APP_PACKAGES = ['@hot-updater/react-native', '@hot-updater/bare', '@hot-updater/standalone', 'hot-updater']

// The server (deploy/keyring-ota) is its own npm package with its own lockfile;
// its update-check routes and the loader are one protocol, so they move together.
const SERVER_PACKAGES = ['@hot-updater/server', 'hot-updater']

const repoRoot = path.resolve(__dirname, '..', '..', '..')

// The installed package.json, found the way Node resolves a package: the nearest
// node_modules upwards (yarn may hoist to the repo root or keep it under app/).
// Read from disk because @hot-updater/react-native does not export
// ./package.json, so require() of it is not portable.
const installedVersion = (name: string): string => {
  let dir = __dirname
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name, 'package.json')
    if (fs.existsSync(candidate)) {
      return JSON.parse(fs.readFileSync(candidate, 'utf8')).version
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error(`${name} is not installed under any node_modules above ${__dirname}`)
    }
    dir = parent
  }
}

const serverLockedVersion = (name: string): string | undefined => {
  const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'deploy', 'keyring-ota', 'package-lock.json'), 'utf8'))
  return lock.packages?.[`node_modules/${name}`]?.version
}

describe('hot-updater version tripwire', () => {
  it.each(APP_PACKAGES)('the app has %s at the checked version', (name) => {
    const version = installedVersion(name)
    if (version !== CHECKED_VERSION) {
      throw new Error(`${name} is installed at ${version}, not ${CHECKED_VERSION}. ${RECHECK}`)
    }
  })

  it.each(SERVER_PACKAGES)('the update server locks %s at the checked version', (name) => {
    const version = serverLockedVersion(name)
    if (version !== CHECKED_VERSION) {
      throw new Error(
        `deploy/keyring-ota/package-lock.json has ${name} at ${
          version ?? 'nothing'
        }, not ${CHECKED_VERSION}. ${RECHECK}`
      )
    }
  })
})
