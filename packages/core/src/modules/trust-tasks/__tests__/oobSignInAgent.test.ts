/**
 * The sign-in steps after the claim — identify and prove, the grant and
 * respond, the persona's vault entry and the UV key's enrolment — against a
 * faked community and a faked member VTA. Both sign with real Ed25519 keys
 * listed in their DID documents, and the faked VTA checks the UV decision as
 * vta-service does (oob_sign_in.rs: the digest over the unsigned grant, the
 * challenge equal to it, the proof by the enrolled UV key), so every check
 * runs on real proofs, as ref-23 and ref-24 ran them against live ones.
 */
import { TypedArrayEncoder } from '@credo-ts/core'
import { PAYLOAD_SCHEMA as GRANT_0_3 } from '@openvtc/trust-tasks/auth/oob/grant/0.3/payload'
import Ajv from 'ajv/dist/2020'
import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'

import { jcsCanonicalize, verifyDocumentProof } from '../documentProof'
import {
  OOB_TASKS,
  SIGN_IN_FAILURE_MESSAGES,
  SignInError,
  isUnsupportedTaskCode,
  newThrowawayKey,
  signInEndLine,
  signWithKey,
  type ClaimedSignIn,
  type SignInDidDocument,
} from '../module/oobSignIn'
import {
  DID_SELF_ISSUED,
  EXT_UV_CONSENT,
  EXT_UV_KEY,
  GRANT_LIFETIME_SECONDS,
  UV_APPROVE_PROMPT,
  UV_DECISION_TASK,
  approveSignIn,
  approveSignInWithUvKey,
  digestMultibase,
  enrolUvKey,
  ensureSignInVaultEntry,
  identifyAndProve,
  signInFailureFromAgent,
  type SignInAgentDeps,
  type SignInVta,
} from '../module/oobSignInAgent'
import { UvKeyError } from '../module/uvKey'
import type { VtaVaultEntry } from '../module/VtaClient'
import { VtiRefusal } from '../module/vtiAgent'

jest.mock('react-native-keychain', () => ({
  ACCESS_CONTROL: { BIOMETRY_CURRENT_SET: 'BiometryCurrentSet' },
  ACCESSIBLE: {},
  STORAGE_TYPE: {},
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}))

const NOW = Math.floor(Date.now() / 1000)
const VTC = 'did:webvh:QmCommScid:vtc.example.com'
const VTA = 'did:webvh:QmVtaScid:vta.example.com'
const PERSONA = 'did:webvh:QmPersonaScid:dids.example.com:impact-patient'
const ENTRY_ID = 'vault_d9799ecd'
const BASE = 'https://vtc.example.com/v1'
const ORIGIN = 'https://members.example.com'
const REQUEST_ID = 'q3Vn7Zk2Xo9Rt1LwPb4HdA'
const MATCH = '07'

const multikey = (publicKey: Uint8Array) => {
  const prefixed = new Uint8Array(2 + publicKey.length)
  prefixed.set([0xed, 0x01], 0)
  prefixed.set(publicKey, 2)
  return `z${TypedArrayEncoder.toBase58(prefixed)}`
}
const didKeyOf = (secret: Uint8Array) => `did:key:${multikey(ed25519.getPublicKey(secret))}`
const didKeyDocument = (did: string): SignInDidDocument => {
  const vm = `${did}#${did.slice('did:key:'.length)}`
  return {
    id: did,
    verificationMethod: [{ id: vm, type: 'Multikey', controller: did, publicKeyMultibase: did.slice(8) }],
    authentication: [vm],
    assertionMethod: [vm],
  }
}

// The community: one key it asserts with, one it authenticates with.
const vtcAssert = new Uint8Array(32).fill(3)
const vtcAuth = new Uint8Array(32).fill(4)
const vtcDocument: SignInDidDocument = {
  id: VTC,
  verificationMethod: [
    {
      id: `${VTC}#key-0`,
      type: 'Multikey',
      controller: VTC,
      publicKeyMultibase: multikey(ed25519.getPublicKey(vtcAssert)),
    },
    {
      id: `${VTC}#key-1`,
      type: 'Multikey',
      controller: VTC,
      publicKeyMultibase: multikey(ed25519.getPublicKey(vtcAuth)),
    },
  ],
  assertionMethod: [`${VTC}#key-0`],
  authentication: [`${VTC}#key-1`],
}

// The persona, whose key stays in the member's VTA.
const personaSecret = new Uint8Array(32).fill(5)
const personaDocument = (assert = true): SignInDidDocument => ({
  id: PERSONA,
  verificationMethod: [
    {
      id: `${PERSONA}#key-0`,
      type: 'Multikey',
      controller: PERSONA,
      publicKeyMultibase: multikey(ed25519.getPublicKey(personaSecret)),
    },
  ],
  authentication: [`${PERSONA}#key-0`],
  assertionMethod: assert ? [`${PERSONA}#key-0`] : [],
})

// The phone's UV key (in production behind Face ID: uvKey.ts).
const uvSecret = new Uint8Array(32).fill(6)
const UV_DID = didKeyOf(uvSecret)

const errorDocument = (code: string) => ({
  type: 'https://trusttasks.org/spec/trust-task-error/0.1',
  payload: { code, message: 'refused' },
})

const resolverFor = (document: SignInDidDocument) => ({ dids: { resolveDidDocument: async () => document } }) as never

/** A community at vtc 0.14 or before (claim 0.1, prove/grant/respond 0.1-0.2), or from 0d3f268e (claim 0.2, prove/grant/respond 0.3 only). */
type Era = '0.14' | '0d3f'

/** The decision deadline as each era spells it: epoch seconds, or RFC 3339 `decisionClosesAt`. */
const deadlineMember = (era: Era) =>
  era === '0d3f' ? { decisionClosesAt: new Date((NOW + 120) * 1000).toISOString() } : { decisionDeadline: NOW + 120 }

function step1Payload(era: Era = '0.14') {
  return {
    requestId: REQUEST_ID,
    service: { did: VTC, name: VTC },
    origin: ORIGIN,
    purpose: 'login',
    ...deadlineMember(era),
  }
}

function claimedSignIn(era: Era = '0.14'): ClaimedSignIn {
  const keyA = newThrowawayKey()
  return {
    requestId: REQUEST_ID,
    vtcDid: VTC,
    base: BASE,
    portalOrigin: ORIGIN,
    decisionDeadline: NOW + 120,
    keyA,
    answer: signWithKey(
      {
        id: 'urn:uuid:claim-answer',
        type: `${era === '0d3f' ? OOB_TASKS.claim02 : OOB_TASKS.claim}#response`,
        issuer: VTC,
        recipient: keyA.did,
        threadId: 'urn:uuid:claim',
        issuedAt: '2026-10-11T07:30:00Z',
        payload: step1Payload(era),
      },
      vtcAssert,
      `${VTC}#key-0`,
      'assertionMethod'
    ),
  }
}

type Doc = Record<string, unknown> & { id: string; type: string; issuer: string; payload: Record<string, unknown> }

