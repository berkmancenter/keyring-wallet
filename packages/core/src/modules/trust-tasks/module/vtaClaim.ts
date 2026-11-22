/**
 * Claiming an agent from a VTA Farm by scanning one code (`vta-claim`).
 *
 * The Farm's "set up your agent" page shows a trigger link
 * (`/vti/flow/vta-claim/0.1`). The phone claims the reservation it names with a
 * fresh Ed25519 `did:key` — the key that becomes the agent's administrator —
 * shows a six-character check the person compares with the Farm page, and asks
 * until the Farm hands over the agent. The contract is the Farm's own:
 * ic3software/vtafarm-api `docs/mobile-connection-app-api.md` at 4ee367f8
 * (sections cited as §n below).
 *
 *   1. `provision/vta/claim/0.1` {handle}, signed by the key (§4); the answer is
 *      a signed `trust-task-next-step` (§5).
 *   2. The claim check: SHA-256 of the key's DID, base32, first six (§6).
 *   3. `provision/vta/redeem/0.1` {handle}, long-polled (§7), until a signed
 *      `#response` names the agent (§8), or a terminal refusal.
 *
 * Every Farm answer is checked against the Farm DID's `assertionMethod` keys,
 * resolved from the code's `_from` and nowhere else (§2). Nothing here knows a
 * Farm by name: whatever Farm signed the code is the one asked.
 *
 * @module trust-tasks/module/vtaClaim
 */
import type { Agent } from '@credo-ts/core'
import { utils } from '@credo-ts/core'
import { sha256 } from '@noble/hashes/sha2.js'

import { verifyDocumentProof, wireTimestamp } from '../documentProof'

import type { SignInDidDocument } from './oobSignIn'
import type { TriggerAccept } from './triggerLink'

export const VTA_CLAIM_TASK = 'https://trusttasks.org/spec/provision/vta/claim/0.1'
export const VTA_REDEEM_TASK = 'https://trusttasks.org/spec/provision/vta/redeem/0.1'
export const VTA_REDEEM_RESPONSE = `${VTA_REDEEM_TASK}#response`
export const NEXT_STEP_TASK = 'https://trusttasks.org/spec/trust-task-next-step/0.1'
const TRUST_TASK_HTTPS = 'TrustTaskHTTPS'

/** §1: the reservation handle's shape. */
const HANDLE = /^[A-Za-z0-9_-]{22,43}$/

/** §7: the Farm may hold a redeem for 25 s; give it at least 35. */
export const REDEEM_TIMEOUT_MS = 35_000
export const CLAIM_TIMEOUT_MS = 20_000
/** §4: two minutes is enough for a request to be fresh. */
const REQUEST_LIFETIME_S = 120

/** Why a claim ended; each has words (`VtaClaim.Failure.<reason>`). */
export type VtaClaimFailure =
  | 'invalidCode'
  | 'expired'
  | 'unreachable'
  | 'badAnswer'
  | 'alreadyClaimed'
  | 'rejected'
  | 'handleExpired'
  | 'handleNotFound'
  | 'notClaimant'
  | 'refused'
  | 'cancelled'

export class VtaClaimError extends Error {
  constructor(
    readonly reason: VtaClaimFailure,
    /** Which check failed, for the log and tests. Never a key. */
    readonly detail?: string
  ) {
    super(`vtaClaim: ${reason}${detail ? ` (${detail})` : ''}`)
    this.name = 'VtaClaimError'
  }
}

/** §8–9: the Farm's codes, as the claim's endings. Anything else is `refused`. */
const FARM_CODES: Record<string, VtaClaimFailure> = {
  'provision/vta/redeem:rejected': 'rejected',
  'provision/vta:handleExpired': 'handleExpired',
  'provision/vta:notClaimant': 'notClaimant',
  'provision/vta:handleNotFound': 'handleNotFound',
  'provision/vta/claim:alreadyClaimed': 'alreadyClaimed',
}
export const REDEEM_PENDING = 'provision/vta/redeem:pending'

/** What a POST came back with: the status, and the JSON body when there was one. */
export type FarmAnswer = { status: number; body?: unknown }

