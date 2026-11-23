/**
 * Signing in to a VTA Farm with an agent claimed from it (IN-388), against a
 * faked Farm that does what vtafarm-api c437bfbb does (internal/handler/
 * trust_task_oob.go, internal/walletauth/store.go): it knows a person by the
 * did:key their agent was claimed with, checks identify and the grant as proofs
 * by that did:key, ends the request on a wrong number or a key it knows for no
 * account, holds the grant to its own request (the step-2 digest, the session
 * key, the origin, no signing scope), and signs every answer with its own key.
 * Everything runs on real Ed25519 proofs.
 *
 * The cases are the contract's integration checklist: one agent and two, a key
 * the Farm does not know, a wrong number, an expired request, altered context,
 * a Farm signature that does not verify; and its retry rules (§5).
 */
import { TypedArrayEncoder } from '@credo-ts/core'
import { ed25519 } from '@noble/curves/ed25519.js'

import { jcsCanonicalize, verifyDocumentProof, type ProofPurpose } from '../documentProof'
import {
  FARM_RETRY_PAUSE_MS,
  FARM_SEND_RETRIES,
  farmApprove,
  farmIdentifyAndProve,
  farmIdentitiesFrom,
  sendToFarm,
  type FarmLogin,
  type FarmSignInIdentity,
} from '../module/farmSignIn'
import {
  OOB_TASKS,
  SIGN_IN_FAILURE_MESSAGES,
  SignInError,
  claimSignIn,
  newThrowawayKey,
  signWithKey,
  type SignInDidDocument,
} from '../module/oobSignIn'
import { GRANT_LIFETIME_SECONDS, digestMultibase } from '../module/oobSignInAgent'

jest.mock('react-native-keychain', () => ({}))

const FARM = 'did:webvh:QmFarmScid:vtafarm.example.com'
const BASE = 'https://api.vtafarm.example.com'
const ORIGIN = 'https://vtafarm.example.com'
const FARM_NAME = 'VTA Farm'
const MATCH = '42'
const LINK = (exp: number, requestId: string) =>
  `https://link.trustoverip.org/t#_from=${encodeURIComponent(FARM)}&_id=${requestId}&_exp=${exp}&_type=/vti/flow/sign-in/0.1`

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

// The Farm signs with one key, under assertionMethod; its document names its endpoints by type.
const farmSecret = new Uint8Array(32).fill(21)
const strangerSecret = new Uint8Array(32).fill(22)
const farmDocument: SignInDidDocument = {
  id: FARM,
  verificationMethod: [
    {
      id: `${FARM}#key-0`,
      type: 'Multikey',
      controller: FARM,
      publicKeyMultibase: multikey(ed25519.getPublicKey(farmSecret)),
    },
  ],
  assertionMethod: [`${FARM}#key-0`],
  authentication: [`${FARM}#key-0`],
  service: [
    { id: `${FARM}#tt`, type: 'TrustTaskHTTPS', serviceEndpoint: BASE },
    { id: `${FARM}#portal`, type: 'SignInPortal', serviceEndpoint: `${ORIGIN}/login` },
  ],
}

// Two agents claimed from the Farm, each with its own claim key, and one claimed before the key was kept.
const claimSecretA = new Uint8Array(32).fill(31)
const claimSecretB = new Uint8Array(32).fill(32)
const CLAIM_A = didKeyOf(claimSecretA)
const CLAIM_B = didKeyOf(claimSecretB)
const AGENT_A = 'did:webvh:QmA:vtafarm.example.com:agents:a'
const AGENT_B = 'did:webvh:QmB:vtafarm.example.com:agents:b'
const AGENT_OLD = 'did:webvh:QmO:vtafarm.example.com:agents:old'
const secretOf: Record<string, Uint8Array> = { [CLAIM_A]: claimSecretA, [CLAIM_B]: claimSecretB }

const identityA: FarmSignInIdentity = {
  source: 'farm',
  vtaDid: AGENT_A,
  agentName: 'Home',
  current: true,
  did: CLAIM_A,
}
const identityB: FarmSignInIdentity = {
  source: 'farm',
  vtaDid: AGENT_B,
  agentName: 'Work',
  current: false,
  did: CLAIM_B,
}

/** The claim key as the phone holds it: it signs as its did:key. */
const loginOf = (did: string, log?: string[]): FarmLogin => ({
  did,
  sign: async (document: Record<string, unknown>, proofPurpose: ProofPurpose) => {
    log?.push(`sign ${String(document.type).split('/spec/')[1]} ${proofPurpose}`)
    return signWithKey(document, secretOf[did], `${did}#${did.slice(8)}`, proofPurpose)
  },
})

