/**
 * oobSignInAgent — the steps of a trigger-link sign-in after the claim, where
 * the member's own agent (their VTA) vouches for them: identify and prove
 * (step 2), then the grant, approved on the phone with Face ID, and respond.
 *
 * Ported from the reference rungs that ran them against VTI main 03a3562f
 * (keyring-wallet `tsp-reference/ref-23-oob-identify`, 10/10, and
 * `ref-24-oob-grant`, 15/15) and the findings beside them
 * (`docs/spikes/20261011-oob-sign-in-findings.md`, ref-23, ref-24, G1, G2,
 * G9–G11):
 *
 *  - the phone never signs as the persona: the VTA signs `identify` (for
 *    `authentication`) and the grant (for `assertionMethod`) with
 *    `vault/sign-trust-task`, from the persona's `did-self-issued` vault
 *    entry, and both come back checked: the same document (JCS-equal — the VTA
 *    may reorder keys) plus the persona's proof for that purpose;
 *  - the grant is signed only on the phone's user verification: a
 *    `task-consent/decision/0.2` over the unsigned grant's digest, signed by
 *    the biometric-gated UV key ({@link enrolUvKey}, uvKey.ts);
 *  - declining is not a grant: the screen calls `cancelSignIn` (G1). Nothing
 *    is ever cancelled once `respond` may have been sent (G2;
 *    {@link SignInError.responded}).
 *
 * Network, resolver, agent and UV key are passed in, so this is tested without
 * any. The sign-in screen reaches it through signInSteps.
 *
 * @module trust-tasks/module/oobSignInAgent
 */
import type { Agent } from '@credo-ts/core'
import { TypedArrayEncoder, utils } from '@credo-ts/core'
import { sha256 } from '@noble/hashes/sha2.js'

import { jcsCanonicalize, verifyDocumentProof, wireTimestamp, type ProofPurpose } from '../documentProof'

import {
  OOB_TASKS,
  SignInError,
  agentDidResolver,
  httpsPost,
  decisionDeadlineOf,
  isUnsupportedTaskCode,
  oobEnvelope,
  sendToCommunity,
  signingScopeProblem,
  signWithSigner,
  type ClaimedSignIn,
  type OobVersion,
  type SignInDeps,
  type SignInDidDocument,
  type SignInFailure,
} from './oobSignIn'
import type { VtaClient, VtaSealedSecret, VtaVaultEntry } from './VtaClient'
import { defaultDeviceName, heartbeat as beatAgent, registerThisDevice } from './vtaDevices'
import { VtiRefusal } from './vtiAgent'
import { didKeyVerificationMethod, getUvDid, resetUvKey, uvSign, UvKeyError } from './uvKey'

/** The decision version the VTA verifies a UV approval as (oob_sign_in.rs:92, :624-635; not grant spec's `consent/decision`, G9). */
export const UV_DECISION_TASK = 'https://trusttasks.org/spec/task-consent/decision/0.2'
/** `device/register`/`device/heartbeat` extension enrolling a UV key (vta-sdk device_management.rs:113). */
export const EXT_UV_KEY = 'org.openvtc.uv-key'
/** `vault/sign-trust-task` extension carrying the UV decision (vta-sdk device_management.rs:122). */
export const EXT_UV_CONSENT = 'org.openvtc.uv-consent'
/** The vault secret kind a persona's sign-in entry has (0.1 spelling; 0.2 says `didSelfIssued`). */
export const DID_SELF_ISSUED = 'did-self-issued'

/**
 * The label the sign-in entries Keyring makes carry, `Keyring sign-in · <community DID>` ({@link ensureSignInVaultEntry}):
 * how a sign-in tells Keyring's own entries from ones made elsewhere (the browser plugin).
 */
export const KEYRING_SIGN_IN_LABEL = 'Keyring sign-in'

/**
 * How long the session the grant opens may last at most: the grant's notAfter. The VTC ends the session at the
 * earlier of this and its own refresh-token expiry (24 h by default), refreshing access silently until then, and a
 * 0.2 signing scope dies with it (maintainer, IN-280). 12 h, as the browser plugin grants; the approval screen says
 * it in hours, read from here.
 */
export const GRANT_LIFETIME_SECONDS = 12 * 60 * 60

