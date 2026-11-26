/**
 * vtaEnrolment — the phone's half of linking to an agent by QR (plan §5.1).
 *
 * The admin's page shows an enrolment offer; the phone scans or pastes it,
 * mints a temporary manager key, and submits that key to the offer's URL with
 * a proof it holds it. Both screens then show the same enrolment code, and
 * the admin grants the key on the agent for an hour. The phone watches for the
 * grant; connecting and rotating onto a long-lived key are the controller's
 * next steps (`vtaAgent`), not this module's.
 *
 * The exchange is ours, run against a lab page, and is the worked example we
 * hand upstream (plan §9, U-1…U-3). The key is minted exactly as every other
 * client DID is (`createVtiClientDid`), so it names its mediator by DID and
 * stays reachable as an approver after the rotation.
 *
 * @module trust-tasks/module/vtaEnrolment
 */

import type { Agent } from '@credo-ts/core'

import { enrolmentCode, signCompactJws, type EnrolmentOffer } from '@bifold/trust-tasks'

import { resolveVtaMediator } from './VtaClient'
import type { VtiIdentityStore } from './VtiIdentityStore'
import { createVtiClientDid } from './VtiMediatorTransport'

export type EnrolmentStatus = 'open' | 'submitted' | 'granted' | 'refused' | 'expired'

export class EnrolmentError extends Error {
  constructor(
    message: string,
    public readonly reason: 'expired' | 'refused' | 'unreachable' | 'rejected' | 'failed'
  ) {
    super(message)
    this.name = 'EnrolmentError'
  }
}

type Fetch = typeof fetch

const PROOF_LIFETIME_S = 300

/**
 * Mint the temporary manager key for this offer, record it as the manager
 * identity for the offer's agent, and submit it. Returns the code both
 * screens must show — computed here, and checked against the page's.
 */
export async function submitEnrolment(
  agent: Agent,
  offer: EnrolmentOffer,
  store: VtiIdentityStore,
  deps: { fetch?: Fetch; now?: () => number } = {}
): Promise<{ did: string; code: string }> {
  const doFetch = deps.fetch ?? fetch
  const now = Math.floor((deps.now ?? Date.now)() / 1000)
  if (now > offer.exp) throw new EnrolmentError('the enrolment offer has expired', 'expired')

  const mediator = await resolveVtaMediator(agent, offer.vta)
  const did = await createVtiClientDid(agent, mediator)
  await store.setManager({ vtaDid: offer.vta, did, createdAt: new Date().toISOString(), stage: 'temporary' })

  const proof = await signCompactJws(agent, did, {
    iss: did,
    aud: offer.url,
    nonce: offer.n,
    iat: now,
    exp: now + PROOF_LIFETIME_S,
  })
  const code = enrolmentCode(offer.n, did)

  let response: Response
  try {
    response = await doFetch(`${offer.url}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ did, proof }),
    })
  } catch (error) {
    throw new EnrolmentError(`the agent's page could not be reached: ${(error as Error).message}`, 'unreachable')
  }
  const body = (await response.json().catch(() => ({}))) as { code?: string; error?: string }
  if (response.status === 410) throw new EnrolmentError(body.error ?? 'the enrolment offer has expired', 'expired')
  if (!response.ok) throw new EnrolmentError(body.error ?? `the page refused the key (${response.status})`, 'rejected')
  // The page derives the code from what it received. A different code means it
  // did not receive this key — never show the person a code that cannot match.
  if (body.code !== code) throw new EnrolmentError('the page answered with a different code', 'rejected')
  return { did, code }
}

/**
 * Watch the offer until the admin decides. Resolves on a grant; rejects on a
 * refusal, an expiry, a timeout, or `shouldStop()` turning true (the person
 * cancelled).
 */
export async function waitForGrant(
  offer: EnrolmentOffer,
  options: {
    fetch?: Fetch
    intervalMs?: number
    timeoutMs?: number
    shouldStop?: () => boolean
    sleep?: (ms: number) => Promise<void>
  } = {}
): Promise<void> {
  const doFetch = options.fetch ?? fetch
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const deadline = Date.now() + (options.timeoutMs ?? 10 * 60 * 1000)
  let unreachable = 0
  while (Date.now() < deadline) {
    if (options.shouldStop?.()) throw new EnrolmentError('cancelled', 'failed')
    let state: EnrolmentStatus | undefined
    try {
      const response = await doFetch(`${offer.url}/status`)
      state = ((await response.json()) as { state?: EnrolmentStatus }).state
      unreachable = 0
    } catch {
      // A page that blips is waited out; one that stays away is reported.
      if (++unreachable >= 10) throw new EnrolmentError("the agent's page stopped answering", 'unreachable')
    }
    if (state === 'granted') return
    if (state === 'refused') throw new EnrolmentError('the admin refused this phone', 'refused')
    if (state === 'expired') throw new EnrolmentError('the enrolment offer expired before it was granted', 'expired')
    await sleep(options.intervalMs ?? 1500)
  }
  throw new EnrolmentError('no decision arrived in time', 'expired')
}