const resolverFor = (document: SignInDidDocument) => ({ dids: { resolveDidDocument: async () => document } }) as never
const errorDocument = (code: string, retryable = false) => ({
  type: 'https://trusttasks.org/spec/trust-task-error/0.1',
  payload: { code, message: 'refused', retryable },
})

type Doc = Record<string, unknown> & { id: string; type: string; issuer: string; payload: Record<string, unknown> }

/**
 * The faked Farm. `bound`: the claim keys it knows, each for an account (walletauth.ActiveBindings). One request,
 * as trust_task_oob.go keeps it: pending → claimed → identified → approved, or declined on a wrong number, a key it
 * knows for no account, or a grant that does not match.
 */
function fakeFarm(
  options: {
    bound?: string[]
    /** Change step 2 before it is signed; `stranger` signs it with a key the Farm's document does not name. */
    step2Change?: (answer: Doc, payload: Record<string, unknown>) => void
    step2SignedBy?: 'farm' | 'stranger'
    respondSignedBy?: 'farm' | 'stranger'
    /** Hold the grant to a step-2 digest other than the one sent (the Farm's record of it changed). */
    digestMismatch?: boolean
    /** Answer these sends with nothing (the post throws), or a retryable refusal, in order of arrival. */
    script?: ('noAnswer' | 'retryable')[]
  } = {}
) {
  const bound = new Set(options.bound ?? [CLAIM_A, CLAIM_B])
  const script = [...(options.script ?? [])]
  const state: {
    state: string
    requestId: string
    approver?: string
    step1?: Record<string, unknown>
    step2Digest?: string
    identified?: string
    sessionKey: string
    grant?: Doc
    received: Doc[]
  } = { state: 'pending', requestId: 'r3qU7Zk2Xo9Rt1LwPb4HdA', sessionKey: newThrowawayKey().did, received: [] }
  const decisionClosesAt = new Date((Math.floor(Date.now() / 1000) + 120) * 1000).toISOString().replace('.000Z', 'Z')
  const signed = (answer: Doc, by: 'farm' | 'stranger' = 'farm') =>
    signWithKey(answer, by === 'farm' ? farmSecret : strangerSecret, `${FARM}#key-0`, 'assertionMethod')
  const respondTo = (request: Doc, payload: Record<string, unknown>): Doc => ({
    id: `urn:uuid:${Math.random()}`,
    threadId: request.id,
    type: `${request.type}#response`,
    issuer: FARM,
    recipient: request.issuer,
    issuedAt: '2026-10-30T09:00:00Z',
    payload,
  })
  const verifiesAs = (document: Doc, purpose: ProofPurpose) =>
    verifyDocumentProof(resolverFor(didKeyDocument(document.issuer)), document, document.issuer, {
      proofPurpose: purpose,
    })

  const post = jest.fn(async (url: string, document: Record<string, unknown>) => {
    expect(url).toBe(`${BASE}/trust-tasks`)
    const doc = document as Doc
    state.received.push(JSON.parse(JSON.stringify(doc)))
    const scripted = script.shift()
    if (scripted === 'noAnswer') throw new Error('socket hang up')
    if (scripted === 'retryable') return errorDocument('unavailable', true)
    if (doc.type === OOB_TASKS.claim02) {
      if (doc.payload.requestId !== state.requestId) return errorDocument('auth/oob:requestNotFound')
      if (state.state !== 'pending') return errorDocument('auth/oob/claim:alreadyClaimed')
      state.state = 'claimed'
      state.approver = doc.issuer
      const step1 = {
        requestId: state.requestId,
        service: { did: FARM, name: FARM_NAME },
        origin: ORIGIN,
        purpose: 'login',
        decisionClosesAt,
      }
      state.step1 = step1
      return signed(respondTo(doc, step1))
    }
    if (doc.type === OOB_TASKS.prove03) {
      const identify = doc.payload.identify as Doc
      if (doc.issuer !== state.approver || state.state !== 'claimed') return errorDocument('auth/oob:notAuthorized')
      const valid =
        identify.type === OOB_TASKS.identify &&
        identify.recipient === FARM &&
        identify.issuer.startsWith('did:key:z6Mk') &&
        (await verifiesAs(identify, 'authentication')) &&
        identify.payload.approverKey === doc.issuer &&
        identify.payload.requestId === state.requestId
      if (!valid || !bound.has(identify.issuer)) {
        state.state = 'declined'
        return errorDocument('auth/oob:notAuthorized')
      }
      if (identify.payload.enteredNumber !== MATCH) {
        state.state = 'declined'
        return errorDocument('auth/oob/prove:numberMismatch')
      }
      const payload: Record<string, unknown> = {
        ...state.step1,
        sessionKey: state.sessionKey,
        requester: {
          location: 'unknown',
          browser: 'Safari',
          os: 'macOS',
          createdAt: '2026-10-30T08:59:00Z',
          sameNetwork: 'unknown',
        },
        identifiedAs: identify.issuer,
      }
      const answer = respondTo(doc, payload)
      options.step2Change?.(answer, payload)
      const step2 = signed(answer, options.step2SignedBy)
      state.step2Digest = options.digestMismatch ? 'zSomethingElse' : digestMultibase(step2)
      state.identified = identify.issuer
      state.state = 'identified'
      return step2
    }
    if (doc.type === OOB_TASKS.respond03) {
      const grant = doc.payload.grant as Doc
      state.grant = grant
      if (doc.issuer !== state.approver || grant.issuer !== state.identified || state.state !== 'identified') {
        return errorDocument('auth/oob:notAuthorized')
      }
      if (grant.type !== OOB_TASKS.grant03 || !(await verifiesAs(grant, 'assertionMethod'))) {
        state.state = 'declined'
        return errorDocument('auth/oob:notAuthorized')
      }
      const p = grant.payload
      const contextOK =
        p.requestId === state.requestId &&
        p.approverKey === doc.issuer &&
        p.sessionKey === state.sessionKey &&
        p.origin === ORIGIN &&
        p.contextDigest === state.step2Digest &&
        p.signingScope === undefined
      if (!contextOK) {
        state.state = 'declined'
        return errorDocument('auth/oob/respond:contextMismatch')
      }
      state.state = p.decision === 'approve' ? 'approved' : 'declined'
      return signed(respondTo(doc, { status: state.state }), options.respondSignedBy)
    }
    if (doc.type === OOB_TASKS.cancel) {
      state.state = 'cancelled'
      return signed(respondTo(doc, { status: 'cancelled' }))
    }
    throw new Error(`unexpected ${doc.type}`)
  })
  return { post, state }
}

