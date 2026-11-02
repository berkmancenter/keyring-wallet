/**
 * farmSignIn — signing in to a VTA Farm's website with an agent claimed from
 * that Farm (IN-388). The contract is the Farm's own: ic3software/vtafarm-api
 * `docs/keyring-app-sign-in-contract.md` at c437bfbb (sections cited as §n),
 * read with its server at the same commit (`internal/handler/trust_task_oob.go`,
 * `internal/walletauth/store.go`).
 *
 * The same `auth/oob` exchange as a community's sign-in (oobSignIn claims, and
 * its answer and step 2 are checked as there), with three differences:
 *
 *  - Who signs. The Farm knows the person by the did:key that claimed their
 *    agent (`mobile_connections.admin_did`, a did:key checked with
 *    `VerifyDIDKey`), which the link keeps as `farmLogin` (VtaLinkStore). The
 *    phone holds that key and signs `identify` (authentication) and the grant
 *    (assertionMethod) itself; the agent is not asked. It is not the manager
 *    key: the link swapped that onto a long-term key once the agent was handed over.
 *  - The approval. The owner check (Face ID, fingerprint or the passcode;
 *    confirmOwner, as the claim asks) before an approving grant is signed (§3).
 *  - The Farm's rules. One version of each step (claim 0.2, identify 0.1,
 *    prove, grant and respond 0.3), no signing scope ever, and its retries (§5):
 *    a refusal the Farm marks retryable is sent again as a new document after a
 *    pause; a send with no answer is sent again as the same document, same id.
 *    Nothing is sent again after any other refusal.
 *
 * Network, resolver, signer and owner check are passed in, so this is tested
 * without any. The sign-in screen reaches it through signInSteps.
 *
 * @module trust-tasks/module/farmSignIn
 */
import { utils } from '@credo-ts/core'

import { jcsCanonicalize, wireTimestamp, type ProofPurpose } from '../documentProof'

import {
  OOB_TASKS,
  SignInError,
  oobEnvelope,
  tasksUrl,
  type ClaimedSignIn,
  type SentDocument,
  type SignInDeps,
  type SignInFailure,
} from './oobSignIn'
import {
  GRANT_LIFETIME_SECONDS,
  UV_APPROVE_PROMPT,
  digestMultibase,
  proofVerifies,
  resolveOrUnreachable,
  step2Problem,
} from './oobSignInAgent'
import type { ConfirmOwner } from './vtaOwner'

/** An agent this phone claimed from a Farm, which can sign in to that Farm. */
export type FarmSignInIdentity = {
  source: 'farm'
  /** The agent, and what this phone calls it. */
  vtaDid: string
  agentName: string
  /** Whether it is the agent this phone acts with now. */
  current: boolean
  /** The key the agent was claimed with: how the Farm knows the person. */
  did: string
  label?: string
}

/** The key a Farm signs a person in by, held on this phone. Production: the wallet's own key store. */
export type FarmLogin = {
  did: string
  sign: (document: Record<string, unknown>, proofPurpose: ProofPurpose) => Promise<Record<string, unknown>>
}

export type FarmSignInDeps = Pick<SignInDeps, 'post' | 'resolveDid' | 'now'> & {
  login: FarmLogin
  /** A pause between sends; a test passes one that does not wait. */
  pause?: (ms: number) => Promise<void>
}

export type FarmApproveDeps = FarmSignInDeps & { confirmOwner: ConfirmOwner }

/** What the browser told the Farm about itself. `sameNetwork` is undefined when the Farm could not tell. */
export type FarmRequester = {
  browser: string
  os: string
  location: string
  sameNetwork?: boolean
  createdAt: string
}

/** A proved Farm sign-in: what the review shows, and what the grant needs. */
export type FarmProvedSignIn = {
  claimed: ClaimedSignIn
  /** The Farm's whole signed step-2 reply, as received: the grant's `contextDigest` is over it. */
  step2: Record<string, unknown>
  /** The browser's key the grant lets in. */
  sessionKey: string
  requester: FarmRequester
  /** Who the Farm identified: the claim key. */
  identifiedAs: string
  farm: {
    /** The agent chosen. */
    vtaDid: string
    agentName: string
    /** The Farm's name, as its own signed answer to the claim gives it. */
    serviceName?: string
  }
  /** A Farm session never lets the browser sign as the person. */
  signingScope?: undefined
}