/** Each sign-in version's prove, grant and respond types. */
const PROVE_AT: Record<OobVersion, string> = {
  '0.1': OOB_TASKS.prove,
  '0.2': OOB_TASKS.prove02,
  '0.3': OOB_TASKS.prove03,
}
const GRANT_AT: Record<OobVersion, string> = {
  '0.1': OOB_TASKS.grant,
  '0.2': OOB_TASKS.grant02,
  '0.3': OOB_TASKS.grant03,
}
const RESPOND_AT: Record<OobVersion, string> = {
  '0.1': OOB_TASKS.respond,
  '0.2': OOB_TASKS.respond02,
  '0.3': OOB_TASKS.respond03,
}

/** The Face ID prompt's words when approving. */
export const UV_APPROVE_PROMPT = 'Approve signing in'

/** The member's VTA, as the sign-in steps use it. Production: {@link vtaSignInPort}. */
export interface SignInVta {
  /** The VTA's DID: the UV decision is addressed to it (oob_sign_in.rs:644-649). */
  did: string
  /** `vault/sign-trust-task/0.2`: the signed envelope, or a throw (a `VtiRefusal` when refused). */
  signTrustTask(request: {
    entryId: string
    unsignedEnvelope: Record<string, unknown>
    ext?: Record<string, unknown>
  }): Promise<Record<string, unknown>>
  /** `vault/list`: entry metadata. */
  vaultList(filters: Record<string, unknown>): Promise<VtaVaultEntry[]>
  /** `vault/upsert`: the created or updated entry. */
  vaultUpsert(payload: Record<string, unknown>): Promise<{ entry?: VtaVaultEntry; created?: boolean }>
  /** Seal a cleartext vault secret to the VTA (`didcomm-authcrypt`, from the caller). */
  sealVaultSecret(secret: Record<string, unknown>): Promise<VtaSealedSecret>
  /** `device/heartbeat/0.2` carrying `ext`. */
  heartbeat(ext: Record<string, unknown>): Promise<void>
  /** `device/register/0.2` carrying `ext`; `alreadyRegistered` when the phone already is. */
  register(ext: Record<string, unknown>): Promise<'registered' | 'alreadyRegistered'>
}

export type SignInAgentDeps = Pick<SignInDeps, 'post' | 'resolveDid' | 'now'> & {
  vta: SignInVta
  /** The UV key's `did:key` (uvKey.getUvDid). */
  uvDid: () => Promise<string>
  /** Sign with the UV key; shows the system Face ID prompt (uvKey.uvSign). */
  uvSign: (bytes: Uint8Array, prompt: string) => Promise<Uint8Array>
  /** Forget the UV key, so the next `uvDid` makes a new one (uvKey.resetUvKey). */
  uvReset: () => Promise<void>
}

/** The persona that signs in, and its vault entry ({@link ensureSignInVaultEntry}). */
export type SignInPersona = { did: string; entryId: string }

export type IdentifyDeps = Pick<SignInAgentDeps, 'post' | 'resolveDid' | 'now' | 'vta'> & { persona: SignInPersona }

/** What the browser told the community about itself (step 2's `requester`). */
export type SignInRequester = {
  browser: string
  os: string
  location: string
  sameNetwork: boolean
  createdAt: string
}

/** A proved sign-in: everything the approval screen shows, and what the grant needs. */
export type ProvedSignIn = {
  claimed: ClaimedSignIn
  /** The community's whole signed step-2 reply, as received: the grant's `contextDigest` is over it. */
  step2: Record<string, unknown>
  /** The browser's key (K_b) the grant lets act as the member. */
  sessionKey: string
  requester: SignInRequester
  /** Who the community identified: the persona. */
  identifiedAs: string
  persona: SignInPersona
  /** The `prove` / `grant` / `respond` version the community took: 0.2, or 0.1 from a community before it. */
  version: OobVersion
  /** The prove versions asked, newest first, ending with `version`. For the Release log. */
  provesTried?: OobVersion[]
  /**
   * 0.2: the task families the community offers to let the browser's key sign as the member, for the session
   * (step 2's `signingScope`, checked). The grant copies it unchanged; the approval screen says it in words.
   */
  signingScope?: string[]
}