const noPause = async () => undefined

/** Claim the Farm's request, as the steps do for a Farm: claimSignIn with the Farm's retries. */
async function claimed(farm: ReturnType<typeof fakeFarm>) {
  return claimSignIn(LINK(Math.floor(Date.now() / 1000) + 300, farm.state.requestId), {
    resolveDid: async () => farmDocument,
    post: farm.post,
    isKnownCommunity: () => true,
    send: (base, make) => sendToFarm({ post: farm.post, pause: noPause }, base, make),
  })
}

const depsFor = (farm: ReturnType<typeof fakeFarm>, login: FarmLogin) => ({
  post: farm.post,
  resolveDid: async (did: string) => (did === FARM ? farmDocument : didKeyDocument(did)),
  login,
  pause: noPause,
})

const confirmed = (log?: string[]) =>
  jest.fn(async (_reason: string) => {
    log?.push('confirmOwner')
    return { ok: true }
  })

const failureOf = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (e) {
    return e as SignInError
  }
  throw new Error('expected the sign-in to fail')
}

describe('which agents can sign in to a Farm', () => {
  const agents = [
    { vtaDid: AGENT_B, name: 'Work', current: false, farmLogin: { farmDid: FARM, did: CLAIM_B } },
    { vtaDid: AGENT_A, name: 'Home', current: true, farmLogin: { farmDid: FARM, did: CLAIM_A } },
    { vtaDid: AGENT_OLD, name: 'Old', current: false },
    {
      vtaDid: 'did:webvh:QmX:other.example:x',
      name: 'Elsewhere',
      current: false,
      farmLogin: { farmDid: 'did:webvh:QmOther:other.example', did: didKeyOf(new Uint8Array(32).fill(9)) },
    },
  ]

  it("each agent claimed from this Farm whose link kept its key, the current agent's first", () => {
    expect(farmIdentitiesFrom(FARM, agents)).toEqual([identityA, identityB])
  })

  it('none for an agent claimed before the key was kept, or from another Farm', () => {
    expect(farmIdentitiesFrom(FARM, [agents[2]])).toEqual([])
    expect(farmIdentitiesFrom('did:webvh:QmOther:other.example', agents).map((i) => i.vtaDid)).toEqual([
      agents[3].vtaDid,
    ])
  })
})

