/**
 * The link a state office's QR or pickup page carries for a Guardian card: `keyring://guardian-card?u=<https URL of
 * the card file>`. Reading it is cheap and pure (no verifier, no network), so the link router can claim it without
 * loading anything; what the URL is allowed to be is decided in ./receiveGuardianCard, against K1's fixed card base.
 *
 * @module sedi/holder/guardianCardLink
 */

export const GUARDIAN_CARD_LINK = 'keyring://guardian-card'

/** Whether `text` is a Guardian card link (by its prefix only; the URL inside may still be refused). */
export function isGuardianCardLink(text: string): boolean {
  const t = text.trim()
  return t === GUARDIAN_CARD_LINK || t.startsWith(`${GUARDIAN_CARD_LINK}?`)
}

/**
 * The card URL a Guardian card link carries, decoded, or undefined when the link has no single `u` parameter. The URL
 * is returned as written; whether it may be fetched is not decided here.
 */
export function guardianCardUrlOf(text: string): string | undefined {
  const t = text.trim()
  if (!t.startsWith(`${GUARDIAN_CARD_LINK}?`)) return undefined
  const params = t.slice(GUARDIAN_CARD_LINK.length + 1).split('&')
  const us = params.filter((p) => p.startsWith('u='))
  if (us.length !== 1) return undefined
  try {
    const url = decodeURIComponent(us[0].slice(2))
    return url.length > 0 ? url : undefined
  } catch {
    return undefined
  }
}
