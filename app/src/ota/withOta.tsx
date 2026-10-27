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
import { onReturnLocked, otaApplyBlockerReasons } from '@bifold/core'
import { HotUpdater } from '@hot-updater/react-native'
import React from 'react'
import { Platform } from 'react-native'
import { getBuildNumber } from 'react-native-device-info'

import { decideApplyOnReturn } from './applyOnReturn'
import { isolationKeyFor, readStagedUpdate, StagedUpdate } from './stagedUpdate'

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

  // A staged update waits for the next cold start, or for a return to the PIN
  // screen after a while away (applyOnReturn.ts). Nothing is kept between
  // returns: each reads what hot-updater has staged right then (stagedUpdate.ts).
  onReturnLocked(async (awayMs) => {
    // Taken now, before anything is awaited. Locking out unmounts the screens that
    // hold a blocker (a chat with an unsent draft), and with an update staged the
    // metadata read below lasts long enough for that unmount to release them: read
    // only after it, a draft never held a staged update back (a 273 device, 10-26).
    const blockersAtReturn = otaApplyBlockerReasons()
    // bifold drops a listener's failure without a word; logged here, so a return
    // that stopped checking shows in a problem report.
    try {
      const isolationKey = isolationKeyFor({
        platform: Platform.OS,
        fingerprint: HotUpdater.getFingerprintHash(),
        appVersion: HotUpdater.getAppVersion(),
        buildNumber: getBuildNumber(),
        // The build's own channel, as the natives compose the key. In 0.36.18 this
        // is the DEFAULT_CHANNEL constant: on Android HotUpdaterImpl.getChannel(context),
        // the manifest's value, which MainApplication.kt composes with too; on iOS the
        // Info.plist's, as AppDelegate.mm. A channel switched at runtime is kept in the
        // preferences under the key and never changes it.
        channel: HotUpdater.getDefaultChannel(),
      })
      let staged: StagedUpdate
      let readError: string | undefined
      try {
        staged = await readStagedUpdate(isolationKey)
      } catch (error) {
        staged = {}
        readError = String(error)
      }
      // Those held at the return and those held now, right before deciding: a flow
      // that began during the read blocks this return too. By kind only, for the
      // decision's reason and the log alike: a VTA task's blocker names its Trust
      // Task type (vta-task:<type>), and this line, in every problem report, need
      // not say which flow the person was in.
      const blockers = [
        ...new Set([...blockersAtReturn, ...otaApplyBlockerReasons()].map((blocker) => blocker.split(':')[0])),
      ]
      const decision = decideApplyOnReturn({
        awayMs,
        stagedBundleId: staged.id,
        stagedUnderKey: staged.stagedUnderKey,
        runningBundleId: HotUpdater.getBundleId(),
        blockers,
        platform: Platform.OS,
      })
      // Logged every time, so a reader that stops finding the staged update (a
      // hot-updater change to its metadata, or a key composed differently here)
      // shows here instead of failing silently. The key composed here is always
      // there to compare with the metadata file's, staged or not, and so are the
      // blockers held at the return, whatever decided it: what a device check
      // reads to see a flow (a chat draft) still held behind the lock screen.
      log('return', {
        staged: staged.id ?? null,
        awayMinutes: Math.round(awayMs / 60000),
        apply: decision.apply,
        ...(decision.apply ? {} : { reason: decision.reason }),
        isolationKey,
        blockers,
        ...(staged.stagedUnderKey ? { stagedUnderKey: staged.stagedUnderKey } : {}),
        ...(readError ? { readError } : {}),
      })
      if (!decision.apply) return
      await HotUpdater.reload()
    } catch (error) {
      log('apply on return failed', { error: String(error) })
    }
  })

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
