/**
 * agentHostConnection — an agent host's automatic connection, the phone's half
 * (vtafarm-api docs/mobile-connection-app-api.md and
 * docs/vta-mobile-connection-design.md, at d2cc4100).
 *
 * The host's page shows a QR holding exactly `{ vta_did, callback_url }`. The
 * phone asks the person, then:
 *
 * 1. POSTs `{ admin_did }` — its own Ed25519 did:key — to the callback URL,
 *    used exactly as given. The host answers 202 with a progress token and
 *    the two addresses below.
 * 2. Polls the progress address about every three seconds (Bearer token):
 *    `provisioning` until the agent is ready, then `awaiting_mobile`.
 * 3. Links as it always does (sign in as the key, rotate onto a long-lived
 *    one), then POSTs `{ status: "connected" }` to the completion address.
 *
 * The callback URL and the progress token are credentials: possession of an
 * unused callback nominates an administrator for the agent. Neither is ever
 * put in an error, a warning or a log line here, and neither is sent to a
 * site off the allow-list — HTTPS only, `ic3.dev` and `firstperson.dev`.
 * The host's own error words are not shown either: they can echo the
 * request. What the phone does about each answer follows the doc's tables.
 *
 * @module trust-tasks/module/agentHostConnection
 */

/** The sites an agent host's callback may be on: the name itself or any name under it. */
export const AGENT_HOST_SITES = ['ic3.dev', 'firstperson.dev'] as const

/** A host's QR is good for five minutes from when the host made it; the phone can only count from the scan. */
export const AGENT_HOST_QR_LIFETIME_MS = 5 * 60 * 1000

/** The host's suggested poll interval ("approximately every three seconds"). */
export const AGENT_HOST_POLL_MS = 3000

/** Waits before each retry of a 429, a 500 or a lost answer; then the attempt ends. */
const RETRY_BACKOFF_MS = [2000, 4000, 8000, 16000]

/** A poll that keeps failing (429/500/no answer) backs off to this, and gives up after this many in a row. */
const POLL_BACKOFF_MAX_MS = 30000
const POLL_FAILURES_BEFORE_BUSY = 10

/** A completion the host is not ready for (409) is asked again, this many times, a poll apart. */
const COMPLETION_NOT_READY_TRIES = 20

/**
 * Why a connection with an agent host stopped, in a form a screen words for
 * a person. `hostNotAllowed`: the QR names a callback off the allow-list.
 * `badKey`/`badRequest`/`badAnswer`: the phone and the host disagree on the
 * protocol (a bug, not the person's doing). `expired`: the QR is used up or
 * out of date — scan a new one. `taken`: another administrator claimed it, or
 * the agent was not ready. `unavailable`: the host has the feature off.
 * `busy`: the host kept answering "try later". `unreachable`: no answer at
 * all. `notAccepted`/`gone`/`timedOut`: the progress token was refused, the
 * agent was deleted, or the hour ran out. `setupFailed`: the host could not
 * set the agent up. `cancelled`: the person stopped it.
 */
export type AgentHostFailure =
  | 'hostNotAllowed'
  | 'badKey'
  | 'badRequest'
  | 'badAnswer'
  | 'expired'
  | 'taken'
  | 'unavailable'
  | 'busy'
  | 'unreachable'
  | 'notAccepted'
  | 'gone'
  | 'timedOut'
  | 'setupFailed'
  | 'cancelled'

/** An automatic connection that stopped on the phone's side before the host was asked: no screen lock. */
export type HostLinkFailure = AgentHostFailure | 'needsScreenLock'

export class AgentHostConnectionError extends Error {
  constructor(
    public readonly reason: AgentHostFailure,
    /** For `setupFailed`: the host's `connection.error`, which its doc calls safe to display. */
    public readonly hostError?: string
  ) {
    super(`agent host connection stopped: ${reason}`)
    this.name = 'AgentHostConnectionError'
  }
}

/** A scanned automatic-connection QR. `host` is the callback's site, for the person to recognise. */
export interface AgentHostOffer {
  vtaDid: string
  callbackUrl: string
  host: string
}

/** The host's 202: what the phone keeps to follow the connection. Credentials — never logged. */
export interface HostConnectionAccepted {
  requestId: string
  status: string
  progressToken: string
  progressUrl: string
  completionUrl: string
  progressExpiresAt?: string
}

export interface AgentHostDeps {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Checked before every call after the first: true ends the attempt as `cancelled`. */
  shouldStop?: () => boolean
  /** Each status the host reports while the phone waits for the agent, for a screen to name. */
  onStatus?: (status: 'provisioning' | 'awaiting_mobile' | 'connected') => void
}

const AGENT_DID = /^did:webvh:[^\s]+:[^\s]+$/

/**
 * The site of an HTTPS URL on the allow-list, else undefined. Parsed by hand:
 * no user part, no port, and the site must be an allowed name or end in
 * "." + one — so `evilic3.dev` and `ic3.dev.example.com` are not.
 */