const nowSeconds = (deps: { now?: () => number }) => deps.now?.() ?? Math.floor(Date.now() / 1000)

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)

/**
 * `DigestMultibase`: `z` + base58btc(0x12 0x20 ‖ sha256(JCS(value))). The
 * grant's `contextDigest` (vtc-service member_portal/oob.rs:728-737) and the
 * UV decision's digest (vta-service oob_sign_in.rs:376-391) are both this.
 */
export function digestMultibase(value: unknown): string {
  const hash = sha256(new TextEncoder().encode(jcsCanonicalize(value)))
  const multihash = new Uint8Array(34)
  multihash.set([0x12, 0x20], 0)
  multihash.set(hash, 2)
  return `z${TypedArrayEncoder.toBase58(multihash)}`
}

/**
 * An `identify` or a `grant` as the VTA signs it: the framework members and
 * nothing else (oob_sign_in.rs:99-111), shaped as ref-23 and ref-24 sent them.
 */
function personaDocument(type: string, payload: Record<string, unknown>, persona: string, vtcDid: string) {
  return {
    id: `urn:uuid:${utils.uuid()}`,
    type,
    issuer: persona,
    recipient: vtcDid,
    issuedAt: wireTimestamp(new Date(Math.floor(Date.now() / 1000) * 1000)),
    payload,
  }
}

/**
 * The sign-in refusals a VTA sends, by their local code. Over a Trust Task
 * they arrive as a top-level `taskFailed` with `vault/sign-trust-task:<code>`
 * in the message and `details.code` (vta-service trust_tasks/vault.rs:1862-1869;
 * G10). Any other code is `agentRefused`.
 */
const AGENT_REFUSALS: Record<string, SignInFailure> = {
  oobUvRequired: 'uvRequired',
  oobNotEnrolledDevice: 'notEnrolledDevice',
  oobNoUvKey: 'noUvKey',
  oobGrantReplayed: 'grantReplayed',
  oobAssertionMethodMissing: 'assertionMethodMissing',
  // An agent from before auth/oob/grant/0.2 (VTI #2190): approveSignIn grants at 0.1 instead when it can.
  oobUnsupportedType: 'agentNeedsUpdate',
  // The entry is gone (vault.rs:1794).
  notFound: 'noVaultEntry',
  // An agent from before sign-in signing (VTI #1997): it serves only
  // vault/sign-trust-task/0.1, so 0.2 is a known family at an unknown
  // version (vta-service trust_tasks/helpers.rs method_not_found).
  unsupportedVersion: 'agentNeedsUpdate',
  unsupportedType: 'agentNeedsUpdate',
}

/** The local code inside a VTA's refusal: `details.code`, else the `<task>:<code>` in its message. */
function agentRefusalCode(refusal: VtiRefusal): string {
  const details = refusal.details as { code?: unknown } | undefined
  if (typeof details?.code === 'string' && details.code) return details.code
  const inner = /\bvault\/[a-z-]+:([A-Za-z_]+)/.exec(refusal.message)
  return inner?.[1] ?? refusal.code
}

/** A failed call to the member's VTA, as a {@link SignInError}. Never echoes key material: only codes. */
export function signInFailureFromAgent(error: unknown, options: { responded?: boolean } = {}): SignInError {
  if (error instanceof SignInError) return error
  if (error instanceof VtiRefusal) {
    const code = agentRefusalCode(error)
    return new SignInError(AGENT_REFUSALS[code] ?? 'agentRefused', code, options)
  }
  return new SignInError('agentUnreachable', error instanceof Error ? error.message : String(error), options)
}

/** `error`, with the sign-in versions asked noted on it when it is a sign-in error. */
function withTried(error: unknown, tried: NonNullable<SignInError['tried']>): unknown {
  if (error instanceof SignInError) error.tried = { ...error.tried, ...tried }
  return error
}

export async function resolveOrUnreachable(
  deps: Pick<SignInDeps, 'resolveDid'>,
  did: string
): Promise<SignInDidDocument> {
  let document: SignInDidDocument
  try {
    document = await deps.resolveDid(did)
  } catch (e) {
    throw new SignInError('unreachable', e instanceof Error ? e.message : String(e))
  }
  if (document.id !== did) throw new SignInError('badAnswer', `the DID document for ${did} is for another DID`)
  return document
}

