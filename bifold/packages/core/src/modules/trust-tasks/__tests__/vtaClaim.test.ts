/**
 * Claiming an agent from an agent host by one scan (`vta-claim`), against a
 * fake host that answers as ic3software/vtafarm-api
 * `docs/mobile-connection-app-api.md` at 4ee367f8 says the Farm does, with real
 * eddsa-jcs-2022 proofs both ways. The six "minimum integration tests" of its
 * §11 are the first six cases.
 */
import { TypedArrayEncoder } from '@credo-ts/core'
import { ed25519 } from '@noble/curves/ed25519.js'

import { verifyDocumentProof } from '../documentProof'
import { newThrowawayKey, signWithKey, type SignInDidDocument, type ThrowawayKey } from '../module/oobSignIn'
import { readTrigger, triggerAction, type TriggerAccept } from '../module/triggerLink'
import {
  claimCheck,
  claimVta,
  farmTasksUrl,
  NEXT_STEP_TASK,
  redeemVta,
  VTA_CLAIM_TASK,
  VTA_REDEEM_RESPONSE,
  VTA_REDEEM_TASK,
  VtaClaimError,
  type FarmAnswer,
  type VtaClaimDeps,
} from '../module/vtaClaim'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const FARM = 'did:webvh:QmFarmScid:farm.example.com'
const VTA = 'did:webvh:QmNewVta:dids.example.com:one-scan-vta'
const ENDPOINT = 'https://farm.example.com/api/'
const URL_ = 'https://farm.example.com/api/trust-tasks'
const HANDLE = 'q3Vt7mXo9LwA2bR5cJ8kNg'

const multikey = (publicKey: Uint8Array) => {
  const prefixed = new Uint8Array(2 + publicKey.length)
  prefixed.set([0xed, 0x01], 0)
  prefixed.set(publicKey, 2)
  return `z${TypedArrayEncoder.toBase58(prefixed)}`
}
const farmSecret = new Uint8Array(32).fill(9)
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
  service: [{ id: `${FARM}#tt`, type: 'TrustTaskHTTPS', serviceEndpoint: ENDPOINT }],
}
const didKeyDocument = (did: string): SignInDidDocument => {
  const vm = `${did}#${did.slice('did:key:'.length)}`
  return {
    id: did,
    verificationMethod: [{ id: vm, type: 'Multikey', controller: did, publicKeyMultibase: did.slice(8) }],
    authentication: [vm],
    assertionMethod: [vm],
  }
}
const resolverFor = (document: SignInDidDocument) => ({ dids: { resolveDidDocument: async () => document } }) as never

const codeFor = (exp = Math.floor(Date.now() / 1000) + 600, handle = HANDLE) =>
  `https://link.trustoverip.org/t#_from=${FARM}&_id=${handle}&_exp=${exp}&_type=/vti/flow/vta-claim/0.1`
const triggerOf = (link: string): TriggerAccept => {
  const action = triggerAction(readTrigger(link, { channel: 'scan' }))
  if (action.kind !== 'proceed') throw new Error(`not accepted: ${JSON.stringify(action)}`)
  return action.trigger
}

type Doc = Record<string, unknown> & { id: string; type: string; issuer: string; payload: Record<string, unknown> }

/**
 * The fake host: one reservation, claimed by the first key that asks; the
 * person's decision on the page is `decide()`; redeem answers pending until it,
 * then the hand-over (fetchable again), or the refusal.
 */
