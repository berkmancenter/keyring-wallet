/**
 * What the app does when a push wake-up arrives (push notifications plan §2,
 * step 1.6). A wake carries no content, only hints (`v`, `mediator`, `count`,
 * `urgency`), and the handler never opens the agent, starts message pickup or
 * reads the wallet: the approval itself is fetched when the person opens the
 * app. For now the wake is logged; showing the generic notification needs a
 * local-notification library, which comes in a later build.
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
