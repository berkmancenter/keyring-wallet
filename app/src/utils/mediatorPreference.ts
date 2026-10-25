/**
 * Which mediator the agent is created with: the one this phone stored, unless
 * that one can no longer work, in which case the build's own.
 *
 * The mediator comes from `preferences.selectedMediator`, which is written to
 * storage with every preference change and loaded over the build's
 * `MEDIATOR_URL` at start-up. So an install keeps whatever mediator the build
 * it was first used with baked in. Builds before 2026-09-21 baked the ACA-Py
 * mediator's `?c_i=` invitation, padded base64 ("…=="). Credo 0.6 decoded it
 * with `Buffer`, which tolerates padding; Credo 0.7 parses the invitation on
 * every start with `base64urlnopad`, which refuses "=". So the first launch of
 * a 0.7 build failed in `onInitializeContext`, and so did every launch after
 * it (tester report 7MCB-MF6G, build 232). That mediator is also gone (502).
 *
 * The stored mediator is kept when it still parses, is not a retired host, and
 * is one this phone was offered: the build's own, or one the person added in
 * Settings → Mediator. Anything else is replaced by the build's mediator,
 * which Credo then provisions with and sets as the default mediator.
 */
/** Mediators that no longer run. A stored invitation to one of them is replaced. */
export const RETIRED_MEDIATOR_HOSTS: readonly string[] = ['aries-mediator.asml.berkmancenter.org']

export type MediatorProblem = 'missing' | 'unparseable' | 'retired' | 'notOffered'

/** The invitation parameters Credo reads from a mediator URL (`parseInvitationUrl`). */
const INVITATION_PARAMS = ['_oob', 'oob', 'c_i', 'd_m'] as const

function hostOf(url: string): string | undefined {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url.trim())
  return match?.[1]?.toLowerCase()
}

function queryParam(url: string, name: string): string | undefined {
  const query = url.split('#')[0].split('?')[1]
  if (!query) return undefined
  for (const pair of query.split('&')) {
    const at = pair.indexOf('=')
    const key = decodeURIComponent(at < 0 ? pair : pair.slice(0, at))
    if (key === name) return decodeURIComponent(at < 0 ? '' : pair.slice(at + 1))
  }
  return undefined
}

/**
 * Whether Credo 0.7 can read the invitation this URL carries. Its start-up
 * decoder (`JsonEncoder.fromBase64Url` → `@scure/base` `base64urlnopad`) takes
 * only the base64url alphabet with no padding, so that is checked here
 * explicitly — Credo 0.6's decoder accepted padding, and asking whichever
 * Credo is installed would hide the very difference this guards against. A URL
 * with no invitation parameter is a short URL Credo resolves over the network;
 * it is not judged here.
 */
export function mediatorInvitationReadable(url: string): boolean {
  for (const name of INVITATION_PARAMS) {
    const encoded = queryParam(url, name)
    if (encoded === undefined) continue
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return false
    try {
      const json = Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
      const invitation: unknown = JSON.parse(json)
      return typeof invitation === 'object' && invitation !== null
    } catch {
      return false
    }
  }
  return true
}

/** Why a stored mediator cannot be used, or undefined when it can. */
export function mediatorProblem(
  stored: string | undefined,
  offered: readonly (string | undefined)[]
): MediatorProblem | undefined {
  const url = stored?.trim()
  if (!url) return 'missing'
  const host = hostOf(url)
  if (!host) return 'unparseable'
  if (RETIRED_MEDIATOR_HOSTS.includes(host)) return 'retired'
  if (!mediatorInvitationReadable(url)) return 'unparseable'
  if (!offered.some((o) => o?.trim() === url)) return 'notOffered'
  return undefined
}

export interface MediatorChoice {
  /** The mediator to create the agent with. */
  url: string
  /** Set when the stored mediator was replaced, and why. */
  replaced?: MediatorProblem
}

/**
 * The mediator to use: the stored one when it can be used, else the build's.
 * `offered` is what the phone may choose from — the build's mediator and the
 * ones the person added; a stored value outside it came from an older build.
 */
export function chooseMediator(
  stored: string | undefined,
  buildMediator: string | undefined,
  added: readonly string[] = []
): MediatorChoice {
  const offered = [buildMediator, ...added.filter((a) => !mediatorProblem(a, [a]))]
  const problem = mediatorProblem(stored, offered)
  if (!problem) return { url: stored!.trim() }
  return { url: buildMediator ?? '', replaced: problem }
}