export function allowedHostOf(url: string): string | undefined {
  const match = /^https:\/\/([a-z0-9.-]+)(\/[^\s]*)?$/i.exec(url)
  if (!match) return undefined
  const host = match[1].toLowerCase()
  return AGENT_HOST_SITES.some((site) => host === site || host.endsWith(`.${site}`)) ? host : undefined
}

/**
 * Whether `text` is shaped like an automatic-connection QR — a JSON object
 * with a `callback_url` — before anything is checked. Cheap, for routing: a
 * QR that is one but fails the checks is answered in words, not taken for
 * something else.
 */
export function looksLikeAgentHostQr(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return false
  try {
    const value = JSON.parse(trimmed) as unknown
    return typeof value === 'object' && value !== null && !Array.isArray(value) && 'callback_url' in value
  } catch {
    return false
  }
}

/**
 * The QR, checked: JSON with exactly `vta_did` (a did:webvh) and
 * `callback_url`. Undefined when it is not one; throws `hostNotAllowed` when
 * it is one whose callback is not HTTPS on an allowed site — that callback is
 * never called.
 */
export function parseAgentHostQr(text: string): AgentHostOffer | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return undefined
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (keys.length !== 2 || keys[0] !== 'callback_url' || keys[1] !== 'vta_did') return undefined
  const { vta_did: vtaDid, callback_url: callbackUrl } = record
  if (typeof vtaDid !== 'string' || !AGENT_DID.test(vtaDid)) return undefined
  if (typeof callbackUrl !== 'string') return undefined
  const host = allowedHostOf(callbackUrl)
  if (!host) throw new AgentHostConnectionError('hostNotAllowed')
  return { vtaDid, callbackUrl, host }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

interface Answer {
  status: number
  body: Record<string, unknown>
}

/** One call. A call that never answers is `undefined`; the host's body is read as JSON or as nothing. */
async function call(
  deps: AgentHostDeps,
  url: string,
  init: { method: 'GET' | 'POST'; token?: string; body?: unknown }
): Promise<Answer | undefined> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  if (init.token) headers.Authorization = `Bearer ${init.token}`
  let response: Response
  try {
    response = await (deps.fetch ?? fetch)(url, {
      method: init.method,
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })
  } catch {
    return undefined
  }
  const body = await response.json().catch(() => undefined)
  return {
    status: response.status,
    body: typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {},
  }
}

/** Worth asking again: no answer, 429, or a 5xx other than 503 (the host has the feature off: stop). */
const retryable = (answer: Answer | undefined) =>
  !answer || answer.status === 429 || (answer.status >= 500 && answer.status !== 503)

/** Ends the attempt for an answer that cannot be retried, or that ran out of retries. */
function stopFor(answer: Answer | undefined, table: Record<number, AgentHostFailure>): never {
  if (!answer) throw new AgentHostConnectionError('unreachable')
  const reason = table[answer.status]
  if (reason) throw new AgentHostConnectionError(reason)
  if (answer.status === 429 || answer.status >= 500) throw new AgentHostConnectionError('busy')
  throw new AgentHostConnectionError('badAnswer')
}

const asString = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

/**
 * 1. Submit this phone's key to the callback, exactly as given. A 429, a 500
 * or a lost answer is retried with the same key — the host acknowledges a
 * repeat of an accepted callback — with growing waits; everything else in
 * the doc's table stops at once.
 */
export async function submitAdminDid(
  offer: AgentHostOffer,
  adminDid: string,
  deps: AgentHostDeps = {}
): Promise<HostConnectionAccepted> {
  const sleep = deps.sleep ?? defaultSleep
  let answer: Answer | undefined
  for (let attempt = 0; ; attempt++) {
    answer = await call(deps, offer.callbackUrl, { method: 'POST', body: { admin_did: adminDid } })
    if (!retryable(answer) || attempt >= RETRY_BACKOFF_MS.length) break
    await sleep(RETRY_BACKOFF_MS[attempt])
    if (deps.shouldStop?.()) throw new AgentHostConnectionError('cancelled')
  }
  if (answer?.status !== 202 && answer?.status !== 200) {
    if (answer?.status === 400) {
      throw new AgentHostConnectionError(answer.body.reason === 'invalid_admin_did' ? 'badKey' : 'badRequest')
    }
    stopFor(answer, { 404: 'expired', 409: 'taken', 410: 'expired', 503: 'unavailable' })
  }
  const body = answer.body
  const connection = (body.connection ?? {}) as Record<string, unknown>
  const progressToken = asString(body.progress_token)
  const progressUrl = asString(body.progress_url)
  const completionUrl = asString(body.completion_url)
  const requestId = asString(connection.request_id)
  if (!progressToken || !progressUrl || !completionUrl || !requestId) {
    throw new AgentHostConnectionError('badAnswer')
  }
  // The token goes only where the callback went: same allowed site.
  if (allowedHostOf(progressUrl) !== offer.host || allowedHostOf(completionUrl) !== offer.host) {
    throw new AgentHostConnectionError('hostNotAllowed')
  }
  return {
    requestId,
    status: asString(connection.status) ?? 'provisioning',
    progressToken,
    progressUrl,
    completionUrl,
    ...(asString(body.progress_expires_at) ? { progressExpiresAt: asString(body.progress_expires_at) } : {}),
  }
}