/** How many times a send is made again (§5), within the request's deadline. */
export const FARM_SEND_RETRIES = 2
/** The pause before each send again, in ms. */
export const FARM_RETRY_PAUSE_MS = [1000, 3000] as const

/**
 * The Farm's refusals, by full code (trust_task_oob.go). Any other is `refused`. `auth/oob:notAuthorized` is read
 * where it is sent: at prove it says the key is not the Farm's for any account (`farmNotLinked`).
 */
const FARM_REFUSALS: Record<string, SignInFailure> = {
  'auth/oob/claim:alreadyClaimed': 'alreadyClaimed',
  // One try: a wrong number declines the request (trust_task_oob.go oobProve).
  'auth/oob/prove:numberMismatch': 'wrongNumber',
  'auth/oob/respond:contextMismatch': 'contextMismatch',
  'auth/oob:requestExpired': 'expired',
  'auth/oob:requestNotFound': 'notFound',
  'auth/oob:alreadyDecided': 'notFound',
}

const NOT_AUTHORIZED = 'auth/oob:notAuthorized'

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)

const nowSeconds = (deps: { now?: () => number }) => deps.now?.() ?? Math.floor(Date.now() / 1000)

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** A `trust-task-error` answer's code and whether it may be sent again; undefined for any other answer. */
function refusalOf(answer: Record<string, unknown>): { code: string; retryable: boolean } | undefined {
  if (!String(answer.type ?? '').includes('/trust-task-error/')) return undefined
  const payload = isObject(answer.payload) ? answer.payload : {}
  return { code: str(payload.code), retryable: payload.retryable === true }
}

/**
 * POST a document to the Farm and return its answer, with the Farm's retries (§5): a refusal it marks retryable is
 * sent again as a new document (`make` again); a send with no answer is sent again as the same document. At most
 * {@link FARM_SEND_RETRIES} more sends, and none once `until` (epoch seconds) has passed. A refusal is a
 * {@link SignInError}; `responded` marks those of a `respond` send.
 */
export async function sendToFarm(
  deps: Pick<FarmSignInDeps, 'post' | 'now' | 'pause'>,
  base: string,
  make: () => Record<string, unknown>,
  options: { responded?: boolean; until?: number } = {}
): Promise<SentDocument> {
  const pause = deps.pause ?? sleep
  const mayRetry = (attempt: number) =>
    attempt < FARM_SEND_RETRIES && (options.until === undefined || nowSeconds(deps) < options.until)
  let document = make()
  for (let attempt = 0; ; attempt++) {
    let answer: unknown
    try {
      answer = await deps.post(tasksUrl(base), document)
    } catch (e) {
      if (mayRetry(attempt)) {
        await pause(FARM_RETRY_PAUSE_MS[attempt])
        continue
      }
      throw new SignInError('unreachable', e instanceof Error ? e.message : String(e), options)
    }
    if (!isObject(answer)) throw new SignInError('badAnswer', 'the answer is not a JSON object', options)
    const refusal = refusalOf(answer)
    if (!refusal) return { answer, document }
    if (refusal.retryable && mayRetry(attempt)) {
      await pause(FARM_RETRY_PAUSE_MS[attempt])
      document = make()
      continue
    }
    throw new SignInError(FARM_REFUSALS[refusal.code] ?? 'refused', refusal.code || 'an error with no code', options)
  }
}

/**
 * The Farm agents among this phone's links for `farmDid`: each one whose link kept a key claimed from that Farm,
 * the current agent's first. None for an agent claimed before the key was kept, or linked another way.
 */
export function farmIdentitiesFrom(
  farmDid: string,
  agents: { vtaDid: string; name: string; current: boolean; farmLogin?: { farmDid: string; did: string } }[]
): FarmSignInIdentity[] {
  return agents
    .filter((a) => a.farmLogin?.farmDid === farmDid)
    .map((a) => ({
      source: 'farm' as const,
      vtaDid: a.vtaDid,
      agentName: a.name,
      current: a.current,
      did: (a.farmLogin as { did: string }).did,
    }))
    .sort((x, y) => Number(y.current) - Number(x.current))
}