/**
 * The faked community: it answers prove with step 2 (checking the identify
 * proof and the number) and respond with `approved` (checking the grant's
 * context and proof), as vtc-service oob_tasks.rs does. It serves 0.1 and 0.2
 * as VTI #2190 does (`only01`: a community from before it, refusing 0.2 as a
 * version it does not serve); at 0.2 step 2 offers `offerScope`, and respond
 * holds the grant's signingScope equal to it.
 */
function fakeCommunity(
  options: {
    step2Change?: (answer: Doc, payload: Record<string, unknown>) => void
    only01?: boolean
    offerScope?: string[]
    era?: Era
  } = {}
) {
  const era = options.era ?? '0.14'
  const state: { step2?: Record<string, unknown>; respondAnswer?: Record<string, unknown>; grant?: Doc } = {}
  const post = jest.fn(async (url: string, document: Record<string, unknown>) => {
    expect(url).toBe(`${BASE}/trust-tasks`)
    const doc = document as Doc
    // What each era does not serve, refused at dispatch (vtc-service member_portal/oob.rs at vtc 0.14 / 0d3f268e).
    const v03 = doc.type === OOB_TASKS.prove03 || doc.type === OOB_TASKS.respond03
    if (era === '0.14' ? v03 : !v03) return errorDocument('unsupportedType')
    if (options.only01 && (doc.type === OOB_TASKS.prove02 || doc.type === OOB_TASKS.respond02)) {
      return errorDocument('unsupportedVersion')
    }
    if (doc.type === OOB_TASKS.prove || doc.type === OOB_TASKS.prove02 || doc.type === OOB_TASKS.prove03) {
      const v02 = doc.type !== OOB_TASKS.prove
      const identify = doc.payload.identify as Doc
      if (
        !(await verifyDocumentProof(resolverFor(personaDocument()), identify, PERSONA, {
          proofPurpose: 'authentication',
        }))
      )
        return errorDocument('auth/oob:notAuthorized')
      if (identify.payload.enteredNumber !== MATCH) return errorDocument('auth/oob/prove:numberMismatch')
      const payload: Record<string, unknown> = {
        ...step1Payload(era),
        sessionKey: newThrowawayKey().did,
        requester: {
          location: 'unknown',
          browser: 'unknown',
          os: 'unknown',
          createdAt: '2026-10-11T07:30:00Z',
          sameNetwork: true,
        },
        identifiedAs: identify.issuer,
        ...(v02 && options.offerScope ? { signingScope: options.offerScope } : {}),
      }
      const answer: Doc = {
        id: 'urn:uuid:step2',
        type: `${doc.type}#response`,
        issuer: VTC,
        recipient: doc.issuer,
        threadId: doc.id,
        issuedAt: '2026-10-11T07:30:05Z',
        payload,
      }
      options.step2Change?.(answer, payload)
      state.step2 = signWithKey(answer, vtcAssert, `${VTC}#key-0`, 'assertionMethod')
      return state.step2
    }
    if (doc.type === OOB_TASKS.respond || doc.type === OOB_TASKS.respond02 || doc.type === OOB_TASKS.respond03) {
      const v02 = doc.type !== OOB_TASKS.respond
      const grant = doc.payload.grant as Doc
      state.grant = grant
      const offered = (state.step2?.payload as Record<string, unknown> | undefined)?.signingScope
      const grantOf: Record<string, string> = {
        [OOB_TASKS.respond]: OOB_TASKS.grant,
        [OOB_TASKS.respond02]: OOB_TASKS.grant02,
      }
      const grantType = grantOf[doc.type] ?? OOB_TASKS.grant03
      const ok =
        grant.type === grantType &&
        (await verifyDocumentProof(resolverFor(personaDocument()), grant, PERSONA, {
          proofPurpose: 'assertionMethod',
        })) &&
        grant.payload.contextDigest === digestMultibase(state.step2) &&
        // 0.2 only (oob_tasks.rs:1079): the grant's scope is exactly step 2's.
        (!v02 || jcsCanonicalize(grant.payload.signingScope ?? null) === jcsCanonicalize(offered ?? null))
      if (!ok) return errorDocument('auth/oob/respond:contextMismatch')
      state.respondAnswer = signWithKey(
        {
          id: 'urn:uuid:respond',
          type: `${doc.type}#response`,
          issuer: VTC,
          recipient: doc.issuer,
          threadId: doc.id,
          payload: { status: 'approved' },
        },
        vtcAuth,
        `${VTC}#key-1`,
        'authentication'
      )
      return state.respondAnswer
    }
    throw new Error(`unexpected ${doc.type}`)
  })
  return { post, state }
}

/**
 * The faked member VTA: signs identify for authentication and a grant for
 * assertionMethod as the persona, the grant only on a UV decision that
 * approves exactly it, signed by the enrolled UV key — refusing as
 * vta-service does, a top-level taskFailed with the local code inside.
 */
function fakeVta(
  options: {
    enrolledUv?: string | null
    refuse?: string
    reorder?: boolean
    tamper?: boolean
    noGrant02?: boolean
    /** An agent at v0.66.0 or before: it signs grants only at 0.1 and 0.2. */
    noGrant03?: boolean
    /** An agent from 0d3f268e: it signs a persona's grant only at 0.3 (sign_trust_task.rs). */
    only03?: boolean
  } = {}
) {
  const enrolledUv = options.enrolledUv === undefined ? UV_DID : options.enrolledUv
  const signed = new Set<string>()
  const refuse = (code: string) => new VtiRefusal('taskFailed', `vault/sign-trust-task:${code} — refused`, { code })
  const signTrustTask = jest.fn(
    async ({ entryId, unsignedEnvelope, ext }: Parameters<SignInVta['signTrustTask']>[0]) => {
      expect(entryId).toBe(ENTRY_ID)
      if (options.refuse) throw refuse(options.refuse)
      const envelope = unsignedEnvelope as Doc
      let purpose: 'authentication' | 'assertionMethod' = 'authentication'
      // An agent from before auth/oob/grant/0.2 (VTI #2190) refuses it (vta-service oob_sign_in.rs:282).
      if (options.noGrant02 && envelope.type === OOB_TASKS.grant02) throw refuse('oobUnsupportedType')
      if (options.noGrant03 && envelope.type === OOB_TASKS.grant03) throw refuse('oobUnsupportedType')
      if (options.only03 && (envelope.type === OOB_TASKS.grant || envelope.type === OOB_TASKS.grant02)) {
        throw refuse('oobUnsupportedType')
      }
      if ([OOB_TASKS.grant, OOB_TASKS.grant02, OOB_TASKS.grant03].includes(envelope.type as never)) {
        const decision = (ext?.[EXT_UV_CONSENT] as { decision?: Doc } | undefined)?.decision
        if (!decision) throw refuse('oobUvRequired')
        if (!enrolledUv) throw refuse('oobNoUvKey')
        const digest = digestMultibase(unsignedEnvelope)
        const uvOk =
          decision.type === UV_DECISION_TASK &&
          decision.recipient === VTA &&
          decision.issuer === enrolledUv &&
          decision.payload.payloadDigest === digest &&
          decision.payload.challenge === digest &&
          decision.payload.decision === 'approve' &&
          (await verifyDocumentProof(resolverFor(didKeyDocument(enrolledUv)), decision, enrolledUv, {
            proofPurpose: 'assertionMethod',
          }))
        if (!uvOk) throw refuse('oobUvInvalid')
        if (signed.has(envelope.id)) throw refuse('oobGrantReplayed')
        signed.add(envelope.id)
        purpose = 'assertionMethod'
      }
      let out = signWithKey(unsignedEnvelope, personaSecret, `${PERSONA}#key-0`, purpose)
      // The VTA re-serialises in another key order (ref-23).
      if (options.reorder) out = Object.fromEntries(Object.entries(out).reverse())
      if (options.tamper) out = { ...out, recipient: 'did:web:elsewhere.example' }
      return out
    }
  )
  const vta: SignInVta = {
    did: VTA,
    signTrustTask,
    vaultList: jest.fn(async () => []),
    vaultUpsert: jest.fn(async () => ({ entry: { id: 'vault_new' }, created: true })),
    sealVaultSecret: jest.fn(async () => ({ envelope: 'didcomm-authcrypt' as const, jwe: '{"ciphertext":"…"}' })),
    heartbeat: jest.fn(async () => undefined),
    register: jest.fn(async () => 'registered' as const),
  }
  return { vta, signTrustTask }
}

