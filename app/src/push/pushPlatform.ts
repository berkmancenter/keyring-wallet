/**
 * When the phone's platform push service (Firebase Cloud Messaging, Apple Push
 * Notification service) first hears of this install, and when it stops.
 *
 * Left to its defaults, Firebase messaging starts at every launch: on Android
 * it obtains a registration token straight away, and on iOS it registers the
 * app for remote notifications. That is a registration with a third party
 * before the person has been asked anything. `app/firebase.json` turns both
 * defaults off, and this module is the only place they are turned back on:
 *
 * - {@link startPlatformPush}: the person turned notifications on.
 * - {@link stopPlatformPush}: the person turned them off again.
 * - {@link resumePlatformPush}: a later launch by a person who has them on.
 *
 * A build that names no push gateway, and a person who never turned
 * notifications on, never reach any of them.
 */

/** The parts of Firebase messaging these three steps use. */
export interface PlatformMessaging {
  setAutoInitEnabled(enabled: boolean): Promise<void>
  deleteToken(): Promise<void>
  registerDeviceForRemoteMessages(): Promise<void>
}

export type PushOs = 'ios' | 'android' | string

/**
 * The person turned notifications on: let the platform issue this install a
 * token. Call it before reading the token.
 *
 * - Android: turn Firebase's auto-initialisation on. The setting is kept by
 *   the library, so later launches refresh the token without being asked.
 * - iOS: register with Apple for remote notifications. Firebase's own
 *   initialisation stays off: the gateway sends to Apple directly, with the
 *   Apple token, and needs no Firebase token on iOS.
 */
export async function startPlatformPush(os: PushOs, messaging: PlatformMessaging): Promise<void> {
  if (os === 'ios') {
    await messaging.registerDeviceForRemoteMessages()
    return
  }
  await messaging.setAutoInitEnabled(true)
}

/** How long {@link waitForApnsToken} waits for Apple's token, and how often it looks. */
export const APNS_TOKEN_WAIT_MS = 10_000
export const APNS_TOKEN_POLL_MS = 250

/**
 * The APNs device token, waiting for it when Apple has not handed it over yet.
 *
 * On a first registration `registerDeviceForRemoteMessages` can resolve before
 * the token reaches the app. Measured on an iPhone 11 (TestFlight 235): the app
 * read the token 11 ms before it arrived, found none, and the first switch-on
 * registered nothing, while a second switch-on worked. So a missing token is
 * looked for again until it arrives or {@link APNS_TOKEN_WAIT_MS} has passed.
 */
export async function waitForApnsToken(
  getToken: () => Promise<string | null>,
  opts: { waitMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<string | null> {
  const waitMs = opts.waitMs ?? APNS_TOKEN_WAIT_MS
  const pollMs = opts.pollMs ?? APNS_TOKEN_POLL_MS
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let token = await getToken()
  for (let waited = 0; !token && waited < waitMs; waited += pollMs) {
    await sleep(pollMs)
    token = await getToken()
  }
  return token
}

/** How often, and for how long, {@link watchForToken} looks for a late token. */
export const LATE_TOKEN_POLL_MS = 15_000
export const LATE_TOKEN_WATCH_MS = 30 * 60_000

/**
 * Look for the platform token every {@link LATE_TOKEN_POLL_MS} until it is
 * there, then call `arrived` once. Gives up after {@link LATE_TOKEN_WATCH_MS};
 * returns a stop.
 *
 * Only a read of what the platform already handed over: it registers nothing
 * and asks nobody, so it is cheap to leave running while the app is open. For
 * the token that arrives after every try has given up (IN-277): Apple handed
 * one tester's install its token minutes after registering.
 */
export function watchForToken(
  getToken: () => Promise<string | null | undefined>,
  arrived: () => void,
  opts: { pollMs?: number; watchMs?: number } = {}
): () => void {
  const pollMs = opts.pollMs ?? LATE_TOKEN_POLL_MS
  const watchMs = opts.watchMs ?? LATE_TOKEN_WATCH_MS
  let done = false
  let waited = 0
  const stop = () => {
    done = true
    clearInterval(timer)
  }
  const timer = setInterval(() => {
    waited += pollMs
    void getToken()
      .catch(() => null)
      .then((token) => {
        if (done) return
        if (token) {
          stop()
          arrived()
        } else if (waited >= watchMs) stop()
      })
  }, pollMs)
  return stop
}

/**
 * The Android counterpart of {@link watchForToken}: Firebase's token read is a
 * network call there, not a local read, so polling it every
 * {@link LATE_TOKEN_POLL_MS} would ask Google's servers ~120 times in the
 * watch. Instead: one read now, in case the token turned up just before this
 * was called, then Firebase's own `onTokenRefresh`, which fires when a token
 * is issued. Gives up after {@link LATE_TOKEN_WATCH_MS}; returns a stop.
 */
export function watchForTokenRefresh(
  getToken: () => Promise<string | null | undefined>,
  onTokenRefresh: (listener: (token: string) => void) => () => void,
  arrived: () => void,
  opts: { watchMs?: number } = {}
): () => void {
  let done = false
  // Held in an object so `stop` can reach the unsubscribe however early it
  // runs, including from a listener Firebase calls while still subscribing.
  const subscription: { off?: () => void } = {}
  const stop = () => {
    if (done) return
    done = true
    clearTimeout(timer)
    subscription.off?.()
  }
  const once = () => {
    if (done) return
    stop()
    arrived()
  }
  const timer = setTimeout(stop, opts.watchMs ?? LATE_TOKEN_WATCH_MS)
  subscription.off = onTokenRefresh((token) => {
    if (token) once()
  })
  // Stopped while subscribing: unsubscribe now that there is something to drop.
  if (done) subscription.off()
  void getToken()
    .catch(() => null)
    .then((token) => {
      if (token) once()
    })
  return stop
}

/**
 * The person turned notifications off: withdraw what {@link startPlatformPush}
 * set up. What stops the wakes is the agent clearing this device's channel;
 * this step only withdraws the platform token where that can be undone.
 *
 * - Android: delete the Firebase token and turn auto-initialisation off. Turning
 *   notifications on again issues a fresh token.
 * - iOS: nothing. Unregistering from Apple cannot be undone reliably: on a
 *   device that turned notifications off and on again, Apple accepted every
 *   wake for the token the app registered and the phone dropped each one,
 *   because iOS no longer held that token. Apple's own guidance is to
 *   unregister only when the app will never take remote notifications again.
 */
export async function stopPlatformPush(os: PushOs, messaging: PlatformMessaging): Promise<void> {
  if (os === 'ios') return
  await messaging.deleteToken()
  await messaging.setAutoInitEnabled(false)
}

export interface ResumeInput {
  /** The build's push gateway; empty or undefined means push is off. */
  gatewayUrl?: string
  /** Whether the person has notifications turned on (the Settings switch). */
  optedIn: boolean
  os: PushOs
}

/**
 * A launch by a person who already has notifications on, in a build that names
 * a gateway. Returns whether anything was done.
 *
 * - iOS: register with Apple again. Apple asks for this at every launch, and a
 *   background wake is not delivered to an app that did not register.
 * - Android: nothing. Auto-initialisation was turned on when they opted in and
 *   the library keeps it on.
 */
export async function resumePlatformPush(input: ResumeInput, messaging: PlatformMessaging): Promise<boolean> {
  if (!input.gatewayUrl?.trim() || !input.optedIn) return false
  if (input.os !== 'ios') return false
  await messaging.registerDeviceForRemoteMessages()
  return true
}
