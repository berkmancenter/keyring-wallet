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
 * A tapped wake notification opens the waiting approvals, and only that: the
 * notification carries no content, so the approval is fetched after the wallet
 * is unlocked. Handles a tap on a running app and one that launched it (a cold
 * start). Registered only in a build that names a push gateway.
 */
export function openApprovalsOnTap(
  gatewayUrl: string | undefined,
  source: NotificationOpenSource,
  openLink: () => void
): (() => void) | undefined {
  if (!gatewayUrl?.trim()) return undefined
  const unsubscribe = source.onNotificationOpenedApp(() => openLink())
  void source.getInitialNotification().then((message) => {
    if (message) openLink()
  })
  return unsubscribe
}
