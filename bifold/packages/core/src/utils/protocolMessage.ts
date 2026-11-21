/**
 * Whether a basic message's content is protocol traffic rather than chat: a
 * JSON payload, or the plain-text relationship-DID announcement
 * ("This is my relationship DID: vrc:relationshipDid:… vrc:rceVersion:N") and
 * other `vrc:` pings. The chat screen hides these; the Messages badge, a
 * tapped notification, the in-app toast and the notification cards (here and
 * in the wallet's own notifications hook) must not count them either, so they
 * all use this one predicate.
 */
export function isProtocolMessage(content: string): boolean {
  if (content.includes('vrc:relationshipDid:') || content.startsWith('vrc:')) return true
  try {
    const parsed = JSON.parse(content)
    return typeof parsed === 'object' && parsed !== null && ('type' in parsed || '@type' in parsed)
  } catch {
    return false
  }
}