/** Verify `document`'s proof against an already-resolved DID document: no second resolution. */
export function proofVerifies(
  document: Record<string, unknown>,
  controller: string,
  controllerDocument: SignInDidDocument,
  proofPurpose: ProofPurpose
): Promise<boolean> {
  const resolver = { dids: { resolveDidDocument: async () => controllerDocument } } as unknown as Agent
  return verifyDocumentProof(resolver, document, controller, { proofPurpose })
}

/**
 * Have the VTA sign `unsigned` as the persona, and check what comes back:
 * the same document plus the persona's proof for `proofPurpose`.
 */
async function signedByAgent(
  deps: Pick<SignInAgentDeps, 'vta' | 'resolveDid'>,
  persona: SignInPersona,
  unsigned: Record<string, unknown>,
  proofPurpose: ProofPurpose,
  ext?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  let signed: Record<string, unknown>
  try {
    signed = await deps.vta.signTrustTask({
      entryId: persona.entryId,
      unsignedEnvelope: unsigned,
      ...(ext ? { ext } : {}),
    })
  } catch (error) {
    throw signInFailureFromAgent(error)
  }
  if (!isObject(signed)) throw new SignInError('badAnswer', 'the agent returned no document')
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { proof, ...rest } = signed
  // The same JSON value, not the same bytes: the VTA re-serialises (ref-23).
  if (jcsCanonicalize(rest) !== jcsCanonicalize(unsigned)) {
    throw new SignInError('badAnswer', 'the agent changed the document it signed')
  }
  const personaDidDocument = await resolveOrUnreachable(deps, persona.did)
  if (!(await proofVerifies(signed, persona.did, personaDidDocument, proofPurpose))) {
    // An agent from before sign-in signing (VTI #1997; vta-service 0.56.0,
    // VTI-Eucalyptus) serves this task but signs every document for
    // `authentication`, so a grant comes back the persona's yet for the wrong
    // purpose (findings F1). That is an agent that needs an update, not a bad
    // answer: say so in those words.
    if (
      proofPurpose === 'assertionMethod' &&
      (await proofVerifies(signed, persona.did, personaDidDocument, 'authentication'))
    ) {
      throw new SignInError(
        'agentNeedsUpdate',
        'the agent signed the grant for authentication, as agents before #1997 do'
      )
    }
    throw new SignInError('badAnswer', `the agent's proof is not the persona's, for ${proofPurpose}`)
  }
  return signed
}

/**
 * Check the community's step-2 reply; a reason when it fails. It is step 1
 * repeated (vtc-service oob_tasks.rs:698-724) — so each of the claim answer's
 * members must come back unchanged — plus the browser's key, the requester
 * and who was identified.
 */
export async function step2Problem(
  step2: Record<string, unknown>,
  expected: { claimed: ClaimedSignIn; vtcDocument: SignInDidDocument; proveId: string; persona: string; now: number }
): Promise<string | undefined> {
  const { claimed } = expected
  if (!(await proofVerifies(step2, claimed.vtcDid, expected.vtcDocument, 'assertionMethod'))) {
    return "step 2 is not signed by a key under the community's assertionMethod"
  }
  if (step2.threadId !== expected.proveId) return 'step 2 does not thread to the prove'
  if (step2.recipient !== claimed.keyA.did) return 'step 2 is not addressed to this claim key'
  const payload = isObject(step2.payload) ? step2.payload : {}
  const step1 = isObject(claimed.answer.payload) ? claimed.answer.payload : {}
  for (const member of ['requestId', 'service', 'origin', 'purpose']) {
    if (jcsCanonicalize(payload[member] ?? null) !== jcsCanonicalize(step1[member] ?? null)) {
      return `step 2 does not repeat step 1's ${member}`
    }
  }
  // The same instant, whichever way each step spells it (decisionDeadline, or decisionClosesAt from claim 0.2 /
  // prove 0.3).
  const deadline = decisionDeadlineOf(payload)
  if (deadline !== decisionDeadlineOf(step1)) return "step 2 does not repeat step 1's decision deadline"
  if (payload.origin !== claimed.portalOrigin) return "step 2's origin is not the community's sign-in portal"
  if (deadline === undefined || deadline <= expected.now) return 'the decision deadline has passed'
  if (typeof payload.sessionKey !== 'string' || !/^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]+$/.test(payload.sessionKey)) {
    return "step 2's session key is not an Ed25519 did:key"
  }
  if (payload.identifiedAs !== expected.persona) return 'step 2 identified someone else'
  if (!isObject(payload.requester)) return 'step 2 does not describe the requester'
  if (payload.signingScope !== undefined) {
    const scopeProblem = signingScopeProblem(payload.signingScope)
    if (scopeProblem) return scopeProblem
  }
  return undefined
}

