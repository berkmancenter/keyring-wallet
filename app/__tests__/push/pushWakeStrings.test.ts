/**
 * The one line a push wake shows (push notifications plan §3, step 1.6): the
 * gateway sends only the key `KEYRING_WAKE`, and the phone shows its own string
 * for it. It must exist, non-empty, in every language the app ships, on both
 * platforms, and the iOS strings must be in the app bundle. A tap opens the
 * waiting approvals, and only in a build that names a push gateway.
 */
import fs from 'fs'
import path from 'path'

import { APPROVALS_LINK, MESSAGES_LINK } from '@bifold/core'

import { MESSAGE_WAKE_PREFIX, openApprovalsOnTap, tapKind } from '@/push/pushHandlers'

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
      // Xcode and CocoaPods quote a path that has a hyphen in it (pt-BR).
      expect(project).toMatch(new RegExp(`path = "?AriesBifold/${lang}\\.lproj/Localizable\\.strings"?;`))
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

describe('what a tapped wake opens', () => {
  it('a message wake opens the Messages tab, on either platform', () => {
    expect(tapKind({ threadId: 'keyring-msg-0a1b' })).toBe('messages')
    expect(tapKind({ collapseKey: 'keyring-msg-0a1b' })).toBe('messages')
  })

  it('an approval wake, or anything unknown, opens the approvals', () => {
    expect(tapKind({ threadId: 'keyring-wake' })).toBe('approvals')
    expect(tapKind({ collapseKey: 'keyring-wake' })).toBe('approvals')
    expect(tapKind({ data: { v: '1' } })).toBe('approvals')
    expect(tapKind({})).toBe('approvals')
    expect(tapKind(null)).toBe('approvals')
    expect(tapKind({ threadId: 42 })).toBe('approvals')
  })

  it('passes the kind to the link it opens, for a running app and a cold start', async () => {
    let listener: ((m: unknown) => void) | undefined
    const s = {
      onNotificationOpenedApp: (l: (m: unknown) => void) => {
        listener = l
        return () => undefined
      },
      getInitialNotification: async () => ({ collapseKey: 'keyring-msg-1' }),
    }
    const openLink = jest.fn()
    openApprovalsOnTap('https://push.example.org', s, openLink)
    await new Promise((r) => setImmediate(r))
    listener?.({ threadId: 'keyring-wake' })
    expect(openLink.mock.calls).toEqual([['messages'], ['approvals']])
  })
})

// On Android Firebase reads a tap that launched the app from the current
// activity's intent, which does not exist yet while modules load: called there,
// the cold-start tap was dropped and the app opened on My Agent (232).
describe('where App registers the tap', () => {
  const app = fs.readFileSync(path.join(APP, 'App.tsx'), 'utf8')

  it('is inside the App component, after it has mounted, not at module load', () => {
    const component = app.indexOf('const App = () => {')
    const call = app.indexOf('openApprovalsOnTap(Config.PUSH_GATEWAY_URL')
    expect(component).toBeGreaterThan(-1)
    expect(call).toBeGreaterThan(component)
    expect(app.slice(component, call)).toMatch(/useEffect\(\s*\(\) =>\s*$/)
    expect(app.split('openApprovalsOnTap(').length - 1).toBe(1)
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

  it('opens the Messages tab for a message wake, by the same prefix the app reads', () => {
    expect(delegate).toContain(`KeyringMessagesLink = @"${MESSAGES_LINK}";`)
    expect(delegate).toContain(`hasPrefix:@"${MESSAGE_WAKE_PREFIX}"`)
    expect(delegate).toContain('URLWithString:KeyringWakeLink(launchNotification)')
    expect(delegate).toContain('URLWithString:KeyringWakeLink(userInfo)')
  })

  it('handles a tap on a running app and a tap that launched it', () => {
    expect(delegate).toContain('didReceiveNotificationResponse:')
    expect(delegate).toContain('UIApplicationLaunchOptionsRemoteNotificationKey')
  })
})