function depsWith(
  community = fakeCommunity(),
  vtaFake = fakeVta(),
  overrides: Partial<SignInAgentDeps> = {}
): SignInAgentDeps & { persona: { did: string; entryId: string } } {
  return {
    post: community.post,
    resolveDid: jest.fn(async (did: string) =>
      did === VTC ? vtcDocument : did === PERSONA ? personaDocument() : Promise.reject(new Error(`unknown ${did}`))
    ),
    now: () => NOW,
    vta: vtaFake.vta,
    uvDid: jest.fn(async () => UV_DID),
    uvSign: jest.fn(async (bytes: Uint8Array) => ed25519.sign(bytes, uvSecret)),
    uvReset: jest.fn(async () => undefined),
    persona: { did: PERSONA, entryId: ENTRY_ID },
    ...overrides,
  }
}

const failureOf = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected the step to fail')
    },
    (e: unknown) => e as SignInError
  )

describe('identify and prove', () => {
  it('has the VTA sign identify as the persona, proves it under K_a, and keeps step 2 whole', async () => {
    const community = fakeCommunity()
    const vtaFake = fakeVta({ reorder: true })
    const deps = depsWith(community, vtaFake)
    const claimed = claimedSignIn()
    const proved = await identifyAndProve(claimed, ` ${MATCH} `, deps)

    const { unsignedEnvelope } = vtaFake.signTrustTask.mock.calls[0][0]
    expect(unsignedEnvelope).toMatchObject({
      type: OOB_TASKS.identify,
      issuer: PERSONA,
      recipient: VTC,
      payload: { requestId: REQUEST_ID, approverKey: claimed.keyA.did, enteredNumber: MATCH },
    })
    // Only the framework members the VTA allows on a sign-in document (oob_sign_in.rs:99-111).
    expect(Object.keys(unsignedEnvelope).sort()).toEqual(['id', 'issuedAt', 'issuer', 'payload', 'recipient', 'type'])

    // A vtc 0.14 community refuses prove/0.3 at dispatch; the proof is the 0.2 sent next.
    expect((community.post.mock.calls[0][1] as Doc).type).toBe(OOB_TASKS.prove03)
    const [, prove] = community.post.mock.calls[1]
    expect(prove).toMatchObject({
      type: OOB_TASKS.prove02,
      issuer: claimed.keyA.did,
      recipient: VTC,
      parentThreadId: REQUEST_ID,
      proof: { proofPurpose: 'authentication', verificationMethod: claimed.keyA.verificationMethod },
    })
    expect(proved.step2).toBe(community.state.step2)
    expect(proved).toMatchObject({
      identifiedAs: PERSONA,
      persona: { did: PERSONA, entryId: ENTRY_ID },
      requester: {
        browser: 'unknown',
        os: 'unknown',
        location: 'unknown',
        sameNetwork: true,
        createdAt: '2026-10-11T07:30:00Z',
      },
    })
    expect(proved.sessionKey).toMatch(/^did:key:z6Mk/)
  })

  it('refuses a typed value that is not two digits, before anything is sent', async () => {
    const vtaFake = fakeVta()
    const deps = depsWith(undefined, vtaFake)
    for (const typed of ['7', '123', 'ab', '']) {
      expect((await failureOf(identifyAndProve(claimedSignIn(), typed, deps))).reason).toBe('badNumber')
    }
    expect(vtaFake.signTrustTask).not.toHaveBeenCalled()
  })

  it('says wrongNumber when the community refuses the number', async () => {
    const error = await failureOf(identifyAndProve(claimedSignIn(), '08', depsWith()))
    expect(error.reason).toBe('wrongNumber')
    expect(error.detail).toBe('auth/oob/prove:numberMismatch')
  })

  it.each(['unsupportedVersion', 'unsupportedType'])(
    'says the agent needs an update when it answers %s (an agent from before sign-in)',
    async (code) => {
      const community = fakeCommunity()
      const vtaFake = fakeVta()
      vtaFake.signTrustTask.mockRejectedValueOnce(
        new VtiRefusal(
          code,
          'unsupported version: https://trusttasks.org/spec/vault/sign-trust-task/0.2 — this VTA serves https://trusttasks.org/spec/vault/sign-trust-task/0.1'
        )
      )
      const error = await failureOf(identifyAndProve(claimedSignIn(), MATCH, depsWith(community, vtaFake)))
      expect(error.reason).toBe('agentNeedsUpdate')
      expect(community.post).not.toHaveBeenCalled()
    }
  )

  it('does not start after the decision deadline', async () => {
    const vtaFake = fakeVta()
    const deps = depsWith(undefined, vtaFake, { now: () => NOW + 121 })
    expect((await failureOf(identifyAndProve(claimedSignIn(), MATCH, deps))).reason).toBe('expired')
    expect(vtaFake.signTrustTask).not.toHaveBeenCalled()
  })

  it('does not send identify the VTA changed', async () => {
    const community = fakeCommunity()
    const error = await failureOf(
      identifyAndProve(claimedSignIn(), MATCH, depsWith(community, fakeVta({ tamper: true })))
    )
    expect(error.reason).toBe('badAnswer')
    expect(error.detail).toMatch(/changed the document/)
    expect(community.post).not.toHaveBeenCalled()
  })

  it("does not send identify that is not the persona's authentication proof", async () => {
    const community = fakeCommunity()
    const vtaFake = fakeVta()
    vtaFake.signTrustTask.mockImplementationOnce(async ({ unsignedEnvelope }) =>
      signWithKey(unsignedEnvelope, new Uint8Array(32).fill(9), `${PERSONA}#key-0`, 'authentication')
    )
    const error = await failureOf(identifyAndProve(claimedSignIn(), MATCH, depsWith(community, vtaFake)))
    expect(error.reason).toBe('badAnswer')
    expect(error.detail).toMatch(/persona's, for authentication/)
    expect(community.post).not.toHaveBeenCalled()
  })

  it('maps the VTA refusing to sign', async () => {
    const error = await failureOf(
      identifyAndProve(claimedSignIn(), MATCH, depsWith(undefined, fakeVta({ refuse: 'oobNotEnrolledDevice' })))
    )
    expect(error.reason).toBe('notEnrolledDevice')
  })

  describe('does not believe a step 2', () => {
    it.each([
      ['signed for authentication', (a: Doc) => (a.__resign = 'auth'), /assertionMethod/],
      ['threaded to another message', (a: Doc) => (a.threadId = 'urn:uuid:another'), /thread/],
      ['addressed to another key', (a: Doc) => (a.recipient = newThrowawayKey().did), /addressed/],
      [
        'for another request',
        (_: Doc, p: Record<string, unknown>) => (p.requestId = 'AAAAAAAAAAAAAAAAAAAAAA'),
        /requestId/,
      ],
      [
        'naming another community',
        (_: Doc, p: Record<string, unknown>) => (p.service = { did: 'did:web:x', name: 'x' }),
        /service/,
      ],
      [
        'with another origin',
        (_: Doc, p: Record<string, unknown>) => (p.origin = 'https://attacker.example.com'),
        /origin/,
      ],
      ['for another purpose', (_: Doc, p: Record<string, unknown>) => (p.purpose = 'payment'), /purpose/],
      [
        'with another deadline',
        (_: Doc, p: Record<string, unknown>) => (p.decisionDeadline = NOW + 999),
        /decision deadline/,
      ],
      [
        'with a session key that is not Ed25519',
        (_: Doc, p: Record<string, unknown>) => (p.sessionKey = 'did:key:zDnaexample'),
        /session key/,
      ],
      [
        'identifying someone else',
        (_: Doc, p: Record<string, unknown>) => (p.identifiedAs = 'did:web:someone.example'),
        /someone else/,
      ],
      ['with no requester', (_: Doc, p: Record<string, unknown>) => delete p.requester, /requester/],
    ])('%s', async (_, change, detail) => {
      const community = fakeCommunity({
        step2Change: (answer, payload) => {
          change(answer, payload)
        },
      })
      // Re-sign with the authentication key where asked.
      const original = community.post.getMockImplementation()!
      community.post.mockImplementation(async (url, document) => {
        const out = (await original(url, document)) as Doc
        if (out.__resign) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { proof, __resign, ...rest } = out
          return signWithKey(rest, vtcAuth, `${VTC}#key-1`, 'authentication')
        }
        return out
      })
      const error = await failureOf(identifyAndProve(claimedSignIn(), MATCH, depsWith(community)))
      expect(error.reason).toBe('badAnswer')
      expect(error.detail).toMatch(detail)
    })
  })
})

