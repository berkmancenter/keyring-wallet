/**
 * What the app does when a push wake-up arrives (push notifications plan §2,
 * step 1.6). A wake carries no content, only hints (`v`, `mediator`, `count`,
 * `urgency`), and the handler never opens the agent, starts message pickup or
 * reads the wallet: the approval itself is fetched when the person opens the
 * app. The wake is logged; the visible notification itself is shown by the
 * system from the app's own `KEYRING_WAKE` string (Localizable.strings on iOS,
 * a string resource on Android), so no code here displays anything.
 */

interface WakeMessage {
  data?: Record<string, unknown>
}

/** The wake's hints, read as untrusted: only the known fields, as strings. */
export function wakeHints(message: WakeMessage): Record<string, string> {
  const hints: Record<string, string> = {}
  for (const key of ['v', 'mediator', 'count', 'urgency']) {
    const value = message.data?.[key]
    if (typeof value === 'string' || typeof value === 'number') hints[key] = String(value)
  }
  return hints
}

export function onPushWake(
  where: 'background' | 'foreground',
  message: WakeMessage,
  log: (message: string, data?: Record<string, unknown>) => void
): void {
  log(`push wake received (${where})`, wakeHints(message))
}

/** The parts of Firebase messaging a notification tap arrives through. */
export interface NotificationOpenSource {
  onNotificationOpenedApp(listener: (message: unknown) => void): () => void
  getInitialNotification(): Promise<unknown | null>
}

/**
 * The prefix of a message wake's collapse id. The gateway gives every wake for
 * a message waiting at the mediator its own (`keyring-msg-<random>`, gateway
 * patch 0003); approval wakes share the configured `keyring-wake`.
 */
export const MESSAGE_WAKE_PREFIX = 'keyring-msg-'

export type TapKind = 'approvals' | 'messages'

/**
 * What a tapped wake was for, read from its collapse id as Firebase hands the
 * tap over: `threadId` (the APNs `thread-id`) on iOS, `collapseKey` on
 * Android. Anything else, including a wake from before message wakes, opens
 * the approvals, as every wake did before.
 */
export function tapKind(message: unknown): TapKind {
  const m = message as { threadId?: unknown; collapseKey?: unknown } | null
  const id = typeof m?.threadId === 'string' ? m.threadId : m?.collapseKey
  return typeof id === 'string' && id.startsWith(MESSAGE_WAKE_PREFIX) ? 'messages' : 'approvals'
}

/**
 * A tapped wake notification opens the waiting approvals, or the Messages tab
 * for a message wake ({@link tapKind}), and only that: the notification carries
 * no content, so what waits is fetched after the wallet is unlocked. Handles a
 * tap on a running app and one that launched it (a cold start). Registered
 * only in a build that names a push gateway.
 */
export function openApprovalsOnTap(
  gatewayUrl: string | undefined,
  source: NotificationOpenSource,
  openLink: (kind: TapKind) => void
): (() => void) | undefined {
  if (!gatewayUrl?.trim()) return undefined
  const unsubscribe = source.onNotificationOpenedApp((message) => openLink(tapKind(message)))
  void source.getInitialNotification().then((message) => {
    if (message) openLink(tapKind(message))
  })
  return unsubscribe
}