/**
 * 2. Poll until the agent is ready for this phone: `awaiting_mobile`, or
 * `connected` when a retried phone finds the host already recorded it. A 429,
 * a 500 or no answer polls again, backing off; ten in a row end as `busy`.
 * Never past the progress token's expiry.
 */
export async function waitUntilAgentReady(
  accepted: HostConnectionAccepted,
  deps: AgentHostDeps = {}
): Promise<'awaiting_mobile' | 'connected'> {
  const sleep = deps.sleep ?? defaultSleep
  const now = deps.now ?? Date.now
  const expiresAt = accepted.progressExpiresAt ? Date.parse(accepted.progressExpiresAt) : Number.NaN
  let failures = 0
  for (let first = true; ; first = false) {
    if (!first && deps.shouldStop?.()) throw new AgentHostConnectionError('cancelled')
    if (Number.isFinite(expiresAt) && now() >= expiresAt) throw new AgentHostConnectionError('timedOut')
    const answer = await call(deps, accepted.progressUrl, { method: 'GET', token: accepted.progressToken })
    if (retryable(answer)) {
      if (++failures >= POLL_FAILURES_BEFORE_BUSY) stopFor(answer, {})
      await sleep(Math.min(AGENT_HOST_POLL_MS * 2 ** failures, POLL_BACKOFF_MAX_MS))
      continue
    }
    failures = 0
    if (answer!.status !== 200) stopFor(answer, { 401: 'notAccepted', 404: 'gone', 410: 'timedOut' })
    const connection = (answer!.body.connection ?? {}) as Record<string, unknown>
    if (
      connection.status === 'provisioning' ||
      connection.status === 'awaiting_mobile' ||
      connection.status === 'connected'
    ) {
      deps.onStatus?.(connection.status)
    }
    switch (connection.status) {
      case 'awaiting_mobile':
      case 'connected':
        return connection.status
      case 'failed':
        throw new AgentHostConnectionError('setupFailed', asString(connection.error))
      case 'provisioning':
        break
      default:
        // `cancelled`, `expired` or a state this phone does not know: the
        // owner abandoned this attempt or the doc moved on — stop, not spin.
        throw new AgentHostConnectionError(connection.status === 'cancelled' ? 'expired' : 'badAnswer')
    }
    await sleep(AGENT_HOST_POLL_MS)
  }
}

/**
 * 3. Report that this phone registered and connected. Safe to repeat, so a
 * 429, a 500 or a lost answer is retried; a 409 (the agent not running yet)
 * is asked again a poll later, as the doc says.
 */
export async function reportConnected(accepted: HostConnectionAccepted, deps: AgentHostDeps = {}): Promise<void> {
  const sleep = deps.sleep ?? defaultSleep
  let retries = 0
  let notReady = 0
  for (;;) {
    const answer = await call(deps, accepted.completionUrl, {
      method: 'POST',
      token: accepted.progressToken,
      body: { status: 'connected' },
    })
    if (answer?.status === 200 || answer?.status === 202 || answer?.status === 204) return
    if (answer?.status === 409 && ++notReady < COMPLETION_NOT_READY_TRIES) {
      await sleep(AGENT_HOST_POLL_MS)
      continue
    }
    if (retryable(answer) && retries < RETRY_BACKOFF_MS.length) {
      await sleep(RETRY_BACKOFF_MS[retries++])
      continue
    }
    stopFor(answer, { 400: 'badRequest', 401: 'notAccepted', 404: 'gone', 409: 'taken', 410: 'timedOut' })
  }
}

/**
 * The whole connection: make the key, submit it, wait for the agent, link,
 * then report. `link` is the phone's own linking (sign in, rotate); a link
 * that fails is never reported. A report that fails leaves the phone linked —
 * completion is the phone's report to the host, not the link itself — and is
 * only warned about, by reason.
 */
export async function connectWithAgentHost(
  offer: AgentHostOffer,
  deps: AgentHostDeps & {
    adminDid: () => Promise<string>
    link: () => Promise<void>
    onAccepted?: (accepted: HostConnectionAccepted) => void
    warn?: (message: string) => void
  }
): Promise<void> {
  const adminDid = await deps.adminDid()
  const accepted = await submitAdminDid(offer, adminDid, deps)
  deps.onAccepted?.(accepted)
  await waitUntilAgentReady(accepted, deps)
  if (deps.shouldStop?.()) throw new AgentHostConnectionError('cancelled')
  await deps.link()
  try {
    await reportConnected(accepted, deps)
  } catch (error) {
    const reason = error instanceof AgentHostConnectionError ? error.reason : 'unreachable'
    deps.warn?.(`the agent host was not told this phone connected (${reason}); the phone is linked`)
  }
}