export type VtaClaimDeps = {
  /** The Farm's DID document, its log verified, or a throw (the Credo resolver in production). */
  resolveDid: (did: string) => Promise<SignInDidDocument>
  /** POST `body` (already serialised: a resend is the same bytes, §10) as JSON. */
  post: (url: string, body: string, timeoutMs: number) => Promise<FarmAnswer>
  /** Sign a document as `walletDid`, for `authentication` (eddsa-jcs-2022). */
  sign: (document: Record<string, unknown>) => Promise<Record<string, unknown>>
  /** The fresh key's DID, which becomes the agent's administrator. */
  walletDid: string
  /** Now, in ms. */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** Checks a Farm proof; by default verifyDocumentProof over the resolved document. */
  verify?: (
    document: Record<string, unknown>,
    controller: string,
    controllerDocument: SignInDidDocument
  ) => Promise<boolean>
}

/** A claimed reservation: what redeeming it needs, and the check to show. */
export type ClaimedVta = {
  farmDid: string
  handle: string
  /** `<TrustTaskHTTPS>/trust-tasks`. */
  url: string
  threadId: string
  walletDid: string
  claimCheck: string
  farmDocument: SignInDidDocument
}

/** The Farm's hand-over (§8): the agent this key now administers. */
export type RedeemedVta = {
  vtaDid: string
  operation: 'provisionVta' | 'grantAcl'
  mediatorDid?: string
}

/** Where a redeem stands while the Farm waits (§8 `details.state`). */
export type RedeemState = { state: 'claimed' | 'confirmed' | 'provisioning' | string; confirmBy?: number }

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 base32, no padding. */
function base32(bytes: Uint8Array): string {
  let out = ''
  let buffer = 0
  let bits = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32[(buffer >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(buffer << (5 - bits)) & 31]
  return out
}

/** §6: the six characters the person compares with the Farm page. */
export function claimCheck(walletDid: string): string {
  return base32(sha256(new TextEncoder().encode(walletDid)))
    .toUpperCase()
    .slice(0, 6)
}

/** §2: the Farm's Trust Task endpoint, from its own DID document only. */
export function farmTasksUrl(document: SignInDidDocument): string | undefined {
  const service = (document.service ?? []).find((s) => {
    const type = s.type
    return type === TRUST_TASK_HTTPS || (Array.isArray(type) && type.includes(TRUST_TASK_HTTPS))
  })
  const endpoint = service?.serviceEndpoint
  const base =
    typeof endpoint === 'string'
      ? endpoint
      : isObject(endpoint) && typeof endpoint.uri === 'string'
        ? endpoint.uri
        : undefined
  if (!base || !/^https:\/\//.test(base)) return undefined
  return `${base.replace(/\/+$/, '')}/trust-tasks`
}

const wholeSecond = (ms: number) => new Date(Math.floor(ms / 1000) * 1000)

function envelope(
  type: string,
  claimed: Pick<ClaimedVta, 'handle' | 'threadId' | 'walletDid' | 'farmDid'>,
  nowMs: number
): Record<string, unknown> {
  return {
    id: `urn:uuid:${utils.uuid()}`,
    threadId: claimed.threadId,
    parentThreadId: claimed.handle,
    type,
    issuer: claimed.walletDid,
    recipient: claimed.farmDid,
    issuedAt: wireTimestamp(wholeSecond(nowMs)),
    expiresAt: wireTimestamp(wholeSecond(nowMs + REQUEST_LIFETIME_S * 1000)),
    payload: { handle: claimed.handle },
  }
}

const defaultVerify = (document: Record<string, unknown>, controller: string, controllerDocument: SignInDidDocument) =>
  verifyDocumentProof(
    { dids: { resolveDidDocument: async () => controllerDocument } } as unknown as Agent,
    document,
    controller,
    { proofPurpose: 'assertionMethod' }
  )

/** A Farm answer that is the Farm's, for this exchange: signed by it, to this key, on this thread. */
async function farmSigned(
  answer: Record<string, unknown>,
  claimed: Pick<ClaimedVta, 'farmDid' | 'walletDid' | 'threadId' | 'handle' | 'farmDocument'>,
  deps: VtaClaimDeps
): Promise<string | undefined> {
  if (answer.issuer !== claimed.farmDid) return 'not issued by the Farm the code names'
  if (answer.recipient !== claimed.walletDid) return 'not addressed to this key'
  if (answer.threadId !== claimed.threadId) return 'not on this exchange'
  if (answer.parentThreadId !== claimed.handle) return 'not for this reservation'
  const verify = deps.verify ?? defaultVerify
  if (!(await verify(answer, claimed.farmDid, claimed.farmDocument).catch(() => false))) {
    return "not signed by the Farm's assertionMethod key"
  }
  return undefined
}

/** The Farm's error document, as its code and payload; undefined for any other answer. */
function farmError(answer: Record<string, unknown>): { code: string; payload: Record<string, unknown> } | undefined {
  if (!String(answer.type ?? '').includes('/trust-task-error/')) return undefined
  const payload = isObject(answer.payload) ? answer.payload : {}
  return { code: typeof payload.code === 'string' ? payload.code : '', payload }
}

/**
 * POST a signed document. No answer at all (§10) is the same bytes again, a
 * few times; an answer of any kind is returned for the caller to read.
 */
async function send(
  deps: VtaClaimDeps,
  url: string,
  signed: Record<string, unknown>,
  timeoutMs: number,
  attempts = 3
): Promise<FarmAnswer> {
  const body = JSON.stringify(signed)
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const answer = await deps.post(url, body, timeoutMs)
      // §10: 202 is the identical request still running — the same bytes again.
      if (answer.status === 202 && i < attempts - 1) {
        await sleep(1500)
        continue
      }
      return answer
    } catch (error) {
      lastError = error
      if (i < attempts - 1) await sleep(1500 * (i + 1))
    }
  }
  throw new VtaClaimError(
    'unreachable',
    lastError instanceof Error ? lastError.message : String(lastError ?? 'no answer')
  )
}