/**
 * Tell the community who is signing in, with the number the person typed:
 * the member's VTA signs `auth/oob/identify/0.1` as the persona, the phone
 * sends it in `auth/oob/prove/0.2` under K_a (0.1 to a community before 0.2,
 * which refuses 0.2 as a type or version it does not serve), and the
 * community's step-2 reply is checked before anything of it is shown.
 *
 * A typed value that is not two digits is refused before anything is sent
 * (`badNumber`); a number the community says is wrong ends the request
 * (`wrongNumber`, one try).
 */
export async function identifyAndProve(
  claimed: ClaimedSignIn,
  enteredNumber: string,
  deps: IdentifyDeps
): Promise<ProvedSignIn> {
  const number = enteredNumber.trim()
  if (!/^\d{2}$/.test(number)) throw new SignInError('badNumber')
  if (claimed.decisionDeadline <= nowSeconds(deps)) throw new SignInError('expired', 'the decision deadline has passed')
  const { persona } = deps
  const { requestId, vtcDid, keyA, base } = claimed

  const unsignedIdentify = personaDocument(
    OOB_TASKS.identify,
    { requestId, approverKey: keyA.did, enteredNumber: number },
    persona.did,
    vtcDid
  )
  const identify = await signedByAgent(deps, persona, unsignedIdentify, 'authentication')

  const proveAt = (at: OobVersion) =>
    keyA.sign(oobEnvelope(PROVE_AT[at], { identify }, keyA.did, vtcDid, requestId), 'authentication')
  // Newest first: 0.3, then 0.2, then 0.1. A community that does not serve one refuses the type at dispatch,
  // before the request is touched, so the same identify proves again one version down.
  const ladder: OobVersion[] = ['0.3', '0.2', '0.1']
  let version: OobVersion = ladder[0]
  let prove = proveAt(version)
  const provesTried: OobVersion[] = [version]
  let step2: Record<string, unknown> | undefined
  for (let i = 0; !step2; ) {
    try {
      step2 = await sendToCommunity(deps, base, prove)
    } catch (error) {
      const unsupported =
        error instanceof SignInError && error.reason === 'refused' && isUnsupportedTaskCode(error.detail)
      if (!unsupported || ++i >= ladder.length) throw withTried(error, { prove: provesTried })
      version = ladder[i]
      prove = proveAt(version)
      provesTried.push(version)
    }
  }
  const vtcDocument = await resolveOrUnreachable(deps, vtcDid)
  const problem = await step2Problem(step2, {
    claimed,
    vtcDocument,
    proveId: prove.id as string,
    persona: persona.did,
    now: nowSeconds(deps),
  })
  if (problem) throw withTried(new SignInError('badAnswer', problem), { prove: provesTried })

  const payload = step2.payload as Record<string, unknown>
  const requester = payload.requester as Record<string, unknown>
  return {
    claimed,
    step2,
    sessionKey: payload.sessionKey as string,
    requester: {
      browser: str(requester.browser, 'unknown'),
      os: str(requester.os, 'unknown'),
      location: str(requester.location, 'unknown'),
      sameNetwork: requester.sameNetwork === true,
      createdAt: str(requester.createdAt),
    },
    identifiedAs: payload.identifiedAs as string,
    persona,
    version,
    provesTried,
    // Only a 0.2 or 0.3 grant can carry it; checked by step2Problem.
    ...(version !== '0.1' && Array.isArray(payload.signingScope)
      ? { signingScope: [...(payload.signingScope as string[])] }
      : {}),
  }
}

