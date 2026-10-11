/**
 * oobSignIn — the first step of signing in to a community's website from a
 * scanned code (Trust Task `auth/oob`): claiming the browser's sign-in
 * request, and checking the community's signed answer before anything is
 * shown to the person.
 *
 * Ported from the reference rung that claims against a live community
 * (keyring-wallet `tsp-reference/ref-22-oob-claim`, 15/15) and the findings
 * beside it (`docs/spikes/20261011-oob-sign-in-findings.md`, "The wallet's
 * flow", M1–M3, G3):
 *
 *  - only a community already in Keyring's records is acted for, and that is
 *    checked before anything goes over the network;
 *  - the community's endpoints (`TrustTaskHTTPS`, `SignInPortal`) come from
 *    its verified DID document, by type — never from the link;
 *  - the claim is signed by a fresh throwaway key (K_a), and the answer must
 *    be signed by the community for `assertionMethod` and name this claim,
 *    this key, this request, this community, `login`, the portal's origin and
 *    a deadline still ahead.
 *
 * The network, the DID resolver and the membership check are passed in, so
 * this is tested without either; nothing here is reachable from a screen yet.
 *
 * @module trust-tasks/module/oobSignIn
 */
import type { Agent } from '@credo-ts/core'
import { TypedArrayEncoder, utils } from '@credo-ts/core'
import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'

import { jcsCanonicalize, verifyDocumentProof, wireTimestamp, type ProofPurpose } from '../documentProof'

import { resolveDidDocumentRetrying } from './VtiMediatorTransport'
import { readTrigger, serviceEndpointOfType, triggerAction, type TriggerAccept } from './triggerLink'

/** The `auth/oob` task types the wallet sends (trust-tasks-tf `specs/auth/oob/*`). */
export const OOB_TASKS = {
  claim: 'https://trusttasks.org/spec/auth/oob/claim/0.1',
  cancel: 'https://trusttasks.org/spec/auth/oob/cancel/0.1',
  /** Signed by the member's VTA as the persona (oobSignInAgent). */
  identify: 'https://trusttasks.org/spec/auth/oob/identify/0.1',
  prove: 'https://trusttasks.org/spec/auth/oob/prove/0.1',
  /** Signed by the member's VTA as the persona, on the phone's user verification (oobSignInAgent). */
  grant: 'https://trusttasks.org/spec/auth/oob/grant/0.1',
  respond: 'https://trusttasks.org/spec/auth/oob/respond/0.1',
} as const

/** The service types a sign-in community's DID document publishes. */
export const TRUST_TASK_HTTPS = 'TrustTaskHTTPS'
export const SIGN_IN_PORTAL = 'SignInPortal'

/** The only purpose Keyring signs in for. */
const LOGIN = 'login'

/**
 * Why a sign-in could not go ahead, for a screen to word:
 *  - `expired`, `invalid`, `update`, `unreachable`: what the scanner says of the code;
 *  - `notAMember`: the code is from a community this phone has not joined;
 *  - `noSignIn`: the community's DID document offers no sign-in endpoint;
 *  - `alreadyClaimed`: another phone took this code first;
 *  - `notFound`: the community no longer knows the request (the page was refreshed);
 *  - `refused`: the community said no for another reason;
 *  - `badAnswer`: the answer failed a check, so it was not believed.
 *
 * The later steps (oobSignInAgent):
 *  - `badNumber`: what was typed is not two digits; nothing was sent, type it again;
 *  - `wrongNumber`: the community says it is not the number on the page; the request is over;
 *  - `noVaultEntry`: the member's agent has no sign-in entry for this persona and community;
 *  - `notEnrolledDevice`: the agent does not know this phone as a registered device;
 *  - `noUvKey` / `uvRequired`: the agent has no Face ID approval key for this phone, or got no approval;
 *  - `uvCancelled`: the person cancelled the Face ID prompt; nothing was sent;
 *  - `uvKeyLost`: the approval key is gone (Face ID or fingerprints changed): set it up again;
 *  - `uvUnavailable`: the phone could not use its approval key;
 *  - `grantReplayed`: the agent already signed this approval;
 *  - `assertionMethodMissing`: the persona's DID document cannot approve sign-ins;
 *  - `agentRefused` / `agentUnreachable`: the member's own agent said no, or did not answer.
 */