/**
 * Claim the reservation a scanned code names (§1–6). `link` is the reader's
 * accepted `vta-claim` code. Returns the claim, with the check to show, only
 * once the Farm's signed next-step says it is this key's.
 */
export async function claimVta(link: TriggerAccept, deps: VtaClaimDeps): Promise<ClaimedVta> {
  const nowMs = deps.now?.() ?? Date.now()
  const farmDid = link.from
  const handle = link.id
  if (!HANDLE.test(handle)) throw new VtaClaimError('invalidCode', 'the handle is not a reservation handle')
  if (link.exp !== null && link.exp * 1000 <= nowMs) throw new VtaClaimError('expired', 'the code has expired')
  let farmDocument: SignInDidDocument
  try {
    farmDocument = await deps.resolveDid(farmDid)
  } catch (error) {
    throw new VtaClaimError('unreachable', error instanceof Error ? error.message : String(error))
  }
  const url = farmTasksUrl(farmDocument)
  if (!url) throw new VtaClaimError('unreachable', 'the Farm names no TrustTaskHTTPS service')

  const base = { farmDid, handle, url, threadId: `urn:uuid:${utils.uuid()}`, walletDid: deps.walletDid, farmDocument }
  const claim = envelope(VTA_CLAIM_TASK, base, nowMs)
  const signed = await deps.sign(claim)
  const answer = await send(deps, url, signed, CLAIM_TIMEOUT_MS)
  if (!isObject(answer.body)) throw new VtaClaimError('badAnswer', `HTTP ${answer.status} with no document`)
  const body = answer.body
  const problem = await farmSigned(body, base, deps)
  const refusal = farmError(body)
  if (refusal) {
    // An unsigned or foreign refusal is not the Farm's word; it is not believed.
    if (problem) throw new VtaClaimError('badAnswer', `a refusal ${problem}`)
    throw new VtaClaimError(FARM_CODES[refusal.code] ?? 'refused', refusal.code || 'an error with no code')
  }
  if (problem) throw new VtaClaimError('badAnswer', `the next-step is ${problem}`)
  if (body.type !== NEXT_STEP_TASK)
    throw new VtaClaimError('badAnswer', `the claim was answered with ${String(body.type)}`)
  const payload = isObject(body.payload) ? body.payload : {}
  const inResponseTo = isObject(payload.inResponseTo) ? payload.inResponseTo : {}
  if (inResponseTo.id !== claim.id || inResponseTo.typeUri !== VTA_CLAIM_TASK) {
    throw new VtaClaimError('badAnswer', 'the next-step answers another request')
  }
  const expects = Array.isArray(payload.expects) ? payload.expects : []
  const redeem = expects.find((e) => isObject(e) && e.typeUri === VTA_REDEEM_TASK) as
    | Record<string, unknown>
    | undefined
  const hint = redeem && isObject(redeem.hint) ? redeem.hint : {}
  if (!redeem || hint.handle !== handle)
    throw new VtaClaimError('badAnswer', 'the next-step does not ask for a redeem of this handle')
  return { ...base, claimCheck: claimCheck(deps.walletDid) }
}