function fakeFarm() {
  const state: {
    claimant?: string
    decision?: 'match' | 'notMine'
    expired?: boolean
    pendingPolls: number
    seen: Map<string, { body: string; answer: FarmAnswer }>
  } = { pendingPolls: 0, seen: new Map() }
  const sign = (doc: Record<string, unknown>) => signWithKey(doc, farmSecret, `${FARM}#key-0`, 'assertionMethod')
  const answerTo = (req: Doc, type: string, payload: Record<string, unknown>) =>
    sign({
      id: `urn:uuid:${Math.random().toString(16).slice(2)}`,
      threadId: req.threadId,
      parentThreadId: req.parentThreadId,
      type,
      issuer: FARM,
      recipient: req.issuer,
      issuedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      payload,
    })
  const error = (req: Doc, code: string, extra: Record<string, unknown> = {}) => ({
    status: 422,
    body: answerTo(req, 'https://trusttasks.org/spec/trust-task-error/0.5', {
      code,
      inResponseTo: { typeUri: req.type, id: req.id },
      ...extra,
    }),
  })
  const post = jest.fn(async (url: string, body: string): Promise<FarmAnswer> => {
    expect(url).toBe(URL_)
    const req = JSON.parse(body) as Doc
    // §10: the exact same bytes again get the retained answer.
    const earlier = state.seen.get(req.id)
    if (earlier) return earlier.body === body ? earlier.answer : { status: 409, body: undefined }
    // The request's own proof, by the key it names (§4).
    const ok = await verifyDocumentProof(resolverFor(didKeyDocument(req.issuer)), req, req.issuer, {
      proofPurpose: 'authentication',
    })
    let answer: FarmAnswer
    if (!ok) answer = error(req, 'proofInvalid')
    else if (req.recipient !== FARM) answer = error(req, 'wrongRecipient')
    else if (req.payload.handle !== HANDLE || req.parentThreadId !== HANDLE)
      answer = error(req, 'provision/vta:handleNotFound')
    else if (state.expired) answer = error(req, 'provision/vta:handleExpired')
    else if (req.type === VTA_CLAIM_TASK) {
      if (state.claimant && state.claimant !== req.issuer) answer = error(req, 'provision/vta/claim:alreadyClaimed')
      else {
        state.claimant = req.issuer
        answer = {
          status: 200,
          body: answerTo(req, NEXT_STEP_TASK, {
            expects: [{ typeUri: VTA_REDEEM_TASK, hint: { handle: HANDLE } }],
            continuation: 'proceed',
            inResponseTo: { typeUri: VTA_CLAIM_TASK, id: req.id },
          }),
        }
      }
    } else if (req.type === VTA_REDEEM_TASK) {
      if (req.issuer !== state.claimant) answer = error(req, 'provision/vta:notClaimant')
      else if (state.decision === 'notMine') answer = error(req, 'provision/vta/redeem:rejected')
      else if (state.decision === 'match') {
        answer = {
          status: 200,
          body: answerTo(req, VTA_REDEEM_RESPONSE, {
            handle: HANDLE,
            vtaDid: VTA,
            operation: 'provisionVta',
            mediatorDid: 'did:example:mediator',
          }),
        }
      } else {
        state.pendingPolls++
        answer = error(req, 'provision/vta/redeem:pending', {
          message: 'claim is not ready for hand-over',
          retryable: true,
          details: { state: 'claimed', confirmBy: 1791626701 },
        })
      }
    } else answer = { status: 400, body: undefined }
    state.seen.set(req.id, { body, answer })
    return answer
  })
  return { post, state, decide: (d: 'match' | 'notMine') => (state.decision = d), expire: () => (state.expired = true) }
}

const depsFor = (farm: ReturnType<typeof fakeFarm>, key: ThrowawayKey = newThrowawayKey()): VtaClaimDeps => ({
  resolveDid: jest.fn(async (did: string) => {
    if (did !== FARM) throw new Error(`unknown ${did}`)
    return farmDocument
  }),
  post: farm.post,
  sign: async (doc) => key.sign(doc, 'authentication'),
  walletDid: key.did,
  sleep: async () => undefined,
})

const failureOf = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected it to fail')
    },
    (e: unknown) => e as VtaClaimError
  )

describe('§11 minimum integration tests', () => {
  it('1. success: scan, claim, compare matching codes, redeem through pending, signed #response', async () => {
    const farm = fakeFarm()
    const deps = depsFor(farm)
    const claimed = await claimVta(triggerOf(codeFor()), deps)
    expect(claimed.claimCheck).toBe(claimCheck(deps.walletDid))
    expect(claimed.url).toBe(URL_)
    const states: string[] = []
    const redeeming = redeemVta(claimed, deps, {
      onState: (s) => {
        states.push(s.state)
        if (states.length === 2) farm.decide('match')
      },
    })
    await expect(redeeming).resolves.toEqual({
      vtaDid: VTA,
      operation: 'provisionVta',
      mediatorDid: 'did:example:mediator',
    })
    expect(states).toEqual(['claimed', 'claimed'])
    // Every request: the same key, a fresh id, the claim's thread and the handle.
    const sent = farm.post.mock.calls.map(([, body]) => JSON.parse(body) as Doc)
    expect(new Set(sent.map((d) => d.id)).size).toBe(sent.length)
    expect(new Set(sent.map((d) => d.threadId)).size).toBe(1)
    expect(sent.every((d) => d.issuer === deps.walletDid && d.parentThreadId === HANDLE)).toBe(true)
    expect(sent.every((d) => typeof d.issuedAt === 'string' && typeof d.expiresAt === 'string')).toBe(true)
  })

  it('2. not mine: the page says not mine, redeem is rejected, nothing handed over', async () => {
    const farm = fakeFarm()
    const deps = depsFor(farm)
    const claimed = await claimVta(triggerOf(codeFor()), deps)
    farm.decide('notMine')
    expect((await failureOf(redeemVta(claimed, deps))).reason).toBe('rejected')
  })

  it('3. expiry: the window passes, handleExpired', async () => {
    const farm = fakeFarm()
    const deps = depsFor(farm)
    const claimed = await claimVta(triggerOf(codeFor()), deps)
    farm.expire()
    expect((await failureOf(redeemVta(claimed, deps))).reason).toBe('handleExpired')
    // And a code whose own _exp has passed is refused before anything is sent.
    const late = { ...triggerOf(codeFor()), exp: Math.floor(Date.now() / 1000) - 10 }
    const farm2 = fakeFarm()
    expect((await failureOf(claimVta(late, depsFor(farm2)))).reason).toBe('expired')
    expect(farm2.post).not.toHaveBeenCalled()
  })

  it('4. second scanner: two keys claim one code, only the first holds it', async () => {
    const farm = fakeFarm()
    await claimVta(triggerOf(codeFor()), depsFor(farm))
    expect((await failureOf(claimVta(triggerOf(codeFor()), depsFor(farm)))).reason).toBe('alreadyClaimed')
  })

  it('5. wrong key: claimed with one key, redeemed with another, notClaimant', async () => {
    const farm = fakeFarm()
    const claimed = await claimVta(triggerOf(codeFor()), depsFor(farm))
    const other = newThrowawayKey()
    const error = await failureOf(redeemVta({ ...claimed, walletDid: other.did }, depsFor(farm, other)))
    expect(error.reason).toBe('notClaimant')
  })

  it('6. lost response: the same signed bytes are sent again, and the claim is not made twice', async () => {
    const farm = fakeFarm()
    const deps = depsFor(farm)
    const real = farm.post.getMockImplementation()!
    let dropped = false
    deps.post = jest.fn(async (url: string, body: string) => {
      const answer = await real(url, body)
      if (!dropped) {
        dropped = true
        throw new Error('the connection dropped before the answer')
      }
      return answer
    })
    const claimed = await claimVta(triggerOf(codeFor()), deps)
    const bodies = (deps.post as jest.Mock).mock.calls.map(([, body]) => body)
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toBe(bodies[0])
    expect(farm.state.claimant).toBe(deps.walletDid)
    expect(claimed.claimCheck).toHaveLength(6)
  })
})