export type SignInFailure =
  | 'expired'
  | 'invalid'
  | 'update'
  | 'unreachable'
  | 'notAMember'
  | 'noSignIn'
  | 'alreadyClaimed'
  | 'notFound'
  | 'refused'
  | 'badAnswer'
  | 'badNumber'
  | 'wrongNumber'
  | 'noVaultEntry'
  | 'notEnrolledDevice'
  | 'noUvKey'
  | 'uvRequired'
  | 'uvCancelled'
  | 'uvKeyLost'
  | 'uvUnavailable'
  | 'grantReplayed'
  | 'assertionMethodMissing'
  | 'agentRefused'
  | 'agentUnreachable'

/** The words for each, in the person's terms. */
export const SIGN_IN_FAILURE_MESSAGES: Record<SignInFailure, string> = {
  expired: 'This code has expired. Get a new one.',
  invalid: "This code can't be used.",
  update: 'This code needs a newer version of the app.',
  unreachable: "This service can't be reached from your wallet.",
  notAMember: "This sign-in code is from a community you haven't joined on this phone.",
  noSignIn: "This community doesn't offer sign-in from the app.",
  alreadyClaimed: 'Another device already scanned this code. Refresh the sign-in page and scan the new code.',
  notFound: 'This sign-in has ended. Refresh the sign-in page and scan the new code.',
  refused: "The community didn't accept this sign-in. Refresh the sign-in page and try again.",
  badAnswer: "The community's answer couldn't be checked, so nothing was signed in.",
  badNumber: 'Enter the two digits shown on the sign-in page.',
  wrongNumber: "That isn't the number on the sign-in page. Refresh the page and scan the new code.",
  noVaultEntry: "Your agent isn't set up to sign in to this community yet.",
  notEnrolledDevice: "This phone isn't registered with your agent, so it can't sign in.",
  noUvKey: "This phone isn't set up to approve sign-ins with your agent yet.",
  uvRequired: 'Your agent needs your approval on this phone to sign in.',
  uvCancelled: "The sign-in wasn't approved.",
  uvKeyLost: 'Your Face ID or fingerprints changed, so approving sign-ins must be set up again.',
  uvUnavailable: "This phone couldn't approve the sign-in.",
  grantReplayed: 'This approval was already used. Refresh the sign-in page and scan the new code.',
  assertionMethodMissing: "Your identity in this community can't approve sign-ins yet.",
  agentRefused: 'Your agent refused this sign-in.',
  agentUnreachable: "Your agent couldn't be reached.",
}

export class SignInError extends Error {
  constructor(
    readonly reason: SignInFailure,
    /** Which check failed, for the Release log and tests. Never the link, never a key. */
    readonly detail?: string,
    options: { responded?: boolean } = {}
  ) {
    super(SIGN_IN_FAILURE_MESSAGES[reason])
    this.name = 'SignInError'
    this.responded = options.responded ?? false
  }

  /**
   * Whether the grant may already have reached the community (`respond` was
   * sent, answered or not). Then the sign-in must NOT be cancelled: the VTC
   * cancels a request it already approved (findings G2).
   */
  readonly responded: boolean
}

/**
 * The community's refusals, by their FULL code: the VTC sends
 * `auth/oob/claim:alreadyClaimed`, not the bare `alreadyClaimed` the browser
 * plugin matches (findings G3). An unknown code is `refused`.
 */
const REFUSALS: Record<string, SignInFailure> = {
  'auth/oob/claim:alreadyClaimed': 'alreadyClaimed',
  // One try: a wrong number declines the request (vtc-service oob_tasks.rs:689-695).
  'auth/oob/prove:numberMismatch': 'wrongNumber',
  'auth/oob:requestExpired': 'expired',
  'auth/oob:requestNotFound': 'notFound',
}

/**
 * The throwaway key (K_a) that signs everything the wallet sends the
 * community for one sign-in, as an Ed25519 `did:key`.
 *
 * Held in memory, with @noble/curves, not in Credo's KMS:
 * `signDocumentProof` signs only through the agent's KMS, and a key made
 * there is written to the wallet's store and outlives the sign-in unless it
 * is found and deleted; the in-memory `ephemeral` KMS backend is reserved for
 * the VTA's persona keys (`vta-copy:` ids). K_a has no use beyond one
 * sign-in, is never a persona key, and is dropped with the session. The proof
 * is the same eddsa-jcs-2022 proof `signDocumentProof` makes (the same JCS,
 * the same whole-second timestamps), so the community reads them alike.
 */
export type ThrowawayKey = {
  did: string
  verificationMethod: string
  sign: (document: Record<string, unknown>, proofPurpose: ProofPurpose) => Record<string, unknown>
}

