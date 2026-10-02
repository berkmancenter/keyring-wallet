/**
 * No third-party registration before the person opts in. Firebase messaging's
 * automatic start is off in `firebase.json`, and the platform push service is
 * contacted only by the three steps in pushPlatform.ts: turned on, turned off,
 * and a later launch by a person who has notifications on.
 */
import fs from 'fs'
import path from 'path'

import { resumePlatformPush, startPlatformPush, stopPlatformPush, type PlatformMessaging } from '@/push/pushPlatform'

const APP = path.join(__dirname, '..', '..')

function fakeMessaging() {
  const calls: string[] = []
  const m: PlatformMessaging = {
    setAutoInitEnabled: jest.fn(async (enabled: boolean) => void calls.push(`setAutoInitEnabled(${enabled})`)),
    deleteToken: jest.fn(async () => void calls.push('deleteToken')),
    registerDeviceForRemoteMessages: jest.fn(async () => void calls.push('registerDeviceForRemoteMessages')),
    unregisterDeviceForRemoteMessages: jest.fn(async () => void calls.push('unregisterDeviceForRemoteMessages')),
  }
  return { m, calls }
}

describe("Firebase messaging's automatic start", () => {
  const config = JSON.parse(fs.readFileSync(path.join(APP, 'firebase.json'), 'utf8'))['react-native']

  it('is off on Android: no registration token is obtained at launch', () => {
    expect(config.messaging_auto_init_enabled).toBe(false)
  })

  it('is off on iOS: the app does not register for remote notifications at launch', () => {
    expect(config.messaging_ios_auto_register_for_remote_messages).toBe(false)
  })
})

describe('the app source', () => {
  // The only callers of the calls that create or fetch a platform token.
  const ALLOWED = ['src/push/pushPlatform.ts', 'src/push/pushDefaults.ts']
  const TOKEN_CALLS = /\.(getToken|getAPNSToken|registerDeviceForRemoteMessages|setAutoInitEnabled)\(/

  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return sourceFiles(full)
      return /\.(ts|tsx|js)$/.test(entry.name) ? [full] : []
    })
  }

  it('fetches or enables a platform token nowhere else', () => {
    const files = [...sourceFiles(path.join(APP, 'src')), path.join(APP, 'App.tsx'), path.join(APP, 'index.js')]
    const offenders = files
      .filter((f) => fs.existsSync(f))
      .map((f) => path.relative(APP, f))
      .filter((rel) => !ALLOWED.includes(rel))
      .filter((rel) => TOKEN_CALLS.test(fs.readFileSync(path.join(APP, rel), 'utf8')))
    expect(offenders).toEqual([])
  })
})

describe('turning notifications on', () => {
  it('on Android turns auto-initialisation on, and nothing else', async () => {
    const { m, calls } = fakeMessaging()
    await startPlatformPush('android', m)
    expect(calls).toEqual(['setAutoInitEnabled(true)'])
  })

  it('on iOS registers with Apple, and leaves Firebase auto-initialisation off', async () => {
    const { m, calls } = fakeMessaging()
    await startPlatformPush('ios', m)
    expect(calls).toEqual(['registerDeviceForRemoteMessages'])
  })
})

describe('turning notifications off', () => {
  it('on Android deletes the token, then turns auto-initialisation off', async () => {
    const { m, calls } = fakeMessaging()
    await stopPlatformPush('android', m)
    expect(calls).toEqual(['deleteToken', 'setAutoInitEnabled(false)'])
  })

  it('on iOS unregisters from remote notifications', async () => {
    const { m, calls } = fakeMessaging()
    await stopPlatformPush('ios', m)
    expect(calls).toEqual(['unregisterDeviceForRemoteMessages'])
  })
})

describe('a later launch', () => {
  it.each([
    ['a build that names no gateway', { gatewayUrl: undefined, optedIn: true, os: 'ios' }],
    ['a build whose gateway is blank', { gatewayUrl: '  ', optedIn: true, os: 'ios' }],
    [
      'a person who never turned notifications on (iOS)',
      { gatewayUrl: 'https://push.example.org', optedIn: false, os: 'ios' },
    ],
    [
      'a person who never turned notifications on (Android)',
      { gatewayUrl: 'https://push.example.org', optedIn: false, os: 'android' },
    ],
  ])('makes no call for %s', async (_name, input) => {
    const { m, calls } = fakeMessaging()
    await expect(resumePlatformPush(input, m)).resolves.toBe(false)
    expect(calls).toEqual([])
  })

  it('registers with Apple again for a person who has notifications on (iOS)', async () => {
    const { m, calls } = fakeMessaging()
    await expect(
      resumePlatformPush({ gatewayUrl: 'https://push.example.org', optedIn: true, os: 'ios' }, m)
    ).resolves.toBe(true)
    expect(calls).toEqual(['registerDeviceForRemoteMessages'])
  })

  it('does nothing on Android: the library kept auto-initialisation on since the opt-in', async () => {
    const { m, calls } = fakeMessaging()
    await expect(
      resumePlatformPush({ gatewayUrl: 'https://push.example.org', optedIn: true, os: 'android' }, m)
    ).resolves.toBe(false)
    expect(calls).toEqual([])
  })
})
