/**
 * No third-party registration before the person opts in. Firebase messaging's
 * automatic start is off in `firebase.json`, and the platform push service is
 * contacted only by the three steps in pushPlatform.ts: turned on, turned off,
 * and a later launch by a person who has notifications on.
 */
import fs from 'fs'
import path from 'path'

import {
  resumePlatformPush,
  startPlatformPush,
  stopPlatformPush,
  waitForApnsToken,
  watchForToken,
  watchForTokenRefresh,
  LATE_TOKEN_POLL_MS,
  LATE_TOKEN_WATCH_MS,
  type PlatformMessaging,
} from '@/push/pushPlatform'

const APP = path.join(__dirname, '..', '..')

function fakeMessaging() {
  const calls: string[] = []
  const m: PlatformMessaging = {
    setAutoInitEnabled: jest.fn(async (enabled: boolean) => void calls.push(`setAutoInitEnabled(${enabled})`)),
    deleteToken: jest.fn(async () => void calls.push('deleteToken')),
    registerDeviceForRemoteMessages: jest.fn(async () => void calls.push('registerDeviceForRemoteMessages')),
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

  it('on iOS leaves the Apple registration alone, so turning them on again works', async () => {
    const { m, calls } = fakeMessaging()
    await stopPlatformPush('ios', m)
    expect(calls).toEqual([])
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

describe("reading Apple's token after registering", () => {
  const noSleep = jest.fn(async () => undefined)

  it('returns it at once when it is already there', async () => {
    const get = jest.fn(async () => 'apns-token')
    await expect(waitForApnsToken(get, { sleep: noSleep })).resolves.toBe('apns-token')
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('waits for it when it arrives just after registering (first switch-on, measured on an iPhone 11)', async () => {
    const get = jest.fn<Promise<string | null>, []>().mockResolvedValueOnce(null).mockResolvedValue('apns-token')
    await expect(waitForApnsToken(get, { sleep: noSleep })).resolves.toBe('apns-token')
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('gives up after the wait, so a phone Apple never answers still finishes', async () => {
    const get = jest.fn(async () => null)
    await expect(waitForApnsToken(get, { waitMs: 1000, pollMs: 250, sleep: noSleep })).resolves.toBeNull()
    expect(get).toHaveBeenCalledTimes(5)
  })
})

describe('watching for a token that arrives late (IN-277)', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate'] }))
  afterEach(() => jest.useRealTimers())
  const flush = () => new Promise((resolve) => setImmediate(resolve))
  const tick = async (ms: number) => {
    jest.advanceTimersByTime(ms)
    await flush()
  }

  it('reads the token on each poll and says once when it is there, then stops reading', async () => {
    const getToken = jest.fn(async (): Promise<string | null> => null)
    const arrived = jest.fn()
    watchForToken(getToken, arrived)
    await tick(LATE_TOKEN_POLL_MS)
    await tick(LATE_TOKEN_POLL_MS)
    expect(arrived).not.toHaveBeenCalled()
    getToken.mockResolvedValue('apns-token')
    await tick(LATE_TOKEN_POLL_MS)
    expect(arrived).toHaveBeenCalledTimes(1)
    const reads = getToken.mock.calls.length
    await tick(10 * LATE_TOKEN_POLL_MS)
    expect(getToken).toHaveBeenCalledTimes(reads)
    expect(arrived).toHaveBeenCalledTimes(1)
  })

  it('gives up after its watch, and a read that fails is no token', async () => {
    const getToken = jest.fn(async (): Promise<string | null> => {
      throw new Error('not yet')
    })
    const arrived = jest.fn()
    watchForToken(getToken, arrived)
    await tick(LATE_TOKEN_WATCH_MS)
    const reads = getToken.mock.calls.length
    expect(reads).toBe(LATE_TOKEN_WATCH_MS / LATE_TOKEN_POLL_MS)
    await tick(10 * LATE_TOKEN_POLL_MS)
    expect(getToken).toHaveBeenCalledTimes(reads)
    expect(arrived).not.toHaveBeenCalled()
  })

  it('stopping stops it', async () => {
    const getToken = jest.fn(async () => 'apns-token')
    const arrived = jest.fn()
    const stop = watchForToken(getToken, arrived)
    stop()
    await tick(5 * LATE_TOKEN_POLL_MS)
    expect(getToken).not.toHaveBeenCalled()
    expect(arrived).not.toHaveBeenCalled()
  })
})

// 54's review of #505: on Android the token read is a call to Firebase's
// servers, so the late-token watch listens for `onTokenRefresh` instead of
// polling it every 15 s for half an hour.
describe('watching for a late token on Android: listen, do not poll', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate'] }))
  afterEach(() => jest.useRealTimers())
  const flush = () => new Promise((resolve) => setImmediate(resolve))

  function firebase(initial: string | null = null) {
    let listener: ((token: string) => void) | undefined
    const unsubscribe = jest.fn(() => {
      listener = undefined
    })
    const getToken = jest.fn(async () => initial)
    const onTokenRefresh = jest.fn((l: (token: string) => void) => {
      listener = l
      return unsubscribe
    })
    return { getToken, onTokenRefresh, unsubscribe, refresh: (t: string) => listener?.(t), listening: () => !!listener }
  }

  it('reads once, then waits for Firebase to say a token was issued, and stops listening', async () => {
    const fb = firebase()
    const arrived = jest.fn()
    watchForTokenRefresh(fb.getToken, fb.onTokenRefresh, arrived)
    await flush()
    expect(arrived).not.toHaveBeenCalled()
    jest.advanceTimersByTime(10 * LATE_TOKEN_POLL_MS)
    await flush()
    // No polling: the one read at the start, and nothing after it.
    expect(fb.getToken).toHaveBeenCalledTimes(1)
    fb.refresh('fcm-token')
    expect(arrived).toHaveBeenCalledTimes(1)
    expect(fb.unsubscribe).toHaveBeenCalledTimes(1)
    fb.refresh('fcm-token-2')
    expect(arrived).toHaveBeenCalledTimes(1)
  })

  it('a token already there when it starts is said at once', async () => {
    const fb = firebase('fcm-token')
    const arrived = jest.fn()
    watchForTokenRefresh(fb.getToken, fb.onTokenRefresh, arrived)
    await flush()
    expect(arrived).toHaveBeenCalledTimes(1)
    expect(fb.listening()).toBe(false)
  })

  it('a listener Firebase calls while subscribing still unsubscribes, and says it once', async () => {
    const unsubscribe = jest.fn()
    const onTokenRefresh = jest.fn((l: (token: string) => void) => {
      l('fcm-token')
      return unsubscribe
    })
    const arrived = jest.fn()
    watchForTokenRefresh(async () => 'fcm-token', onTokenRefresh, arrived)
    await flush()
    expect(arrived).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('gives up after its watch, and stopping stops it', async () => {
    const fb = firebase()
    const arrived = jest.fn()
    watchForTokenRefresh(fb.getToken, fb.onTokenRefresh, arrived)
    jest.advanceTimersByTime(LATE_TOKEN_WATCH_MS)
    await flush()
    expect(fb.listening()).toBe(false)
    fb.refresh('fcm-token')
    expect(arrived).not.toHaveBeenCalled()

    const fb2 = firebase()
    const stop = watchForTokenRefresh(fb2.getToken, fb2.onTokenRefresh, arrived)
    stop()
    expect(fb2.listening()).toBe(false)
    fb2.refresh('fcm-token')
    await flush()
    expect(arrived).not.toHaveBeenCalled()
  })
})