describe('signing in to a Farm', () => {
  it('one agent: claimed, identified by its claim key, approved after the owner check, signed in', async () => {
    const farm = fakeFarm()
    const log: string[] = []
    const login = loginOf(CLAIM_A, log)
    const claim = await claimed(farm)
    const proved = await farmIdentifyAndProve(claim, MATCH, identityA, depsFor(farm, login))
    expect(proved).toMatchObject({
      identifiedAs: CLAIM_A,
      sessionKey: farm.state.sessionKey,
      requester: { browser: 'Safari', os: 'macOS', location: 'unknown' },
      farm: { vtaDid: AGENT_A, agentName: 'Home', serviceName: FARM_NAME },
    })
    // The Farm said "unknown": not the same as "not the same network".
    expect(proved.requester.sameNetwork).toBeUndefined()

    const confirmOwner = confirmed(log)
    await expect(farmApprove(proved, identityA, { ...depsFor(farm, login), confirmOwner })).resolves.toEqual({
      status: 'approved',
    })
    expect(farm.state.state).toBe('approved')
    // The owner check comes before the grant is signed.
    expect(log).toEqual([
      'sign auth/oob/identify/0.1 authentication',
      'confirmOwner',
      'sign auth/oob/grant/0.3 assertionMethod',
    ])
    expect(confirmOwner).toHaveBeenCalledTimes(1)
    const grant = farm.state.grant as Doc
    expect(grant.issuer).toBe(CLAIM_A)
    expect(grant.payload.signingScope).toBeUndefined()
    const ends = Date.parse(grant.payload.sessionEndsAt as string) / 1000
    expect(ends).toBeGreaterThan(Date.now() / 1000)
    expect(ends).toBeLessThanOrEqual(Date.now() / 1000 + GRANT_LIFETIME_SECONDS + 1)
    // Only the Farm was asked: claim, prove, respond.
    expect(farm.state.received.map((d) => d.type)).toEqual([OOB_TASKS.claim02, OOB_TASKS.prove03, OOB_TASKS.respond03])
  })

  it('two agents: either one chosen signs in as its own claim key', async () => {
    for (const identity of [identityA, identityB]) {
      const farm = fakeFarm()
      const login = loginOf(identity.did)
      const proved = await farmIdentifyAndProve(await claimed(farm), MATCH, identity, depsFor(farm, login))
      expect(proved.identifiedAs).toBe(identity.did)
      await farmApprove(proved, identity, { ...depsFor(farm, login), confirmOwner: confirmed() })
      expect(farm.state).toMatchObject({ state: 'approved', identified: identity.did })
    }
  })

  it('a key the Farm knows for no account: the Farm ends the request, and the person is told to pick the agent they got from it', async () => {
    const farm = fakeFarm({ bound: [CLAIM_B] })
    const failure = await failureOf(
      farmIdentifyAndProve(await claimed(farm), MATCH, identityA, depsFor(farm, loginOf(CLAIM_A)))
    )
    expect(failure.reason).toBe('farmNotLinked')
    expect(farm.state.state).toBe('declined')
    expect(SIGN_IN_FAILURE_MESSAGES.farmNotLinked).toMatch(/pick the agent you got from this service/)
  })

  it.each(['farmNotLinked', 'farmKeyMissing'] as const)(
    '%s offers both ways out: a new agent from this service, or another way to sign in',
    (reason) => {
      expect(SIGN_IN_FAILURE_MESSAGES[reason]).toMatch(/get a new agent from this service/i)
      expect(SIGN_IN_FAILURE_MESSAGES[reason]).toMatch(/sign in another way/)
    }
  )

  it('a wrong number ends the request, once', async () => {
    const farm = fakeFarm()
    const failure = await failureOf(
      farmIdentifyAndProve(await claimed(farm), '13', identityA, depsFor(farm, loginOf(CLAIM_A)))
    )
    expect(failure.reason).toBe('wrongNumber')
    expect(farm.state.received.filter((d) => d.type === OOB_TASKS.prove03)).toHaveLength(1)
  })

  it('not two digits: nothing is signed or sent', async () => {
    const farm = fakeFarm()
    const claim = await claimed(farm)
    const log: string[] = []
    farm.post.mockClear()
    expect(
      (await failureOf(farmIdentifyAndProve(claim, '4', identityA, depsFor(farm, loginOf(CLAIM_A, log))))).reason
    ).toBe('badNumber')
    expect(farm.post).not.toHaveBeenCalled()
    expect(log).toEqual([])
  })

  it('expired: a deadline passed is refused before anything is sent, and the Farm saying so is said so', async () => {
    const farm = fakeFarm()
    const claim = await claimed(farm)
    farm.post.mockClear()
    const late = { ...claim, decisionDeadline: Math.floor(Date.now() / 1000) - 1 }
    expect(
      (await failureOf(farmIdentifyAndProve(late, MATCH, identityA, depsFor(farm, loginOf(CLAIM_A))))).reason
    ).toBe('expired')
    expect(farm.post).not.toHaveBeenCalled()

    const farm2 = fakeFarm()
    const claim2 = await claimed(farm2)
    farm2.post.mockImplementationOnce(async () => errorDocument('auth/oob:requestExpired'))
    expect(
      (await failureOf(farmIdentifyAndProve(claim2, MATCH, identityA, depsFor(farm2, loginOf(CLAIM_A))))).reason
    ).toBe('expired')
  })

  it("altered context: a step 2 that does not repeat the claim's answer is not believed", async () => {
    for (const change of [
      (_a: Doc, p: Record<string, unknown>) => (p.origin = 'https://evil.example'),
      (_a: Doc, p: Record<string, unknown>) => (p.service = { did: 'did:webvh:QmEvil:evil.example', name: FARM_NAME }),
      (_a: Doc, p: Record<string, unknown>) => (p.identifiedAs = CLAIM_B),
      (a: Doc) => (a.threadId = 'urn:uuid:another'),
    ]) {
      const farm = fakeFarm({ step2Change: change })
      const failure = await failureOf(
        farmIdentifyAndProve(await claimed(farm), MATCH, identityA, depsFor(farm, loginOf(CLAIM_A)))
      )
      expect(failure.reason).toBe('badAnswer')
    }
  })

  it('altered context: a grant the Farm holds to another step 2 is refused, and nothing is sent again', async () => {
    const farm = fakeFarm({ digestMismatch: true })
    const login = loginOf(CLAIM_A)
    const proved = await farmIdentifyAndProve(await claimed(farm), MATCH, identityA, depsFor(farm, login))
    const failure = await failureOf(
      farmApprove(proved, identityA, { ...depsFor(farm, login), confirmOwner: confirmed() })
    )
    expect(failure).toMatchObject({ reason: 'contextMismatch', responded: true })
    expect(farm.state.received.filter((d) => d.type === OOB_TASKS.respond03)).toHaveLength(1)
  })

  it("a Farm signature that does not verify is not believed: the claim's answer, step 2, and the grant's answer", async () => {
    const farm1 = fakeFarm()
    farm1.post.mockImplementationOnce(async (_u: string, doc: Record<string, unknown>) =>
      signWithKey(
        {
          id: 'urn:uuid:x',
          threadId: doc.id,
          type: `${doc.type}#response`,
          issuer: FARM,
          recipient: doc.issuer,
          payload: {
            requestId: (doc.payload as Doc['payload']).requestId,
            service: { did: FARM, name: FARM_NAME },
            origin: ORIGIN,
            purpose: 'login',
            decisionClosesAt: new Date(Date.now() + 60_000).toISOString(),
          },
        },
        strangerSecret,
        `${FARM}#key-0`,
        'assertionMethod'
      )
    )
    expect((await failureOf(claimed(farm1))).reason).toBe('badAnswer')

    const farm2 = fakeFarm({ step2SignedBy: 'stranger' })
    expect(
      (await failureOf(farmIdentifyAndProve(await claimed(farm2), MATCH, identityA, depsFor(farm2, loginOf(CLAIM_A)))))
        .reason
    ).toBe('badAnswer')

    const farm3 = fakeFarm({ respondSignedBy: 'stranger' })
    const login = loginOf(CLAIM_A)
    const proved = await farmIdentifyAndProve(await claimed(farm3), MATCH, identityA, depsFor(farm3, login))
    const failure = await failureOf(
      farmApprove(proved, identityA, { ...depsFor(farm3, login), confirmOwner: confirmed() })
    )
    expect(failure).toMatchObject({ reason: 'badAnswer', responded: true })
  })

  it('the owner check declined or unavailable: nothing is signed and the request stays open', async () => {
    for (const [reason, said] of [
      ['cancelled', 'uvCancelled'],
      ['unavailable', 'uvUnavailable'],
    ] as const) {
      const farm = fakeFarm()
      const log: string[] = []
      const login = loginOf(CLAIM_A, log)
      const proved = await farmIdentifyAndProve(await claimed(farm), MATCH, identityA, depsFor(farm, login))
      const sent = farm.post.mock.calls.length
      const failure = await failureOf(
        farmApprove(proved, identityA, {
          ...depsFor(farm, login),
          confirmOwner: jest.fn(async () => ({ ok: false, reason })),
        })
      )
      expect(failure).toMatchObject({ reason: said, responded: false })
      expect(log.filter((l) => l.includes('grant'))).toEqual([])
      expect(farm.post.mock.calls.length).toBe(sent)
      expect(farm.state.state).toBe('identified')
    }
  })

  it('a claim key this phone no longer holds: said so, and nothing is sent', async () => {
    const farm = fakeFarm()
    const claim = await claimed(farm)
    farm.post.mockClear()
    const gone: FarmLogin = { did: CLAIM_A, sign: async () => Promise.reject(new Error('key not found')) }
    expect((await failureOf(farmIdentifyAndProve(claim, MATCH, identityA, depsFor(farm, gone)))).reason).toBe(
      'farmKeyMissing'
    )
    expect(farm.post).not.toHaveBeenCalled()
  })

  it('identify is never signed by another key than the chosen agent’s', async () => {
    const farm = fakeFarm()
    const claim = await claimed(farm)
    farm.post.mockClear()
    expect(
      (await failureOf(farmIdentifyAndProve(claim, MATCH, identityA, depsFor(farm, loginOf(CLAIM_B))))).reason
    ).toBe('farmKeyMissing')
    expect(farm.post).not.toHaveBeenCalled()
  })
})