describe('approving a sign-in', () => {
  async function proved(community = fakeCommunity(), vtaFake = fakeVta()) {
    const deps = depsWith(community, vtaFake)
    return { deps, community, vtaFake, proved: await identifyAndProve(claimedSignIn(), MATCH, deps) }
  }

  it('builds the grant over step 2, has Face ID approve it, the VTA sign it, and the community record it', async () => {
    const { deps, community, vtaFake, proved: p } = await proved()
    await expect(approveSignIn(p, deps)).resolves.toEqual({ status: 'approved' })

    const grantCall = vtaFake.signTrustTask.mock.calls[1][0]
    const unsignedGrant = grantCall.unsignedEnvelope as Doc
    expect(unsignedGrant).toMatchObject({
      type: OOB_TASKS.grant02,
      issuer: PERSONA,
      recipient: VTC,
      payload: {
        requestId: REQUEST_ID,
        decision: 'approve',
        sessionKey: p.sessionKey,
        approverKey: p.claimed.keyA.did,
        origin: ORIGIN,
        notAfter: NOW + GRANT_LIFETIME_SECONDS,
      },
    })
    // contextDigest: z + base58btc(0x12 0x20 ‖ sha256(JCS(step 2 as received, proof included))).
    const hash = sha256(new TextEncoder().encode(jcsCanonicalize(community.state.step2)))
    expect(unsignedGrant.payload.contextDigest).toBe(
      `z${TypedArrayEncoder.toBase58(new Uint8Array([0x12, 0x20, ...hash]))}`
    )

    // The UV decision approves exactly the unsigned grant, signed by the UV key after the prompt.
    const decision = (grantCall.ext?.[EXT_UV_CONSENT] as { decision: Doc }).decision
    const grantDigest = digestMultibase(unsignedGrant)
    expect(decision).toMatchObject({
      type: UV_DECISION_TASK,
      issuer: UV_DID,
      recipient: VTA,
      payload: { challenge: grantDigest, payloadDigest: grantDigest, decision: 'approve' },
      proof: { proofPurpose: 'assertionMethod', verificationMethod: `${UV_DID}#${UV_DID.slice(8)}` },
    })
    expect(deps.uvSign).toHaveBeenCalledWith(expect.any(Uint8Array), UV_APPROVE_PROMPT)

    const [, respond] = community.post.mock.calls[2]
    expect(respond).toMatchObject({
      type: OOB_TASKS.respond02,
      issuer: p.claimed.keyA.did,
      parentThreadId: REQUEST_ID,
      payload: { grant: { type: OOB_TASKS.grant02, proof: { proofPurpose: 'assertionMethod' } } },
      proof: { proofPurpose: 'authentication' },
    })
  })

  it('sends nothing to the VTA when the person cancels Face ID', async () => {
    const { deps, vtaFake, proved: p } = await proved()
    deps.uvSign = jest.fn(async () => {
      throw new UvKeyError('cancelled', 'User canceled the operation')
    })
    const error = await failureOf(approveSignIn(p, deps))
    expect(error.reason).toBe('uvCancelled')
    expect(error.responded).toBe(false)
    expect(vtaFake.signTrustTask).toHaveBeenCalledTimes(1) // identify only
  })

  it('says the approval key is lost when biometrics changed', async () => {
    const { deps, proved: p } = await proved()
    deps.uvSign = jest.fn(async () => {
      throw new UvKeyError('lost', 'the approval key is no longer readable')
    })
    expect((await failureOf(approveSignIn(p, deps))).reason).toBe('uvKeyLost')
  })

  // A lost key read as uvKeyLost on every approval after: the DID kept beside it still named it, and nothing made a
  // new one. Now it is set up again once, and the approval asked once more.
  describe('a lost approval key is set up again, once', () => {
    const lostOnce = (deps: SignInAgentDeps) => {
      const sign = deps.uvSign
      let first = true
      deps.uvSign = jest.fn(async (bytes: Uint8Array, prompt: string) => {
        if (first) {
          first = false
          throw new UvKeyError('lost', 'the approval key is no longer readable')
        }
        return sign(bytes, prompt)
      })
    }

    it('forgets the key, enrols a new one and approves', async () => {
      const { deps, vtaFake, proved: p } = await proved()
      lostOnce(deps)
      await expect(approveSignInWithUvKey(p, deps)).resolves.toEqual({ status: 'approved' })
      expect(deps.uvReset).toHaveBeenCalledTimes(1)
      // Enrolled before the first try, and again with the new key.
      expect(vtaFake.vta.heartbeat).toHaveBeenCalledTimes(2)
      expect(deps.uvSign).toHaveBeenCalledTimes(2)
    })

    it('lost again: said as lost, after one setting-up only', async () => {
      const { deps, vtaFake, proved: p } = await proved()
      deps.uvSign = jest.fn(async () => {
        throw new UvKeyError('lost', 'the approval key is no longer readable')
      })
      expect((await failureOf(approveSignInWithUvKey(p, deps))).reason).toBe('uvKeyLost')
      expect(deps.uvReset).toHaveBeenCalledTimes(1)
      expect(vtaFake.signTrustTask).toHaveBeenCalledTimes(1) // identify only: no grant was signed
    })

    it('a cancelled prompt is not a lost key: nothing is reset', async () => {
      const { deps, proved: p } = await proved()
      deps.uvSign = jest.fn(async () => {
        throw new UvKeyError('cancelled', 'User canceled the operation')
      })
      expect((await failureOf(approveSignInWithUvKey(p, deps))).reason).toBe('uvCancelled')
      expect(deps.uvReset).not.toHaveBeenCalled()
    })
  })

  it('maps the VTA refusing a decision signed by a key it does not know', async () => {
    const { deps, proved: p } = await proved(undefined, fakeVta({ enrolledUv: didKeyOf(new Uint8Array(32).fill(7)) }))
    const error = await failureOf(approveSignIn(p, deps))
    expect(error.reason).toBe('agentRefused')
    expect(error.detail).toBe('oobUvInvalid')
  })

  describe("maps the VTA's nested refusals", () => {
    it.each([
      ['oobUvRequired', 'uvRequired'],
      ['oobNotEnrolledDevice', 'notEnrolledDevice'],
      ['oobNoUvKey', 'noUvKey'],
      ['oobGrantReplayed', 'grantReplayed'],
      ['oobAssertionMethodMissing', 'assertionMethodMissing'],
      ['oobStale', 'agentRefused'],
    ])('%s is %s, and nothing reaches the community', async (code, reason) => {
      const { deps, community, vtaFake, proved: p } = await proved()
      vtaFake.signTrustTask.mockRejectedValueOnce(
        new VtiRefusal('taskFailed', `vault/sign-trust-task:${code} — refused`, { code })
      )
      const error = await failureOf(approveSignIn(p, deps))
      expect(error.reason).toBe(reason)
      expect(error.responded).toBe(false)
      // prove only: prove/0.3, refused by this vtc 0.14 community, then prove/0.2
      expect(community.post).toHaveBeenCalledTimes(2)
    })

    it('reads the code from the message when details carry none (G10)', () => {
      const error = signInFailureFromAgent(
        new VtiRefusal('taskFailed', 'vault/sign-trust-task:oobGrantReplayed — this grant id has already been signed')
      )
      expect(error.reason).toBe('grantReplayed')
    })

    it('a VTA that does not answer is agentUnreachable', () => {
      expect(signInFailureFromAgent(new Error('the VTA did not answer')).reason).toBe('agentUnreachable')
    })
  })

  // Findings F1: an agent from before sign-in signing (vta-service 0.56.0,
  // VTI-Eucalyptus — the Farm's) serves vault/sign-trust-task/0.2 but signs the
  // grant as the persona for `authentication`. It was reported as a bad answer,
  // after the person had approved; it is an agent that needs an update.
  it('a grant the VTA signed for authentication (an agent from before sign-in signing): agent needs an update, nothing sent', async () => {
    const { deps, community, vtaFake, proved: p } = await proved()
    vtaFake.signTrustTask.mockImplementationOnce(async ({ unsignedEnvelope }) =>
      signWithKey(unsignedEnvelope, personaSecret, `${PERSONA}#key-0`, 'authentication')
    )
    const error = await failureOf(approveSignIn(p, deps))
    expect(error.reason).toBe('agentNeedsUpdate')
    expect(error.message).toBe(SIGN_IN_FAILURE_MESSAGES.agentNeedsUpdate)
    // prove only: prove/0.3, refused by this vtc 0.14 community, then prove/0.2
    expect(community.post).toHaveBeenCalledTimes(2)
  })

  it("a grant signed by a key that is not the persona's is still a bad answer, nothing sent", async () => {
    const { deps, community, vtaFake, proved: p } = await proved()
    const stranger = ed25519.utils.randomSecretKey()
    vtaFake.signTrustTask.mockImplementationOnce(async ({ unsignedEnvelope }) =>
      signWithKey(unsignedEnvelope, stranger, `${PERSONA}#key-0`, 'authentication')
    )
    const error = await failureOf(approveSignIn(p, deps))
    expect(error.reason).toBe('badAnswer')
    expect(error.detail).toMatch(/assertionMethod/)
    // prove only: prove/0.3, refused by this vtc 0.14 community, then prove/0.2
    expect(community.post).toHaveBeenCalledTimes(2)
  })

  it('marks every failure from respond on as responded: never cancel then (G2)', async () => {
    const { deps, community, proved: p } = await proved()
    community.post.mockImplementationOnce(async () => errorDocument('auth/oob/respond:contextMismatch'))
    const refused = await failureOf(approveSignIn(p, deps))
    expect(refused).toMatchObject({ reason: 'refused', responded: true })

    community.post.mockImplementationOnce(async () => {
      throw new Error('timeout')
    })
    expect(await failureOf(approveSignIn(p, deps))).toMatchObject({ reason: 'unreachable', responded: true })

    community.post.mockImplementationOnce(async () =>
      signWithKey(
        { type: `${OOB_TASKS.respond}#response`, payload: { status: 'pending' } },
        vtcAuth,
        `${VTC}#key-1`,
        'authentication'
      )
    )
    expect(await failureOf(approveSignIn(p, deps))).toMatchObject({ reason: 'refused', responded: true })

    community.post.mockImplementationOnce(async () =>
      signWithKey(
        { type: `${OOB_TASKS.respond}#response`, payload: { status: 'approved' } },
        new Uint8Array(32).fill(9),
        `${VTC}#key-1`,
        'authentication'
      )
    )
    expect(await failureOf(approveSignIn(p, deps))).toMatchObject({ reason: 'badAnswer', responded: true })
  })
})