/** A did:key's multibase: base58btc of the Ed25519 multicodec (0xed01) and the raw key. */
function ed25519Multikey(publicKey: Uint8Array): string {
  const prefixed = new Uint8Array(2 + publicKey.length)
  prefixed.set([0xed, 0x01], 0)
  prefixed.set(publicKey, 2)
  return `z${TypedArrayEncoder.toBase58(prefixed)}`
}

/** An eddsa-jcs-2022 proof's configuration and the 64 bytes its signature covers. */
function eddsaJcsProofInput(
  document: Record<string, unknown>,
  verificationMethod: string,
  proofPurpose: ProofPurpose
): { proofConfig: Record<string, unknown>; signedInput: Uint8Array } {
  const proofConfig = {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-2022',
    created: wireTimestamp(wholeSecond()),
    verificationMethod,
    proofPurpose,
  }
  const configHash = sha256(new TextEncoder().encode(jcsCanonicalize(proofConfig)))
  const documentHash = sha256(new TextEncoder().encode(jcsCanonicalize(document)))
  const signedInput = new Uint8Array(64)
  signedInput.set(configHash, 0)
  signedInput.set(documentHash, 32)
  return { proofConfig, signedInput }
}

/** An eddsa-jcs-2022 proof over `document` by `secretKey`, named as `verificationMethod`. */
export function signWithKey(
  document: Record<string, unknown>,
  secretKey: Uint8Array,
  verificationMethod: string,
  proofPurpose: ProofPurpose
): Record<string, unknown> {
  const { proofConfig, signedInput } = eddsaJcsProofInput(document, verificationMethod, proofPurpose)
  const signature = ed25519.sign(signedInput, secretKey)
  return { ...document, proof: { ...proofConfig, proofValue: `z${TypedArrayEncoder.toBase58(signature)}` } }
}

/**
 * The same proof, made by a signer that holds its key elsewhere — the phone's
 * biometric-gated UV key, whose signature is made only after Face ID
 * (`uvKey.uvSign`). `sign` gets the 64-byte signing input and returns the raw
 * 64-byte Ed25519 signature.
 */
export async function signWithSigner(
  document: Record<string, unknown>,
  sign: (signedInput: Uint8Array) => Promise<Uint8Array>,
  verificationMethod: string,
  proofPurpose: ProofPurpose
): Promise<Record<string, unknown>> {
  const { proofConfig, signedInput } = eddsaJcsProofInput(document, verificationMethod, proofPurpose)
  const signature = await sign(signedInput)
  return { ...document, proof: { ...proofConfig, proofValue: `z${TypedArrayEncoder.toBase58(signature)}` } }
}

/** A fresh K_a. Its secret stays inside the closure. */
export function newThrowawayKey(secretKey: Uint8Array = ed25519.utils.randomSecretKey()): ThrowawayKey {
  const multikey = ed25519Multikey(ed25519.getPublicKey(secretKey))
  const did = `did:key:${multikey}`
  const verificationMethod = `${did}#${multikey}`
  return {
    did,
    verificationMethod,
    sign: (document, proofPurpose) => signWithKey(document, secretKey, verificationMethod, proofPurpose),
  }
}

/** Now, to the whole second: the VTC rebuilds instants without a fraction. */
const wholeSecond = () => new Date(Math.floor(Date.now() / 1000) * 1000)

/** A Trust Task envelope, as the member portal and the browser plugin build one. */
export function oobEnvelope(
  type: string,
  payload: Record<string, unknown>,
  issuer: string,
  recipient: string,
  parentThreadId: string
): Record<string, unknown> {
  return {
    id: `urn:uuid:${utils.uuid()}`,
    type,
    issuer,
    recipient,
    issuedAt: wireTimestamp(wholeSecond()),
    // Without it the VTC answers `malformedRequest` (findings, step 4).
    parentThreadId,
    payload,
  }
}

/** A DID document as sign-in reads it. */
export type SignInDidDocument = {
  id?: string
  service?: { id?: string; type?: unknown; serviceEndpoint?: unknown }[]
  [member: string]: unknown
}

export type SignInDeps = {
  /**
   * The community's DID document, its log VERIFIED (a did:webvh), or a throw.
   * Production: the Credo agent's resolver ({@link agentDidResolver}).
   */
  resolveDid: (did: string) => Promise<SignInDidDocument>
  /** POST a document as JSON and return the answer's JSON, error documents included. Production: {@link httpsPost}. */
  post: (url: string, document: Record<string, unknown>) => Promise<unknown>
  /** Whether Keyring's own records hold a current membership of this community. */
  isKnownCommunity: (vtcDid: string) => boolean | Promise<boolean>
  /** A fresh K_a; a test passes its own. */
  newKey?: () => ThrowawayKey
  /** Now, in seconds. */
  now?: () => number
}