describe("the Farm's retry rules (§5)", () => {
  it('no answer: the same document, same id, is sent again', async () => {
    const farm = fakeFarm({ script: ['noAnswer'] })
    const claim = await claimed(farm)
    const [first, second] = farm.state.received
    expect(jcsCanonicalize(second)).toBe(jcsCanonicalize(first))
    expect(claim.requestId).toBe(farm.state.requestId)
  })

  it('a refusal the Farm marks retryable: sent again as a new document, after a pause', async () => {
    const farm = fakeFarm()
    const claim = await claimed(farm)
    farm.post.mockImplementationOnce(async (_u: string, doc: Record<string, unknown>) => {
      farm.state.received.push(doc as Doc)
      return errorDocument('unavailable', true)
    })
    const paused: number[] = []
    const deps = { ...depsFor(farm, loginOf(CLAIM_A)), pause: async (ms: number) => void paused.push(ms) }
    await farmIdentifyAndProve(claim, MATCH, identityA, deps)
    const proves = farm.state.received.filter((d) => d.type === OOB_TASKS.prove03)
    expect(proves).toHaveLength(2)
    expect(proves[1].id).not.toBe(proves[0].id)
    // The identify inside is the same one: the person's number is not asked or signed again.
    expect(jcsCanonicalize(proves[1].payload.identify)).toBe(jcsCanonicalize(proves[0].payload.identify))
    expect(paused).toEqual([FARM_RETRY_PAUSE_MS[0]])
  })

  it(`at most ${FARM_SEND_RETRIES} more sends, then it is said the Farm could not be reached`, async () => {
    const post = jest.fn(async () => {
      throw new Error('socket hang up')
    })
    const failure = await failureOf(sendToFarm({ post, pause: noPause }, BASE, () => ({ id: 'urn:uuid:1' })))
    expect(failure.reason).toBe('unreachable')
    expect(post).toHaveBeenCalledTimes(1 + FARM_SEND_RETRIES)
  })

  it('nothing is sent again after a refusal that is not retryable, or once the deadline has passed', async () => {
    const final = jest.fn(async () => errorDocument('auth/oob:requestNotFound'))
    expect(
      (await failureOf(sendToFarm({ post: final, pause: noPause }, BASE, () => ({ id: 'urn:uuid:1' })))).reason
    ).toBe('notFound')
    expect(final).toHaveBeenCalledTimes(1)

    const busy = jest.fn(async () => errorDocument('unavailable', true))
    const until = Math.floor(Date.now() / 1000) - 1
    expect(
      (await failureOf(sendToFarm({ post: busy, pause: noPause }, BASE, () => ({ id: 'urn:uuid:1' }), { until })))
        .reason
    ).toBe('refused')
    expect(busy).toHaveBeenCalledTimes(1)
  })
})