describe("the community's answer to the grant", () => {
  async function provedWith(answer: (req: Record<string, unknown>) => Record<string, unknown>) {
    const community = fakeCommunity()
    const real = community.post.getMockImplementation()!
    community.post.mockImplementation(async (url: string, doc: Record<string, unknown>) =>
      [OOB_TASKS.respond, OOB_TASKS.respond02].includes((doc as { type?: string }).type as never)
        ? answer(doc)
        : real(url, doc)
    )
    const deps = depsWith(community, fakeVta())
    return { deps, proved: await identifyAndProve(claimedSignIn(), MATCH, deps) }
  }

  // Report 26JE-SQ6R: a community on VTI b345ebd1 or later (2026-10-11) signs
  // this answer as its attestation, for assertionMethod, like steps 1 and 2.
  // The browser was signed in; Keyring said the answer couldn't be checked.
  it("is taken when signed as the community's attestation (assertionMethod), as VTI now signs it", async () => {
    const { deps, proved: p } = await provedWith((req) =>
      signWithKey(
        {
          id: 'urn:uuid:respond-attested',
          type: `${OOB_TASKS.respond}#response`,
          issuer: VTC,
          recipient: req.issuer,
          threadId: req.id,
          payload: { status: 'approved' },
        },
        vtcAssert,
        `${VTC}#key-0`,
        'assertionMethod'
      )
    )
    await expect(approveSignIn(p, deps)).resolves.toEqual({ status: 'approved' })
  })

  it('is still taken when signed for authentication, as communities before b345ebd1 sign it', async () => {
    const { deps, proved: p } = await provedWith(() =>
      signWithKey(
        { type: `${OOB_TASKS.respond}#response`, payload: { status: 'approved' } },
        vtcAuth,
        `${VTC}#key-1`,
        'authentication'
      )
    )
    await expect(approveSignIn(p, deps)).resolves.toEqual({ status: 'approved' })
  })

  it("is not taken when signed by a key that is not the community's, for either purpose", async () => {
    const stranger = new Uint8Array(32).fill(9)
    for (const purpose of ['assertionMethod', 'authentication'] as const) {
      const { deps, proved: p } = await provedWith(() =>
        signWithKey(
          { type: `${OOB_TASKS.respond}#response`, payload: { status: 'approved' } },
          stranger,
          `${VTC}#key-0`,
          purpose
        )
      )
      expect(await failureOf(approveSignIn(p, deps))).toMatchObject({ reason: 'badAnswer', responded: true })
    }
  })
})