/** A claimed sign-in: what the next steps (identify, prove, grant) need. */
export type ClaimedSignIn = {
  requestId: string
  vtcDid: string
  /** The `TrustTaskHTTPS` endpoint every later step posts to. */
  base: string
  /** The `SignInPortal` origin: the website the person is signing in to. */
  portalOrigin: string
  decisionDeadline: number
  keyA: ThrowawayKey
  /** The community's whole signed answer. */
  answer: Record<string, unknown>
}

const nowSeconds = (deps: { now?: () => number }) => deps.now?.() ?? Math.floor(Date.now() / 1000)

const tasksUrl = (base: string) => `${base.replace(/\/+$/, '')}/trust-tasks`

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** A `trust-task-error` answer's code, or undefined for any other answer. */
function errorCode(answer: Record<string, unknown>): string | undefined {
  if (!String(answer.type ?? '').includes('/trust-task-error/')) return undefined
  const payload = isObject(answer.payload) ? answer.payload : {}
  return typeof payload.code === 'string' ? payload.code : ''
}

/**
 * POST a document to the community's Trust Task endpoint and return its
 * answer; a refusal or a failure to reach it is a {@link SignInError}.
 * `responded` marks the errors of a `respond` send (see {@link SignInError.responded}).
 */
export async function sendToCommunity(
  deps: Pick<SignInDeps, 'post'>,
  base: string,
  document: Record<string, unknown>,
  options: { responded?: boolean } = {}
): Promise<Record<string, unknown>> {
  let answer: unknown
  try {
    answer = await deps.post(tasksUrl(base), document)
  } catch (e) {
    throw new SignInError('unreachable', e instanceof Error ? e.message : String(e), options)
  }
  if (!isObject(answer)) throw new SignInError('badAnswer', 'the answer is not a JSON object', options)
  const code = errorCode(answer)
  if (code !== undefined) throw new SignInError(REFUSALS[code] ?? 'refused', code || 'an error with no code', options)
  return answer
}

/** The community's name to show: the one in Keyring's records, else its DID — never the answer's `service.name`. */
export const signInCommunityLabel = (recordedName: string | undefined, vtcDid: string): string =>
  recordedName?.trim() || vtcDid

/** The origin of an https URL, or undefined. */
function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

/** Read a scanned link as a sign-in, or say why it isn't one Keyring can carry through. */
function signInTrigger(link: string | TriggerAccept, now: number): TriggerAccept {
  if (typeof link !== 'string') return link
  const action = triggerAction(readTrigger(link, { now }))
  if (action.kind === 'proceed' && action.flow === 'sign-in') return action.trigger
  const ui = action.kind === 'say' ? action.ui : 'update'
  throw new SignInError(ui === 'pass-on' ? 'invalid' : ui)
}

/**
 * Check the community's answer to a claim; a reason when it fails. Every
 * check is one the spec asks of the wallet (claim/spec.md), and each was
 * measured against a live community by ref-22.
 */
async function answerProblem(
  answer: Record<string, unknown>,
  expected: {
    vtcDid: string
    vtcDocument: SignInDidDocument
    claimId: string
    keyA: string
    requestId: string
    portalOrigin: string
    now: number
  }
): Promise<string | undefined> {
  // The document already resolved is the one checked against: no second
  // resolution that could answer differently.
  const resolver = { dids: { resolveDidDocument: async () => expected.vtcDocument } } as unknown as Agent
  if (!(await verifyDocumentProof(resolver, answer, expected.vtcDid, { proofPurpose: 'assertionMethod' }))) {
    return "the answer is not signed by a key under the community's assertionMethod"
  }
  if (answer.threadId !== expected.claimId) return 'the answer does not thread to the claim'
  if (answer.recipient !== expected.keyA) return 'the answer is not addressed to this claim key'
  const payload = isObject(answer.payload) ? answer.payload : {}
  if (payload.requestId !== expected.requestId) return 'the answer names another request'
  const service = isObject(payload.service) ? payload.service : {}
  if (service.did !== expected.vtcDid) return 'the answer names another community'
  if (payload.purpose !== LOGIN) return 'the answer is not for signing in'
  if (payload.origin !== expected.portalOrigin) return "the answer's origin is not the community's sign-in portal"
  const deadline = payload.decisionDeadline
  if (typeof deadline !== 'number' || !Number.isInteger(deadline)) return 'the answer has no decision deadline'
  if (deadline <= expected.now) return 'the decision deadline has passed'
  return undefined
}