describe('the claim check (§6)', () => {
  // Computed independently: base64.b32encode(sha256(did)).upper()[:6] (Python).
  it.each([
    ['did:key:z6MkExampleClaimantKey', 'T5WZ42'],
    ['did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK', 'QVI7IB'],
  ])('%s → %s', (did, check) => {
    expect(claimCheck(did)).toBe(check)
    expect(claimCheck(did)).toMatch(/^[A-Z2-7]{6}$/)
  })
})

describe('what is not believed', () => {
  it('a next-step not signed by the Farm the code names', async () => {
    const farm = fakeFarm()
    const deps = depsFor(farm)
    const impostor = new Uint8Array(32).fill(7)
    const real = farm.post.getMockImplementation()!
    deps.post = jest.fn(async (url: string, body: string) => {
      const answer = await real(url, body)
      const { proof, ...rest } = answer.body as Record<string, unknown>
      void proof
      return { ...answer, body: signWithKey(rest, impostor, `${FARM}#key-0`, 'assertionMethod') }
    })
    expect((await failureOf(claimVta(triggerOf(codeFor()), deps))).reason).toBe('badAnswer')
  })

  it('a hand-over for another handle, or naming no agent', async () => {
    const farm = fakeFarm()
    const deps = depsFor(farm)
    const claimed = await claimVta(triggerOf(codeFor()), deps)
    farm.decide('match')
    const real = farm.post.getMockImplementation()!
    deps.post = jest.fn(async (url: string, body: string) => {
      const answer = await real(url, body)
      const { proof, ...rest } = answer.body as Doc
      void proof
      return {
        ...answer,
        body: signWithKey(
          { ...rest, payload: { ...rest.payload, vtaDid: 'not-a-did' } },
          farmSecret,
          `${FARM}#key-0`,
          'assertionMethod'
        ),
      }
    })
    expect((await failureOf(redeemVta(claimed, deps))).reason).toBe('badAnswer')
  })

  it('a code whose handle is not a reservation handle is refused before anything is sent', async () => {
    const farm = fakeFarm()
    const short = { ...triggerOf(codeFor()), id: 'short' }
    expect((await failureOf(claimVta(short, depsFor(farm)))).reason).toBe('invalidCode')
    expect(farm.post).not.toHaveBeenCalled()
  })

  it('a host whose document names no TrustTaskHTTPS endpoint', async () => {
    const farm = fakeFarm()
    const deps = { ...depsFor(farm), resolveDid: async () => ({ ...farmDocument, service: [] }) }
    expect((await failureOf(claimVta(triggerOf(codeFor()), deps))).reason).toBe('unreachable')
  })
})

describe('the endpoint comes from the host DID only (§2)', () => {
  it('appends /trust-tasks to whatever path the service has, ignoring a trailing slash', () => {
    expect(farmTasksUrl(farmDocument)).toBe(URL_)
    expect(farmTasksUrl({ service: [{ type: 'TrustTaskHTTPS', serviceEndpoint: 'https://h.example/v1' }] })).toBe(
      'https://h.example/v1/trust-tasks'
    )
    expect(farmTasksUrl({ service: [{ type: 'TrustTaskHTTPS', serviceEndpoint: 'http://h.example' }] })).toBeUndefined()
  })
})

describe('cancelling', () => {
  it('stops asking when the person leaves', async () => {
    const farm = fakeFarm()
    const deps = depsFor(farm)
    const claimed = await claimVta(triggerOf(codeFor()), deps)
    let stop = false
    const error = await failureOf(
      redeemVta(claimed, deps, {
        onState: () => {
          stop = true
        },
        shouldStop: () => stop,
      })
    )
    expect(error.reason).toBe('cancelled')
    expect(farm.state.pendingPolls).toBe(1)
  })
})