// IN-280, VTI #2190: auth/oob prove/grant/respond 0.2. A community may offer a signing scope (the member portal
// offers vtc/directory) that the grant copies, letting the browser's key sign those documents as the member for the
// session. 0.2 first; 0.1 to a community or an agent from before it.
describe('auth/oob 0.2: the signing scope', () => {
  const DIRECTORY = ['vtc/directory']

  it('proves at 0.2, keeps the offered scope, and the grant copies it unchanged under respond/0.2', async () => {
    const community = fakeCommunity({ offerScope: DIRECTORY })
    const deps = depsWith(community)
    const p = await identifyAndProve(claimedSignIn(), MATCH, deps)
    expect(p).toMatchObject({ version: '0.2', signingScope: DIRECTORY })
    await expect(approveSignIn(p, deps)).resolves.toEqual({ status: 'approved' })
    expect(community.state.grant).toMatchObject({ type: OOB_TASKS.grant02, payload: { signingScope: DIRECTORY } })
    expect(community.post.mock.calls[2][1]).toMatchObject({ type: OOB_TASKS.respond02 })
  })

  it('offered no scope (the console, or a member sign-in that offers none): the 0.2 grant carries none', async () => {
    const community = fakeCommunity()
    const deps = depsWith(community)
    const p = await identifyAndProve(claimedSignIn(), MATCH, deps)
    expect(p.version).toBe('0.2')
    expect(p.signingScope).toBeUndefined()
    await expect(approveSignIn(p, deps)).resolves.toEqual({ status: 'approved' })
    expect(community.state.grant?.type).toBe(OOB_TASKS.grant02)
    expect(community.state.grant?.payload).not.toHaveProperty('signingScope')
  })

  it.each(['unsupportedVersion', 'unsupportedType'])(
    'a community from before 0.2 (answering prove/0.2 %s): the same identify proves at 0.1, nothing delegated',
    async (code) => {
      const community = fakeCommunity()
      const real = community.post.getMockImplementation()!
      // prove/0.3 is refused by the fake's era; prove/0.2 by this test.
      community.post.mockImplementationOnce(real)
      community.post.mockImplementationOnce(async () => errorDocument(code))
      community.post.mockImplementation(real)
      const vtaFake = fakeVta()
      const deps = depsWith(community, vtaFake)
      const p = await identifyAndProve(claimedSignIn(), MATCH, deps)
      expect(community.post.mock.calls.map(([, d]) => (d as Doc).type)).toEqual([
        OOB_TASKS.prove03,
        OOB_TASKS.prove02,
        OOB_TASKS.prove,
      ])
      // The identify is signed once and sent in all three.
      expect(vtaFake.signTrustTask).toHaveBeenCalledTimes(1)
      expect((community.post.mock.calls[2][1] as Doc).payload.identify).toEqual(
        (community.post.mock.calls[0][1] as Doc).payload.identify
      )
      expect(p).toMatchObject({ version: '0.1' })
      expect(p.signingScope).toBeUndefined()
      await expect(approveSignIn(p, deps)).resolves.toEqual({ status: 'approved' })
      expect(community.state.grant?.type).toBe(OOB_TASKS.grant)
      expect(community.post.mock.calls[3][1]).toMatchObject({ type: OOB_TASKS.respond })
    }
  )

  it('a community refusing a prove for another reason is not retried a version down', async () => {
    const community = fakeCommunity()
    community.post.mockImplementationOnce(async () => errorDocument('auth/oob:requestExpired'))
    const error = await failureOf(identifyAndProve(claimedSignIn(), MATCH, depsWith(community)))
    expect(error.reason).toBe('expired')
    expect(community.post).toHaveBeenCalledTimes(1)
  })

  it.each([
    [['auth'], /never delegates/],
    [['acl/grant'], /never delegates/],
    [['task-consent'], /never delegates/],
    [['confirm'], /never delegates/],
    [['consent'], /never delegates/],
    [['vtc/directory', 'consent'], /never delegates/],
    [[], /malformed/],
    [['vtc/directory', 'vtc/directory'], /malformed/],
    [['Vtc/Directory'], /malformed/],
    [Array.from({ length: 9 }, (_, i) => `vtc/f${String.fromCharCode(97 + i)}`), /malformed/],
  ])('refuses a step 2 whose signing scope is %j, before anything is shown', async (scope, why) => {
    const community = fakeCommunity({
      step2Change: (_answer, payload) => {
        payload.signingScope = scope
      },
    })
    const error = await failureOf(identifyAndProve(claimedSignIn(), MATCH, depsWith(community)))
    expect(error.reason).toBe('badAnswer')
    expect(error.detail).toMatch(why)
  })

  it('an agent from before grant/0.2 (oobUnsupportedType): the grant is made again at 0.1, with a second Face ID, under the same step 2', async () => {
    const community = fakeCommunity({ offerScope: DIRECTORY })
    const vtaFake = fakeVta({ noGrant02: true })
    const deps = depsWith(community, vtaFake)
    const p = await identifyAndProve(claimedSignIn(), MATCH, deps)
    expect(p.version).toBe('0.2')
    await expect(approveSignIn(p, deps)).resolves.toEqual({ status: 'approved' })
    const grants = vtaFake.signTrustTask.mock.calls.slice(1).map(([c]) => (c.unsignedEnvelope as Doc).type)
    expect(grants).toEqual([OOB_TASKS.grant02, OOB_TASKS.grant])
    // The approval names one grant's digest, so the 0.1 grant is approved on its own.
    expect(deps.uvSign).toHaveBeenCalledTimes(2)
    expect(community.state.grant).toMatchObject({ type: OOB_TASKS.grant })
    expect(community.state.grant?.payload).not.toHaveProperty('signingScope')
    expect(community.post.mock.calls[2][1]).toMatchObject({ type: OOB_TASKS.respond })
  })

  it("keeps the community's and the agent's 'unsupported' refusals apart (the two fallbacks never cross)", () => {
    expect(isUnsupportedTaskCode('unsupportedVersion')).toBe(true)
    expect(isUnsupportedTaskCode('unsupportedType')).toBe(true)
    expect(isUnsupportedTaskCode('trust-task:unsupportedType')).toBe(true)
    expect(isUnsupportedTaskCode('oobUnsupportedType')).toBe(false)
    expect(isUnsupportedTaskCode(undefined)).toBe(false)
  })

  it("maps the agent's oobUnsupportedType to 'needs an update' when there is nothing to fall back to", () => {
    const error = signInFailureFromAgent(
      new VtiRefusal('taskFailed', 'vault/sign-trust-task:oobUnsupportedType — refused', { code: 'oobUnsupportedType' })
    )
    expect(error).toMatchObject({ reason: 'agentNeedsUpdate', detail: 'oobUnsupportedType' })
  })

  it("a community's answer at either version is still taken for either of its purposes", async () => {
    // Covered for 0.2 by "the community's answer to the grant"; here the 0.1 path after a fallback.
    const community = fakeCommunity({ only01: true })
    const deps = depsWith(community)
    const p = await identifyAndProve(claimedSignIn(), MATCH, deps)
    expect(p.version).toBe('0.1')
    await expect(approveSignIn(p, deps)).resolves.toEqual({ status: 'approved' })
  })
})