/**
 * Ask until the Farm hands the agent over (§7–8). One poll at a time; a new
 * signed document for every poll the Farm asks for. `onState` hears where it
 * stands while the person compares the codes and the Farm provisions.
 * `shouldStop` ends the asking (the person cancelled).
 */
export async function redeemVta(
  claimed: ClaimedVta,
  deps: VtaClaimDeps,
  options: { onState?: (state: RedeemState) => void; shouldStop?: () => boolean; maxWaitMs?: number } = {}
): Promise<RedeemedVta> {
  const now = () => deps.now?.() ?? Date.now()
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const until = now() + (options.maxWaitMs ?? 15 * 60_000)
  let backoff = 1000
  for (;;) {
    if (options.shouldStop?.()) throw new VtaClaimError('cancelled')
    if (now() > until) throw new VtaClaimError('handleExpired', 'gave up waiting for the Farm')
    const signed = await deps.sign(envelope(VTA_REDEEM_TASK, claimed, now()))
    let answer: FarmAnswer
    try {
      answer = await send(deps, claimed.url, signed, REDEEM_TIMEOUT_MS)
    } catch {
      // Unreachable for now: try a new poll after a while, within the window.
      if (options.shouldStop?.()) throw new VtaClaimError('cancelled')
      await sleep(backoff)
      backoff = Math.min(backoff * 2, 10_000)
      continue
    }
    if (options.shouldStop?.()) throw new VtaClaimError('cancelled')
    // §10: 204 absorbed a duplicate with nothing kept — wait and poll anew.
    if (answer.status === 204 || !isObject(answer.body)) {
      await sleep(backoff)
      backoff = Math.min(backoff * 2, 10_000)
      continue
    }
    const body = answer.body
    const problem = await farmSigned(body, claimed, deps)
    const refusal = farmError(body)
    if (refusal) {
      if (problem) throw new VtaClaimError('badAnswer', `a refusal ${problem}`)
      if (refusal.code === REDEEM_PENDING || refusal.payload.retryable === true) {
        if (refusal.code === REDEEM_PENDING) {
          const details = isObject(refusal.payload.details) ? refusal.payload.details : {}
          options.onState?.({
            state: typeof details.state === 'string' ? details.state : 'claimed',
            confirmBy: typeof details.confirmBy === 'number' ? details.confirmBy : undefined,
          })
          backoff = 1000
          await sleep(1000)
        } else {
          await sleep(backoff)
          backoff = Math.min(backoff * 2, 10_000)
        }
        continue
      }
      throw new VtaClaimError(FARM_CODES[refusal.code] ?? 'refused', refusal.code || 'an error with no code')
    }
    if (problem) throw new VtaClaimError('badAnswer', `the hand-over is ${problem}`)
    if (body.type !== VTA_REDEEM_RESPONSE)
      throw new VtaClaimError('badAnswer', `the redeem was answered with ${String(body.type)}`)
    const payload = isObject(body.payload) ? body.payload : {}
    if (payload.handle !== claimed.handle) throw new VtaClaimError('badAnswer', 'the hand-over names another handle')
    const vtaDid = typeof payload.vtaDid === 'string' ? payload.vtaDid : ''
    if (!/^did:[a-z0-9]+:/.test(vtaDid)) throw new VtaClaimError('badAnswer', 'the hand-over names no agent')
    const operation = payload.operation
    if (operation !== 'provisionVta' && operation !== 'grantAcl') {
      throw new VtaClaimError('badAnswer', `the hand-over's operation is ${String(operation)}`)
    }
    return {
      vtaDid,
      operation,
      ...(typeof payload.mediatorDid === 'string' && payload.mediatorDid ? { mediatorDid: payload.mediatorDid } : {}),
    }
  }
}

/** POST as the Farm wants it (§1): JSON both ways, the status kept, an empty body allowed. */
export async function farmPost(url: string, body: string, timeoutMs: number): Promise<FarmAnswer> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body,
      signal: controller.signal,
    })
    const text = await response.text()
    let parsed: unknown
    try {
      parsed = text ? JSON.parse(text) : undefined
    } catch {
      parsed = undefined
    }
    return { status: response.status, body: parsed }
  } finally {
    clearTimeout(timer)
  }
}