/** The UV failure, in the sign-in's words. */
function uvFailure(error: unknown): SignInError {
  const reason = error instanceof UvKeyError ? error.reason : (error as { reason?: unknown } | undefined)?.reason
  const detail = error instanceof Error ? error.message : String(error)
  if (reason === 'cancelled') return new SignInError('uvCancelled', detail)
  if (reason === 'lost') return new SignInError('uvKeyLost', detail)
  return new SignInError('uvUnavailable', detail)
}

/**
 * Approve a proved sign-in: build the grant, have the person approve it with
 * Face ID (the UV key signs a decision over the unsigned grant's digest), have
 * the member's VTA sign the grant as the persona for `assertionMethod`, and
 * hand it to the community in `respond`.
 *
 * Every error before `respond` leaves the request open (cancel it, or let it
 * expire); every error from `respond` on has `responded: true`, and the
 * request must then not be cancelled (G2).
 */
export async function approveSignIn(proved: ProvedSignIn, deps: SignInAgentDeps): Promise<{ status: 'approved' }> {
  const { claimed, step2, sessionKey, persona } = proved
  const { requestId, vtcDid, keyA, base, portalOrigin } = claimed
  const now = nowSeconds(deps)
  if (claimed.decisionDeadline <= now) throw new SignInError('expired', 'the decision deadline has passed')

  // The grant at a version, approved with Face ID and signed by the member's VTA. At 0.2 it copies step 2's
  // signingScope unchanged (the community holds the two equal; absent, the grant delegates no signing).
  const grantAt = async (at: OobVersion): Promise<Record<string, unknown>> => {
    const unsignedGrant = personaDocument(
      GRANT_AT[at],
      {
        requestId,
        decision: 'approve',
        sessionKey,
        approverKey: keyA.did,
        origin: portalOrigin,
        // Over the whole signed step 2 as received, proof included (grant spec producer rule 1).
        contextDigest: digestMultibase(step2),
        // 0.3 names the same instant `sessionEndsAt`, as RFC 3339 (auth/oob/grant/0.3).
        ...(at === '0.3'
          ? { sessionEndsAt: wireTimestamp(new Date((now + GRANT_LIFETIME_SECONDS) * 1000)) }
          : { notAfter: now + GRANT_LIFETIME_SECONDS }),
        ...(at !== '0.1' && proved.signingScope ? { signingScope: proved.signingScope } : {}),
      },
      persona.did,
      vtcDid
    )

    // The person's approval of exactly this grant: challenge and payloadDigest
    // are both its digest (oob_sign_in.rs:681-694).
    const digest = digestMultibase(unsignedGrant)
    let decision: Record<string, unknown>
    try {
      const uvDid = await deps.uvDid()
      decision = await signWithSigner(
        {
          id: `urn:uuid:${utils.uuid()}`,
          // version-pinned: the VTA verifies a UV approval only as decision 0.2 (UV_DECISION_TASK)
          type: UV_DECISION_TASK,
          issuer: uvDid,
          recipient: deps.vta.did,
          issuedAt: wireTimestamp(new Date(Math.floor(Date.now() / 1000) * 1000)),
          payload: { challenge: digest, payloadDigest: digest, decision: 'approve' },
        },
        (input) => deps.uvSign(input, UV_APPROVE_PROMPT),
        didKeyVerificationMethod(uvDid),
        // A decision is an attestation (proofPurpose.ts ATTESTATION_SLUGS; ref-24).
        'assertionMethod'
      )
    } catch (error) {
      throw uvFailure(error)
    }

    return signedByAgent(deps, persona, unsignedGrant, 'assertionMethod', {
      [EXT_UV_CONSENT]: { decision },
    })
  }

  let version = proved.version
  const tried = { prove: proved.provesTried ?? [proved.version], grant: [version] }
  let grant: Record<string, unknown>
  try {
    try {
      grant = await grantAt(version)
    } catch (error) {
      // The member's VTA is older than auth/oob/grant/0.2 (VTI #2190) while the community is not: grant at 0.1
      // under the same step 2. The community holds the scopes equal only for a 0.2 respond, so this signs in with
      // nothing delegated. The Face ID approval names one grant's digest, so the 0.1 grant asks once more.
      if (version !== '0.2' || !(error instanceof SignInError) || error.detail !== 'oobUnsupportedType') throw error
      version = '0.1'
      tried.grant.push(version)
      grant = await grantAt(version)
    }
  } catch (error) {
    // Which grant versions were asked goes with the error to the Release line (IN-390).
    throw withTried(error, tried)
  }

  const respond = keyA.sign(oobEnvelope(RESPOND_AT[version], { grant }, keyA.did, vtcDid, requestId), 'authentication')
  const answer = await sendToCommunity(deps, base, respond, { responded: true })
  // The answer is the community's attestation, signed for `assertionMethod`
  // like steps 1 and 2, since VTI b345ebd1 (2026-10-11, #2024). A community
  // on an earlier build signs it for `authentication` (findings G2, VTI
  // 03a3562f); both are the community's own key, so either is taken. Pinning
  // the older purpose ended a sign-in the community had already completed in
  // "the community's answer couldn't be checked" (report 26JE-SQ6R).
  const vtcDocument = await resolveOrUnreachable(deps, vtcDid).catch((e: SignInError) => {
    throw new SignInError(e.reason, e.detail, { responded: true })
  })
  if (
    !(await proofVerifies(answer, vtcDid, vtcDocument, 'assertionMethod')) &&
    !(await proofVerifies(answer, vtcDid, vtcDocument, 'authentication'))
  ) {
    throw new SignInError('badAnswer', "the respond answer is not signed by the community's own key", {
      responded: true,
    })
  }
  const status = isObject(answer.payload) ? answer.payload.status : undefined
  if (status !== 'approved') {
    throw new SignInError('refused', `the community answered ${String(status)}`, { responded: true })
  }
  return { status: 'approved' }
}