// The 2026-10-24 naming pass reached the services on 10-28 (vta-service 0d3f268e, what first.openvtc.net runs): a
// community then serves only claim 0.2 and prove/grant/respond 0.3, whose deadline is `decisionClosesAt` and whose
// grant names `sessionEndsAt`; the member's agent signs a persona's grant only at 0.3. 0.3 is asked first, and a
// community at vtc 0.14 or before is proved again at 0.2.
describe('auth/oob 0.3: communities and agents from 0d3f268e', () => {
  const DIRECTORY = ['vtc/directory']

  it('proves at 0.3, and the grant names sessionEndsAt (RFC 3339) under respond/0.3, valid against grant/0.3', async () => {
    const community = fakeCommunity({ era: '0d3f', offerScope: DIRECTORY })
    const deps = depsWith(community, fakeVta({ only03: true }))
    const p = await identifyAndProve(claimedSignIn('0d3f'), MATCH, deps)
    expect(p).toMatchObject({ version: '0.3', signingScope: DIRECTORY })
    await expect(approveSignIn(p, deps)).resolves.toEqual({ status: 'approved' })
    expect(community.post.mock.calls.map(([, d]) => (d as Doc).type)).toEqual([OOB_TASKS.prove03, OOB_TASKS.respond03])
    const grant = community.state.grant!
    expect(grant.type).toBe(OOB_TASKS.grant03)
    expect(grant.payload).not.toHaveProperty('notAfter')
    expect(grant.payload.sessionEndsAt).toBe(
      new Date((NOW + GRANT_LIFETIME_SECONDS) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
    )
    expect(grant.payload.signingScope).toEqual(DIRECTORY)
    const valid = new Ajv({ strict: false, allErrors: true, logger: false }).compile(GRANT_0_3 as object)
    expect(valid(grant.payload)).toBe(true)
  })

  it("reads step 2's decisionClosesAt as the same instant as step 1's", async () => {
    const community = fakeCommunity({
      era: '0d3f',
      step2Change: (_answer, payload) => {
        payload.decisionClosesAt = new Date((NOW + 60) * 1000).toISOString()
      },
    })
    const error = await failureOf(identifyAndProve(claimedSignIn('0d3f'), MATCH, depsWith(community)))
    expect(error).toMatchObject({ reason: 'badAnswer', detail: "step 2 does not repeat step 1's decision deadline" })
  })

  it('a community at vtc 0.14 (refusing prove/0.3 as a type it does not serve) is proved again at 0.2', async () => {
    const community = fakeCommunity({ offerScope: DIRECTORY })
    const deps = depsWith(community)
    const p = await identifyAndProve(claimedSignIn(), MATCH, deps)
    expect(p).toMatchObject({ version: '0.2', signingScope: DIRECTORY })
    await expect(approveSignIn(p, deps)).resolves.toEqual({ status: 'approved' })
    expect(community.post.mock.calls.map(([, d]) => (d as Doc).type)).toEqual([
      OOB_TASKS.prove03,
      OOB_TASKS.prove02,
      OOB_TASKS.respond02,
    ])
    expect(community.state.grant?.type).toBe(OOB_TASKS.grant02)
  })

  it('a 0d3f268e community with an agent that cannot sign grant/0.3: needs an update, nothing sent to respond', async () => {
    const community = fakeCommunity({ era: '0d3f' })
    const deps = depsWith(community, fakeVta({ noGrant03: true }))
    const p = await identifyAndProve(claimedSignIn('0d3f'), MATCH, deps)
    expect(p.version).toBe('0.3')
    const error = await failureOf(approveSignIn(p, deps))
    expect(error).toMatchObject({ reason: 'agentNeedsUpdate', detail: 'oobUnsupportedType' })
    expect(community.post.mock.calls.map(([, d]) => (d as Doc).type)).toEqual([OOB_TASKS.prove03])
  })

  // IN-390 (276.9): a sign-in ended "Your agent needs an update" and nothing in the Release log said which version
  // was asked. The error now carries the prove and grant versions asked; the endings are unchanged.
  it('a current agent (grant 0.3 only) with a community at 0.2: the ending notes every version asked', async () => {
    const community = fakeCommunity()
    const deps = depsWith(community, fakeVta({ only03: true }))
    const p = await identifyAndProve(claimedSignIn(), MATCH, deps)
    expect(p).toMatchObject({ version: '0.2', provesTried: ['0.3', '0.2'] })
    expect(await failureOf(approveSignIn(p, deps))).toMatchObject({
      reason: 'agentNeedsUpdate',
      detail: 'oobUnsupportedType',
      tried: { prove: ['0.3', '0.2'], grant: ['0.2', '0.1'] },
    })
  })

  it('an agent without grant 0.3 with a community at 0.3: the ending notes the one version asked', async () => {
    const community = fakeCommunity({ era: '0d3f' })
    const deps = depsWith(community, fakeVta({ noGrant03: true }))
    const p = await identifyAndProve(claimedSignIn('0d3f'), MATCH, deps)
    expect(await failureOf(approveSignIn(p, deps))).toMatchObject({
      reason: 'agentNeedsUpdate',
      tried: { prove: ['0.3'], grant: ['0.3'] },
    })
  })

  it('a step 2 that fails its check notes the prove versions asked', async () => {
    const community = fakeCommunity({
      era: '0d3f',
      step2Change: (_answer, payload) => {
        payload.decisionClosesAt = new Date((NOW + 60) * 1000).toISOString()
      },
    })
    expect(await failureOf(identifyAndProve(claimedSignIn('0d3f'), MATCH, depsWith(community)))).toMatchObject({
      reason: 'badAnswer',
      tried: { prove: ['0.3'] },
    })
  })
})

// IN-390: the Release log said nothing about which check ended the sign-in. One line per failed sign-in now does:
// the reason, its detail and the versions tried, never a link, a key or a document.
describe('the Release line for a sign-in that ended', () => {
  it('names the reason, its detail and the prove and grant versions tried', () => {
    const error = new SignInError('agentNeedsUpdate', 'oobUnsupportedType')
    error.tried = { prove: ['0.3', '0.2'], grant: ['0.2', '0.1'] }
    expect(signInEndLine(error)).toBe(
      '[SignIn] not signed in: agentNeedsUpdate (oobUnsupportedType); prove 0.3>0.2; grant 0.2>0.1'
    )
  })

  it('leaves links, keys and documents out of the detail, and keeps a DID to its prefix', () => {
    const line = signInEndLine(
      new SignInError(
        'agentUnreachable',
        'no answer from https://vta.example/path?x=1 for did:webvh:QmRjehe8RTU21cqM7813P9FVwjpqsi8LYRKFrhzP7VJErw:dids.example:gt-vta signing as did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK over {"type":"x","payload":{"secret":"s"}}'
      )
    )
    expect(line).not.toMatch(/https?:/)
    expect(line).not.toMatch(/z6MkhaXgBZDvotDkL5257/)
    expect(line).not.toMatch(/QmRjehe8RTU21cqM7813P9FVwjpqsi8LYRKFrhzP7VJErw/)
    expect(line).not.toMatch(/secret/)
    expect(line).toMatch(/^\[SignIn\] not signed in: agentUnreachable \(/)
    expect(line).toMatch(/did:webvh:QmRjehe8…/)
    expect(line.length).toBeLessThanOrEqual(300)
  })

  it('an error that is not a sign-in error is named by its kind only', () => {
    expect(signInEndLine(new TypeError('Cannot read x of undefined'))).toBe(
      '[SignIn] not signed in: unknown (TypeError)'
    )
  })
})

describe("the persona's sign-in vault entry", () => {
  const persona = { did: PERSONA, signingKeyId: `${PERSONA}#key-0`, contextId: 'vta' }
  const entry = (over: Partial<VtaVaultEntry> = {}): VtaVaultEntry => ({
    id: 'vault_existing',
    contextId: 'vta',
    targets: [{ kind: 'did', did: VTC }],
    secretKind: DID_SELF_ISSUED,
    principalDid: PERSONA,
    ...over,
  })

  it('is found when one targets the community as the persona (either casing of secretKind)', async () => {
    for (const kind of [DID_SELF_ISSUED, 'didSelfIssued']) {
      const { vta } = fakeVta()
      vta.vaultList = jest.fn(async () => [
        entry({ id: 'other', principalDid: 'did:web:else' }),
        entry({ secretKind: kind }),
      ])
      await expect(ensureSignInVaultEntry(VTC, persona, { vta })).resolves.toBe('vault_existing')
      expect(vta.vaultList).toHaveBeenCalledWith({ contextId: 'vta', targetDid: VTC })
      expect(vta.vaultUpsert).not.toHaveBeenCalled()
      expect(vta.sealVaultSecret).not.toHaveBeenCalled()
    }
  })

  it('is created with a sealed did-self-issued secret when none fits', async () => {
    const { vta } = fakeVta()
    vta.vaultList = jest.fn(async () => [
      entry({ targets: [{ kind: 'did', did: 'did:web:another-community' }] }),
      entry({ status: 'archived' }),
      entry({ secretKind: 'password' }),
    ])
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    await expect(ensureSignInVaultEntry(VTC, persona, { vta })).resolves.toBe('vault_new')
    expect(vta.sealVaultSecret).toHaveBeenCalledWith({
      kind: DID_SELF_ISSUED,
      did: PERSONA,
      signingKeyId: `${PERSONA}#key-0`,
    })
    const payload = (vta.vaultUpsert as jest.Mock).mock.calls[0][0]
    expect(payload).toMatchObject({
      contextId: 'vta',
      targets: [{ kind: 'did', did: VTC }],
      secretKind: DID_SELF_ISSUED,
      sealedSecret: { envelope: 'didcomm-authcrypt', jwe: expect.any(String) },
    })
    expect(payload.label).toEqual(expect.any(String))
    // The cleartext never travels outside the seal.
    expect(JSON.stringify(payload)).not.toContain('signingKeyId')
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('says noVaultEntry when the secret cannot be sealed, and creates nothing', async () => {
    const { vta } = fakeVta()
    vta.sealVaultSecret = jest.fn(async () => {
      throw new Error('not connected')
    })
    const error = await failureOf(ensureSignInVaultEntry(VTC, persona, { vta }))
    expect(error.reason).toBe('noVaultEntry')
    expect(vta.vaultUpsert).not.toHaveBeenCalled()
  })

  it("maps the VTA's refusal of the upsert", async () => {
    const { vta } = fakeVta()
    vta.vaultUpsert = jest.fn(async () => {
      throw new VtiRefusal('taskFailed', 'vault/upsert:sealedSecretInvalid — DIDComm unpack: bad', {
        reason: 'unpack_failed',
      })
    })
    const error = await failureOf(ensureSignInVaultEntry(VTC, persona, { vta }))
    expect(error).toMatchObject({ reason: 'agentRefused', detail: 'sealedSecretInvalid' })
  })
})

describe("enrolling the phone's UV key", () => {
  const ext = { [EXT_UV_KEY]: { kind: 'hardwareKey', did: UV_DID, hardwareBacked: false, biometricGated: true } }

  it('sends a heartbeat carrying the key: biometric-gated, not hardware-backed', async () => {
    const { vta } = fakeVta()
    await enrolUvKey({ vta, uvDid: async () => UV_DID })
    expect(vta.heartbeat).toHaveBeenCalledWith(ext)
    expect(vta.register).not.toHaveBeenCalled()
  })

  it('registers with the key when the phone is not registered yet', async () => {
    const { vta } = fakeVta()
    vta.heartbeat = jest.fn(async () => {
      throw new VtiRefusal('notFound', `device/heartbeat:notRegistered — no DeviceBinding for did:peer:x`)
    })
    await enrolUvKey({ vta, uvDid: async () => UV_DID })
    expect(vta.register).toHaveBeenCalledWith(ext)
  })

  it('beats again when a register races another one', async () => {
    const { vta } = fakeVta()
    vta.heartbeat = jest
      .fn()
      .mockRejectedValueOnce(new VtiRefusal('notFound', 'device/heartbeat:notRegistered — no DeviceBinding'))
      .mockResolvedValueOnce(undefined)
    vta.register = jest.fn(async () => 'alreadyRegistered' as const)
    await enrolUvKey({ vta, uvDid: async () => UV_DID })
    expect(vta.heartbeat).toHaveBeenCalledTimes(2)
  })

  it('maps any other refusal', async () => {
    const { vta } = fakeVta()
    vta.heartbeat = jest.fn(async () => {
      throw new VtiRefusal('forbidden', 'device/heartbeat:deviceDisabled — disabled')
    })
    expect((await failureOf(enrolUvKey({ vta, uvDid: async () => UV_DID }))).reason).toBe('agentRefused')
  })
})
