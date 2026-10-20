/**
 * Wraps the app root with the update loader when the build names an update
 * server; otherwise returns the root unchanged and the loader stays idle (the
 * native side then always starts the bundle the store build shipped with).
 *
 * What the wrapper does, per the OTA plan:
 * - checks for an update at start, for this install's ring and native fingerprint;
 * - downloads a newer bundle in the background and stages it for the next cold
 *   start, never mid-session (reloadOnForceUpdate: false, so even a bundle the
 *   server marks "force" waits for the next start);
 * - runs a new bundle on trial until its first screen renders; a crash, hang or
 *   kill before that rolls the next start back to the previous bundle.
 * The loader verifies each bundle's RSA signature against the public key in the
 * binary before installing it, and refuses unsigned bundles when a key is present.
 *
 * That the native loader makes no network request at app start when this wrapper
 * stays idle was checked for @hot-updater/react-native 0.36.18 only: a version
 * bump re-checks it (deploy/keyring-ota/README.md, "Upgrading hot-updater").
 */
import { HotUpdater } from '@hot-updater/react-native'
import React from 'react'

import { otaUpdateUrl } from './otaConfig'
import { ensureRing } from './rings'

type Log = (message: string, data?: Record<string, unknown>) => void

const defaultLog: Log = (message, data) => {
  // The log buffer (utils/logBuffer) captures console output for problem reports.
  // eslint-disable-next-line no-console
  console.info(`[ota] ${message}`, data ?? '')
}

export const withOta = <P extends object>(
  App: React.ComponentType<P>,
  url: string | undefined = otaUpdateUrl(),
  log: Log = defaultLog
): React.ComponentType<P> => {
  if (!url) return App

  try {
    const ring = ensureRing(HotUpdater)
    log('enabled', { ring, bundleId: HotUpdater.getBundleId(), channel: HotUpdater.getChannel() })
  } catch (error) {
    // A binary without the loader's native module: run as a build without OTA.
    log('loader unavailable, running without updates', { error: String(error) })
    return App
  }

  return HotUpdater.wrap({
    baseURL: url,
    updateStrategy: 'fingerprint',
    reloadOnForceUpdate: false,
    // The loader's default is 5 s; on a slow network (2 s a request on a plane,
    // seen in the spike) checks timed out. A timeout is safe (the app runs what
    // it has) but should not be the norm.
    requestTimeout: 15000,
    onUpdateProcessCompleted: ({ status, id, shouldForceUpdate }) =>
      log('check finished', { status, id, shouldForceUpdate }),
    onError: (error) => log('update failed', { error: String(error) }),
  })(App) as React.ComponentType<P>
}
