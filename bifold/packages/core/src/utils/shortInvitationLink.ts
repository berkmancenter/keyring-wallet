/**
 * The short invitation link: the invitation is stored on our links service and
 * shared as /i/<id>, about 56 characters, instead of a ~950-character link
 * that has to survive being carried and selected whole (build 265: AirDropped
 * as text, selected by hand, cut). The receiver's Credo fetches it back
 * (`parseInvitationShortUrl`, Accept: application/json), so nothing more is
 * needed on that side than letting the link through.
 *
 * The service's contract (keyring-wallet `deploy/keyring-links/README.md`):
 * POST /i {"invitation": …} → 201 {"url", "expiresAt"}; GET /i/<id> → the
 * invitation as JSON, or a browser's redirect to the install page; kept seven
 * days, not consumed on fetch. Anything but a 201 naming one of ours, or no
 * answer in time, gives no short link, and the long one is shared as before.
 *
 * @module utils/shortInvitationLink
 */
import { domain } from '../constants'
import { releaseWarn } from '../modules/trust-tasks/module/releaseLog'

/** Where the links service lives: the host the long invitation links already use. */
export const LINKS_ORIGIN = domain.replace(/^(https?:\/\/[^/]+).*$/, '$1')

const shortLinkOf = (origin: string) => new RegExp(`^${origin.replace(/[.]/g, '\\.')}/i/[A-Za-z0-9_-]{16,64}$`)

/** Whether `link` is one of our short invitation links (from `origin`, the links service by default). */
export function isShortInvitationLink(link: string, origin: string = LINKS_ORIGIN): boolean {
  return shortLinkOf(origin).test(link.trim())
}

/** Long enough for a phone on a slow network; short enough that the share sheet does not seem stuck. */
const SHORTEN_TIMEOUT_MS = 5000

/**
 * Stores `invitationJson` on the links service and returns its short link, or
 * undefined when there is none to share: unreachable, refused, too slow, or a
 * link that is not ours. What is logged is the outcome, never the invitation.
 */
export async function shortenInvitation(
  invitationJson: Record<string, unknown>,
  options: { fetch?: typeof fetch; timeoutMs?: number; origin?: string } = {}
): Promise<string | undefined> {
  const doFetch = options.fetch ?? fetch
  const origin = options.origin ?? LINKS_ORIGIN
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), options.timeoutMs ?? SHORTEN_TIMEOUT_MS)
  try {
    const response = await doFetch(`${origin}/i`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ invitation: invitationJson }),
      signal: abort.signal,
    })
    if (response.status !== 201) {
      releaseWarn(`[VRC] short link: not made (the links service answered ${response.status})`)
      return undefined
    }
    const { url } = (await response.json()) as { url?: unknown }
    if (typeof url !== 'string' || !isShortInvitationLink(url, origin)) {
      releaseWarn('[VRC] short link: not made (the links service named a link that is not ours)')
      return undefined
    }
    return url
  } catch (e) {
    releaseWarn(
      `[VRC] short link: not made (${abort.signal.aborted ? 'no answer in time' : ((e as Error)?.message ?? e)})`
    )
    return undefined
  } finally {
    clearTimeout(timer)
  }
}