/** A document the claim key signs (identify, grant): the framework members and nothing else, as the Farm reads them. */
function loginDocument(type: string, payload: Record<string, unknown>, issuer: string, farmDid: string) {
  return {
    id: `urn:uuid:${utils.uuid()}`,
    type,
    issuer,
    recipient: farmDid,
    issuedAt: wireTimestamp(new Date(Math.floor(Date.now() / 1000) * 1000)),
    payload,
  }
}

/** Sign as the claim key; the same document must come back, with a proof. Never logs the document. */
async function signedAsLogin(
  login: FarmLogin,
  unsigned: Record<string, unknown>,
  proofPurpose: ProofPurpose
): Promise<Record<string, unknown>> {
  let signed: Record<string, unknown>
  try {
    signed = await login.sign(unsigned, proofPurpose)
  } catch (e) {
    throw new SignInError('farmKeyMissing', e instanceof Error ? e.name : 'the claim key could not sign')
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { proof, ...rest } = isObject(signed) ? signed : ({} as Record<string, unknown>)
  if (!isObject(proof) || jcsCanonicalize(rest) !== jcsCanonicalize(unsigned)) {
    throw new SignInError('badAnswer', 'the claim key did not sign the document it was given')
  }
  return signed
}

/**
 * Tell the Farm who is signing in, with the number the person typed: the claim key signs `auth/oob/identify/0.1`,
 * the phone sends it in `auth/oob/prove/0.3` under the claim's throwaway key, and the Farm's step-2 reply is checked
 * as a community's is before anything of it is shown.
 *
 * Not two digits is refused before anything is sent (`badNumber`). The Farm ends the request on a wrong number
 * (`wrongNumber`) and on a key it knows for no account (`farmNotLinked`): one try either way.
 */
export async function farmIdentifyAndProve(
  claimed: ClaimedSignIn,
  enteredNumber: string,
  identity: FarmSignInIdentity,
  deps: FarmSignInDeps
): Promise<FarmProvedSignIn> {
  const number = enteredNumber.trim()
  if (!/^\d{2}$/.test(number)) throw new SignInError('badNumber')
  if (claimed.decisionDeadline <= nowSeconds(deps)) throw new SignInError('expired', 'the decision deadline has passed')
  const { requestId, vtcDid: farmDid, keyA, base } = claimed
  if (deps.login.did !== identity.did) throw new SignInError('farmKeyMissing', 'the key is not the chosen agent’s')

  const identify = await signedAsLogin(
    deps.login,
    loginDocument(
      OOB_TASKS.identify,
      { requestId, approverKey: keyA.did, enteredNumber: number },
      identity.did,
      farmDid
    ),
    'authentication'
  )
  let sent: SentDocument
  try {
    sent = await sendToFarm(
      deps,
      base,
      // version-pinned: the Farm serves one version of each step, prove 0.3
      () => keyA.sign(oobEnvelope(OOB_TASKS.prove03, { identify }, keyA.did, farmDid, requestId), 'authentication'),
      { until: claimed.decisionDeadline }
    )
  } catch (error) {
    if (error instanceof SignInError && error.detail === NOT_AUTHORIZED) {
      throw new SignInError('farmNotLinked', NOT_AUTHORIZED)
    }
    throw error
  }
  const step2 = sent.answer
  const farmDocument = await resolveOrUnreachable(deps, farmDid)
  const problem = await step2Problem(step2, {
    claimed,
    vtcDocument: farmDocument,
    proveId: sent.document.id as string,
    persona: identity.did,
    now: nowSeconds(deps),
  })
  if (problem) throw new SignInError('badAnswer', problem)

  const payload = step2.payload as Record<string, unknown>
  const requester = payload.requester as Record<string, unknown>
  const service = isObject((claimed.answer.payload as Record<string, unknown> | undefined)?.service)
    ? ((claimed.answer.payload as Record<string, unknown>).service as Record<string, unknown>)
    : {}
  return {
    claimed,
    step2,
    sessionKey: payload.sessionKey as string,
    requester: {
      browser: str(requester.browser, 'unknown'),
      os: str(requester.os, 'unknown'),
      location: str(requester.location, 'unknown'),
      // The Farm says "unknown" when it could not tell: not the same as no.
      ...(typeof requester.sameNetwork === 'boolean' ? { sameNetwork: requester.sameNetwork } : {}),
      createdAt: str(requester.createdAt),
    },
    identifiedAs: payload.identifiedAs as string,
    farm: {
      vtaDid: identity.vtaDid,
      agentName: identity.agentName,
      ...(typeof service.name === 'string' && service.name.trim() ? { serviceName: service.name.trim() } : {}),
    },
  }
}

/**
 * Approve a proved Farm sign-in: the owner check first (nothing is signed without it), then the grant, signed by the
 * claim key for `assertionMethod`, handed to the Farm in `respond`. The session lasts at most
 * {@link GRANT_LIFETIME_SECONDS}; the Farm ends it sooner at its own limit.
 *
 * Every error before `respond` leaves the request open (cancel it, or let it expire); every error from `respond` on
 * has `responded: true`, and the request must then not be cancelled.
 */
export async function farmApprove(
  proved: FarmProvedSignIn,
  identity: FarmSignInIdentity,
  deps: FarmApproveDeps
): Promise<{ status: 'approved' }> {
  const { claimed, step2, sessionKey } = proved
  const { requestId, vtcDid: farmDid, keyA, base, portalOrigin } = claimed
  const now = nowSeconds(deps)
  if (claimed.decisionDeadline <= now) throw new SignInError('expired', 'the decision deadline has passed')
  if (deps.login.did !== identity.did || proved.identifiedAs !== identity.did) {
    throw new SignInError('farmKeyMissing', 'the key is not the one the Farm identified')
  }

  const confirmed = await deps.confirmOwner(UV_APPROVE_PROMPT).catch(() => ({ ok: false, reason: 'failed' as const }))
  if (!confirmed.ok) throw new SignInError(confirmed.reason === 'cancelled' ? 'uvCancelled' : 'uvUnavailable')

  const grant = await signedAsLogin(
    deps.login,
    loginDocument(
      // version-pinned: the Farm serves one version of each step, grant 0.3
      OOB_TASKS.grant03,
      {
        requestId,
        decision: 'approve',
        sessionKey,
        approverKey: keyA.did,
        origin: portalOrigin,
        // Over the whole signed step 2 as received, proof included; the Farm holds its own digest of it.
        contextDigest: digestMultibase(step2),
        sessionEndsAt: wireTimestamp(new Date((now + GRANT_LIFETIME_SECONDS) * 1000)),
      },
      identity.did,
      farmDid
    ),
    'assertionMethod'
  )

  const responded = { responded: true }
  const sent = await sendToFarm(
    deps,
    base,
    // version-pinned: the Farm serves one version of each step, respond 0.3
    () => keyA.sign(oobEnvelope(OOB_TASKS.respond03, { grant }, keyA.did, farmDid, requestId), 'authentication'),
    { ...responded, until: claimed.decisionDeadline }
  )
  const { answer } = sent
  const farmDocument = await resolveOrUnreachable(deps, farmDid).catch((e: SignInError) => {
    throw new SignInError(e.reason, e.detail, responded)
  })
  if (
    !(await proofVerifies(answer, farmDid, farmDocument, 'assertionMethod')) &&
    !(await proofVerifies(answer, farmDid, farmDocument, 'authentication'))
  ) {
    throw new SignInError('badAnswer', "the respond answer is not signed by the Farm's own key", responded)
  }
  if (answer.threadId !== sent.document.id)
    throw new SignInError('badAnswer', 'the answer does not thread to the respond', responded)
  if (answer.recipient !== keyA.did)
    throw new SignInError('badAnswer', 'the answer is not addressed to this claim key', responded)
  const status = isObject(answer.payload) ? answer.payload.status : undefined
  if (status !== 'approved') throw new SignInError('refused', `the Farm answered ${String(status)}`, responded)
  return { status: 'approved' }
}
