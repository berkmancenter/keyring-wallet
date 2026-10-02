/**
 * The one line a push wake shows (push notifications plan §3, step 1.6): the
 * gateway sends only the key `KEYRING_WAKE`, and the phone shows its own string
 * for it. It must exist, non-empty, in every language the app ships, on both
 * platforms, and the iOS strings must be in the app bundle. A tap opens the
 * waiting approvals, and only in a build that names a push gateway.
 */
import fs from 'fs'
import path from 'path'

import { APPROVALS_LINK } from '@bifold/core'

import { openApprovalsOnTap } from '@/push/pushHandlers'

const APP = path.join(__dirname, '..', '..')
const KEY = 'KEYRING_WAKE'

const ANDROID = ['values', 'values-fr', 'values-pt-rBR'].map((d) =>
  path.join(APP, 'android', 'app', 'src', 'main', 'res', d, 'strings.xml')
)
const IOS = ['en', 'fr', 'pt-BR'].map((l) => path.join(APP, 'ios', 'AriesBifold', `${l}.lproj`, 'Localizable.strings'))

describe('the wake line', () => {
  it.each(ANDROID)('is an Android string resource in %s', (file) => {
    const match = fs.readFileSync(file, 'utf8').match(new RegExp(`<string name="${KEY}">([^<]+)</string>`))
    expect(match?.[1].trim()).toBeTruthy()
  })

  it.each(IOS)('is an iOS localized string in %s', (file) => {
    const match = fs.readFileSync(file, 'utf8').match(new RegExp(`"${KEY}" = "([^"]+)";`))
    expect(match?.[1].trim()).toBeTruthy()
  })

  it('is in the iOS app bundle in every language', () => {
    const project = fs.readFileSync(path.join(APP, 'ios', 'AriesBifold.xcodeproj', 'project.pbxproj'), 'utf8')
    expect(project).toMatch(/\/\* Localizable\.strings in Resources \*\//)
    for (const lang of ['en', 'fr', 'pt-BR']) {
      expect(project).toContain(`path = AriesBifold/${lang}.lproj/Localizable.strings;`)
    }
  })
})

describe('tapping the wake notification', () => {
  function source(initial: unknown | null) {
    let listener: ((m: unknown) => void) | undefined
    return {
      onNotificationOpenedApp: jest.fn((l: (m: unknown) => void) => {
        listener = l
        return jest.fn()
      }),
      getInitialNotification: jest.fn(async () => initial),
      tap: () => listener?.({}),
    }
  }

  it('does nothing in a build that names no push gateway', () => {
    const s = source({})
    const openLink = jest.fn()
    expect(openApprovalsOnTap(undefined, s, openLink)).toBeUndefined()
    expect(s.onNotificationOpenedApp).not.toHaveBeenCalled()
    expect(s.getInitialNotification).not.toHaveBeenCalled()
  })

  it('opens the approvals when a running app is tapped', async () => {
    const s = source(null)
    const openLink = jest.fn()
    openApprovalsOnTap('https://push.example.org', s, openLink)
    await Promise.resolve()
    expect(openLink).not.toHaveBeenCalled()
    s.tap()
    expect(openLink).toHaveBeenCalledTimes(1)
  })

  it('opens the approvals when the tap launched the app', async () => {
    const s = source({ data: { v: '1' } })
    const openLink = jest.fn()
    openApprovalsOnTap('https://push.example.org', s, openLink)
    await new Promise((r) => setImmediate(r))
    expect(openLink).toHaveBeenCalledTimes(1)
  })
})

// On iOS the gateway's wake goes straight to APNs, so Firebase messaging never
// reports its tap; the app's own notification delegate does (AppDelegate.mm).
// It is native code no jest test runs, so this pins the two values it shares
// with the rest of the app: the wake's string key and the approvals link.
describe('the iOS notification delegate', () => {
  const delegate = fs.readFileSync(path.join(APP, 'ios', 'AriesBifold', 'AppDelegate.mm'), 'utf8')

  it('recognises the wake by the same string key', () => {
    expect(delegate).toContain(`isEqual:@"${KEY}"`)
  })

  it("opens bifold's approvals link", () => {
    expect(delegate).toContain(`KeyringApprovalsLink = @"${APPROVALS_LINK}";`)
  })

  it('handles a tap on a running app and a tap that launched it', () => {
    expect(delegate).toContain('didReceiveNotificationResponse:')
    expect(delegate).toContain('UIApplicationLaunchOptionsRemoteNotificationKey')
  })
})