const isDidSelfIssued = (kind: unknown) => kind === DID_SELF_ISSUED || kind === 'didSelfIssued'

/**
 * The persona's `did-self-issued` vault entry for a community, made if it is
 * missing: the entry `vault/sign-trust-task` signs identify and grant from.
 * The VTA makes none when the phone joins (findings F2, confirmed by ref-23).
 *
 * Found: an active entry whose principal is the persona and whose targets
 * include the community's DID. Made: `vault/upsert` with the cleartext secret
 * `{kind: did-self-issued, did, signingKeyId}` sealed to the VTA — required on
 * create despite the upsert doc comment (vta-service trust_tasks/vault.rs:
 * 115-118 against :826-870). The secret is never logged; it names a key, it
 * holds none.
 */
export async function ensureSignInVaultEntry(
  vtcDid: string,
  persona: { did: string; signingKeyId: string; contextId: string; label?: string },
  deps: Pick<SignInAgentDeps, 'vta'>
): Promise<string> {
  try {
    const entries = await deps.vta.vaultList({ contextId: persona.contextId, targetDid: vtcDid })
    const found = entries.find(
      (entry) =>
        entry.principalDid === persona.did &&
        isDidSelfIssued(entry.secretKind) &&
        (entry.status === undefined || entry.status === 'active') &&
        (entry.targets ?? []).some((target) => target.kind === 'did' && target.did === vtcDid)
    )
    if (found?.id) return found.id

    let sealedSecret: VtaSealedSecret
    try {
      sealedSecret = await deps.vta.sealVaultSecret({
        kind: DID_SELF_ISSUED,
        did: persona.did,
        signingKeyId: persona.signingKeyId,
      })
    } catch (error) {
      throw new SignInError('noVaultEntry', `the secret could not be sealed to the agent: ${(error as Error)?.message}`)
    }
    const { entry } = await deps.vta.vaultUpsert({
      contextId: persona.contextId,
      targets: [{ kind: 'did', did: vtcDid }],
      label: persona.label ?? `${KEYRING_SIGN_IN_LABEL} · ${vtcDid}`,
      secretKind: DID_SELF_ISSUED,
      sealedSecret,
    })
    if (!entry?.id) throw new SignInError('noVaultEntry', 'the agent made no entry')
    return entry.id
  } catch (error) {
    throw signInFailureFromAgent(error)
  }
}

/**
 * Enrol the UV key and approve, setting the key up again once if it is gone.
 *
 * A key the OS no longer reads (Face ID or fingerprints changed) read as
 * `uvKeyLost` on every approval after, since the DID kept beside it still
 * named it and no new key was ever made. Now it is forgotten, a new one is
 * made and enrolled (a heartbeat replaces the UV key, vta-service
 * operations/device.rs:252-272), and the approval asked once more. `uvKeyLost`
 * is thrown before the agent signs anything or the community hears of it, so
 * asking again is safe; a second loss is said as it is.
 */