/**
 * Claim a scanned sign-in code for this phone. On success the browser shows
 * its two-digit number and waits; the caller asks the person to confirm and
 * carries on with identify. Throws a {@link SignInError} otherwise — before
 * any network call when the code cannot be used or the community is not one
 * this phone has joined.
 */
export async function claimSignIn(link: string | TriggerAccept, deps: SignInDeps): Promise<ClaimedSignIn> {
  const trigger = signInTrigger(link, nowSeconds(deps))
  const vtcDid = trigger.from
  const requestId = trigger.id

  // Local, and first: a code from a community this phone has not joined
  // reaches nobody, not even the community's DID host.
  if (!(await deps.isKnownCommunity(vtcDid))) throw new SignInError('notAMember')

  let vtcDocument: SignInDidDocument
  try {
    vtcDocument = await deps.resolveDid(vtcDid)
  } catch (e) {
    throw new SignInError('unreachable', e instanceof Error ? e.message : String(e))
  }
  if (vtcDocument.id !== vtcDid) throw new SignInError('badAnswer', 'the DID document is for another DID')

  // By type, from the verified document; the link names no endpoint.
  const base = serviceEndpointOfType(vtcDocument, TRUST_TASK_HTTPS)
  const portal = serviceEndpointOfType(vtcDocument, SIGN_IN_PORTAL)
  const portalOrigin = portal ? originOf(portal) : undefined
  if (!base || !portalOrigin) throw new SignInError('noSignIn')

  const keyA = (deps.newKey ?? newThrowawayKey)()
  const claim = keyA.sign(
    oobEnvelope(OOB_TASKS.claim, { requestId }, keyA.did, vtcDid, requestId),
    // K_a proves control of itself to the community: `authentication`.
    'authentication'
  )
  const answer = await sendToCommunity(deps, base, claim)
  const problem = await answerProblem(answer, {
    vtcDid,
    vtcDocument,
    claimId: claim.id as string,
    keyA: keyA.did,
    requestId,
    portalOrigin,
    now: nowSeconds(deps),
  })
  if (problem) throw new SignInError('badAnswer', problem)

  return {
    requestId,
    vtcDid,
    base,
    portalOrigin,
    decisionDeadline: (answer.payload as { decisionDeadline: number }).decisionDeadline,
    keyA,
    answer,
  }
}

/**
 * Give a claimed sign-in up: how Keyring declines, too, since the VTA refuses
 * a declining grant (findings G1). Never sent after `respond` — the VTC would
 * cancel a request already approved (G2). The answer is signed for
 * `authentication`, not `assertionMethod`, and carries nothing the wallet acts
 * on, so only its status is read.
 */
export async function cancelSignIn(
  session: Pick<ClaimedSignIn, 'requestId' | 'vtcDid' | 'base' | 'keyA'>,
  deps: Pick<SignInDeps, 'post'>
): Promise<{ cancelled: boolean }> {
  const { requestId, vtcDid, base, keyA } = session
  const cancel = keyA.sign(oobEnvelope(OOB_TASKS.cancel, { requestId }, keyA.did, vtcDid, requestId), 'authentication')
  const answer = await sendToCommunity(deps, base, cancel)
  const payload = isObject(answer.payload) ? answer.payload : {}
  return { cancelled: payload.status === 'cancelled' }
}

/** How long a sign-in request may take to answer. The VTC holds a claim open only briefly. */
export const SIGN_IN_POST_TIMEOUT_MS = 40_000

/**
 * POST a Trust Task document to the HTTPS binding and return the answer's
 * JSON, error documents included (they are answers too). No Origin header: the
 * VTC takes a request only from its portal's origin, and a wallet is not that
 * (findings M2) — it never sends a request, only what follows one.
 */
export async function httpsPost(url: string, document: Record<string, unknown>): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SIGN_IN_POST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(document),
      signal: controller.signal,
    })
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The Credo agent's resolver as sign-in's `resolveDid`: Credo's did:webvh
 * resolver (`RetryingWebVhDidResolver`, over didwebvh-ts) returns a document
 * only when its log verifies. Bounded and retried, as every other community
 * lookup in Keyring is, so a host that never answers cannot hold the screen.
 */
export const agentDidResolver =
  (agent: Agent) =>
  async (did: string): Promise<SignInDidDocument> => {
    const document = await resolveDidDocumentRetrying(agent, did)
    return document.toJSON() as SignInDidDocument
  }
