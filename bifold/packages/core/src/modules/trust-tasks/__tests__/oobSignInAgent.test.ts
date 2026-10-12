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
import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'

import { jcsCanonicalize, verifyDocumentProof } from '../documentProof'
import {
  OOB_TASKS,
  SIGN_IN_FAILURE_MESSAGES,
  SignInError,
  newThrowawayKey,
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

function step1Payload() {
  return {
    requestId: REQUEST_ID,
    service: { did: VTC, name: VTC },
    origin: ORIGIN,
    purpose: 'login',
    decisionDeadline: NOW + 120,
  }
}

function claimedSignIn(): ClaimedSignIn {
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
        type: `${OOB_TASKS.claim}#response`,
        issuer: VTC,
        recipient: keyA.did,
        threadId: 'urn:uuid:claim',
        issuedAt: '2026-10-11T07:30:00Z',
        payload: step1Payload(),
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
 * context and proof), as vtc-service oob_tasks.rs does.
 */
function fakeCommunity(options: { step2Change?: (answer: Doc, payload: Record<string, unknown>) => void } = {}) {
  const state: { step2?: Record<string, unknown>; respondAnswer?: Record<string, unknown> } = {}
  const post = jest.fn(async (url: string, document: Record<string, unknown>) => {
    expect(url).toBe(`${BASE}/trust-tasks`)
    const doc = document as Doc
    if (doc.type === OOB_TASKS.prove) {
      const identify = doc.payload.identify as Doc
      if (
        !(await verifyDocumentProof(resolverFor(personaDocument()), identify, PERSONA, {
          proofPurpose: 'authentication',
        }))
      )
        return errorDocument('auth/oob:notAuthorized')
      if (identify.payload.enteredNumber !== MATCH) return errorDocument('auth/oob/prove:numberMismatch')
      const payload: Record<string, unknown> = {
        ...step1Payload(),
        sessionKey: newThrowawayKey().did,
        requester: {
          location: 'unknown',
          browser: 'unknown',
          os: 'unknown',
          createdAt: '2026-10-11T07:30:00Z',
          sameNetwork: true,
        },
        identifiedAs: identify.issuer,
      }
      const answer: Doc = {
        id: 'urn:uuid:step2',
        type: `${OOB_TASKS.prove}#response`,
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
    if (doc.type === OOB_TASKS.respond) {
      const grant = doc.payload.grant as Doc
      const ok =
        (await verifyDocumentProof(resolverFor(personaDocument()), grant, PERSONA, {
          proofPurpose: 'assertionMethod',
        })) && grant.payload.contextDigest === digestMultibase(state.step2)
      if (!ok) return errorDocument('auth/oob/respond:contextMismatch')
      state.respondAnswer = signWithKey(
        {
          id: 'urn:uuid:respond',
          type: `${OOB_TASKS.respond}#response`,
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
function fakeVta(options: { enrolledUv?: string | null; refuse?: string; reorder?: boolean; tamper?: boolean } = {}) {
  const enrolledUv = options.enrolledUv === undefined ? UV_DID : options.enrolledUv
  const signed = new Set<string>()
  const refuse = (code: string) => new VtiRefusal('taskFailed', `vault/sign-trust-task:${code} — refused`, { code })
  const signTrustTask = jest.fn(
    async ({ entryId, unsignedEnvelope, ext }: Parameters<SignInVta['signTrustTask']>[0]) => {
      expect(entryId).toBe(ENTRY_ID)
      if (options.refuse) throw refuse(options.refuse)
      const envelope = unsignedEnvelope as Doc
      let purpose: 'authentication' | 'assertionMethod' = 'authentication'
      if (envelope.type === OOB_TASKS.grant) {
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

    const [, prove] = community.post.mock.calls[0]
    expect(prove).toMatchObject({
      type: OOB_TASKS.prove,
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
        /decisionDeadline/,
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
      type: OOB_TASKS.grant,
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

    const [, respond] = community.post.mock.calls[1]
    expect(respond).toMatchObject({
      type: OOB_TASKS.respond,
      issuer: p.claimed.keyA.did,
      parentThreadId: REQUEST_ID,
      payload: { grant: { type: OOB_TASKS.grant, proof: { proofPurpose: 'assertionMethod' } } },
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
      expect(community.post).toHaveBeenCalledTimes(1) // prove only
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
    expect(community.post).toHaveBeenCalledTimes(1)
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
    expect(community.post).toHaveBeenCalledTimes(1)
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