export async function approveSignInWithUvKey(
  proved: ProvedSignIn,
  deps: SignInAgentDeps
): Promise<{ status: 'approved' }> {
  await enrolUvKey(deps)
  try {
    return await approveSignIn(proved, deps)
  } catch (error) {
    if (!(error instanceof SignInError) || error.reason !== 'uvKeyLost') throw error
    await deps.uvReset()
    await enrolUvKey(deps)
    return approveSignIn(proved, deps)
  }
}

/**
 * Enrol the phone's UV key with the member's VTA, so it can approve grants.
 * Idempotent: a heartbeat carrying the key replaces whatever key the binding
 * had (vta-service operations/device.rs:252-272) — the same key again changes
 * nothing. A phone not registered yet registers with it instead.
 *
 * `hardwareBacked: false`: the key is an Ed25519 key in Keychain/Keystore
 * storage behind biometric access control, not in the Secure Enclave
 * (uvKey.ts). The VTA records both flags as claims and requires only
 * `biometricGated` of a hardware UV key (vta-sdk device_management.rs:136-142,
 * :245-261); an Ed25519 `did:key` is accepted (:215-222, :252-256).
 */
export async function enrolUvKey(deps: Pick<SignInAgentDeps, 'vta' | 'uvDid'>): Promise<void> {
  let did: string
  try {
    did = await deps.uvDid()
  } catch (error) {
    throw uvFailure(error)
  }
  const ext = { [EXT_UV_KEY]: { kind: 'hardwareKey', did, hardwareBacked: false, biometricGated: true } }
  try {
    try {
      await deps.vta.heartbeat(ext)
      return
    } catch (error) {
      // `device/heartbeat:notRegistered` (operations/device.rs:228-237).
      const text = error instanceof VtiRefusal ? `${error.code} ${error.message}` : ''
      if (!/notRegistered/.test(text)) throw error
    }
    // A phone that registered in between is already registered: beat with it.
    if ((await deps.vta.register(ext)) === 'alreadyRegistered') await deps.vta.heartbeat(ext)
  } catch (error) {
    throw signInFailureFromAgent(error)
  }
}

/**
 * The member's VTA as {@link SignInVta}, over a signed-in {@link VtaClient}
 * (the caller connects it). `device` names the phone if it must register.
 */
export function vtaSignInPort(client: VtaClient, device: { platform: string; now?: () => Date }): SignInVta {
  return {
    did: client.vtaDid,
    signTrustTask: (request) => client.signTrustTask(request),
    vaultList: (filters) => client.vaultList(filters),
    vaultUpsert: (payload) => client.vaultUpsert(payload),
    sealVaultSecret: (secret) => client.sealVaultSecret(secret),
    // In the newest version the agent serves (0.3, else 0.2): from vta-service 0.67 (#2309) it serves only 0.3, and
    // a beat at 0.2 alone ended every sign-in "Your agent needs an update" (IN-390). Newest first, so a current agent
    // pays nothing and an older one one refused beat, remembered per agent for the session (taskVersions); it steps
    // down only on a version the agent says it does not serve, never on another refusal.
    heartbeat: (ext) =>
      beatAgent(
        {
          managerDid: client.managerDid,
          task: <T>(type: string, payload: Record<string, unknown>) => client.task<T>(type, payload),
        },
        ext
      ),
    register: (ext) =>
      registerThisDevice(
        {
          managerDid: client.managerDid,
          task: <T>(type: string, payload: Record<string, unknown>) => client.task<T>(type, { ...payload, ext }),
        },
        { displayName: defaultDeviceName(device.platform, device.now?.() ?? new Date()), platform: device.platform }
      ),
  }
}

/** The production dependencies: the Credo agent's resolver, HTTPS, the member's VTA and the phone's UV key. */
export function signInAgentDeps(agent: Agent, client: VtaClient, device: { platform: string }): SignInAgentDeps {
  return {
    post: httpsPost,
    resolveDid: agentDidResolver(agent),
    vta: vtaSignInPort(client, device),
    uvDid: () => getUvDid(),
    uvSign,
    uvReset: resetUvKey,
  }
}
