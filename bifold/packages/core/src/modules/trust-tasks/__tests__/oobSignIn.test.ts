/**
 * Claiming a scanned sign-in code (`auth/oob/claim`) against a faked
 * community. The community signs its answer with a real Ed25519 key listed
 * under `assertionMethod` in its DID document, so every check runs on a real
 * proof, as ref-22 ran them against a live one.
 */
import { TypedArrayEncoder } from '@credo-ts/core'
import { ed25519 } from '@noble/curves/ed25519.js'

import { verifyDocumentProof } from '../documentProof'
import {
  OOB_TASKS,
  SIGN_IN_FAILURE_MESSAGES,
  SignInError,
  cancelSignIn,
  claimSignIn,
  newThrowawayKey,
  signInCommunityLabel,
  signWithKey,
  type SignInDeps,
  type SignInDidDocument,
} from '../module/oobSignIn'

const NOW = 1791460800
const VTC = 'did:webvh:QmCommScid:vtc.example.com'
const BASE = 'https://vtc.example.com/v1'
const PORTAL = 'https://members.example.com/sign-in'
const REQUEST_ID = 'q3Vn7Zk2Xo9Rt1LwPb4HdA'

const multikey = (publicKey: Uint8Array) => {
  const prefixed = new Uint8Array(2 + publicKey.length)
  prefixed.set([0xed, 0x01], 0)
  prefixed.set(publicKey, 2)
  return `z${TypedArrayEncoder.toBase58(prefixed)}`
}

// The community's two keys: one it asserts with, one it only authenticates with.
const assertSecret = new Uint8Array(32).fill(3)
const authSecret = new Uint8Array(32).fill(4)
const vtcDocument: SignInDidDocument = {
  id: VTC,
  verificationMethod: [
    {
      id: `${VTC}#key-0`,
      type: 'Multikey',
      controller: VTC,
      publicKeyMultibase: multikey(ed25519.getPublicKey(assertSecret)),
    },
    {
      id: `${VTC}#key-1`,
      type: 'Multikey',
      controller: VTC,
      publicKeyMultibase: multikey(ed25519.getPublicKey(authSecret)),
    },
  ],
  assertionMethod: [`${VTC}#key-0`],
  authentication: [`${VTC}#key-1`],
  service: [
    { id: `${VTC}#tt`, type: 'TrustTaskHTTPS', serviceEndpoint: BASE },
    { id: `${VTC}#portal`, type: 'SignInPortal', serviceEndpoint: PORTAL },
  ],
}

// The link names another host, and carries an `endpoint` the reader ignores:
// neither may be where the claim goes.
const LINK = `https://link.trustoverip.org/t#_from=${encodeURIComponent(VTC)}&_id=${REQUEST_ID}&_exp=${
  NOW + 120
}&_type=/vti/flow/sign-in/0.1&endpoint=https%3A%2F%2Fattacker.example.com%2Ftt`

type Claim = Record<string, unknown> & { id: string; issuer: string; payload: { requestId: string } }

/** The community's answer to a claim, as the VTC signs it; `change` alters it before signing. */
function answerTo(
  claim: Claim,
  change: (answer: Record<string, unknown>, payload: Record<string, unknown>) => void = () => undefined,
  signer: { secret: Uint8Array; method: string; purpose: 'assertionMethod' | 'authentication' } = {
    secret: assertSecret,
    method: `${VTC}#key-0`,
    purpose: 'assertionMethod',
  }
) {
  const payload: Record<string, unknown> = {
    requestId: claim.payload.requestId,
    // test-vtc names itself by its DID here (findings M3).
    service: { did: VTC, name: VTC },
    origin: 'https://members.example.com',
    purpose: 'login',
    decisionDeadline: NOW + 120,
  }
  const answer: Record<string, unknown> = {
    id: 'urn:uuid:00000000-0000-4000-8000-000000000001',
    type: 'https://trusttasks.org/spec/auth/oob/claim/0.1#response',
    issuer: VTC,
    recipient: claim.issuer,
    threadId: claim.id,
    issuedAt: '2026-10-08T12:00:00Z',
    payload,
  }
  change(answer, payload)
  return signWithKey(answer, signer.secret, signer.method, signer.purpose)
}

const errorDocument = (code: string) => ({
  id: 'urn:uuid:00000000-0000-4000-8000-000000000002',
  type: 'https://trusttasks.org/spec/trust-task-error/0.1',
  payload: { code, message: 'refused' },
})

function depsWith(answer: (claim: Claim) => unknown, overrides: Partial<SignInDeps> = {}) {
  const post = jest.fn(async (_url: string, document: Record<string, unknown>) => answer(document as Claim))
  const resolveDid = jest.fn(async () => vtcDocument)
  const isKnownCommunity = jest.fn(async () => true)
  const deps: SignInDeps = { post, resolveDid, isKnownCommunity, now: () => NOW, ...overrides }
  return { deps, post, resolveDid, isKnownCommunity }
}

const failureOf = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected the sign-in to fail')
    },
    (e: unknown) => e as SignInError
  )

describe('claiming a sign-in code', () => {
  it('claims it and believes a properly signed answer', async () => {
    const { deps, post, resolveDid } = depsWith((claim) => answerTo(claim))
    const claimed = await claimSignIn(LINK, deps)

    expect(resolveDid).toHaveBeenCalledWith(VTC)
    expect(claimed).toMatchObject({
      requestId: REQUEST_ID,
      vtcDid: VTC,
      base: BASE,
      portalOrigin: 'https://members.example.com',
      decisionDeadline: NOW + 120,
    })
    expect(claimed.keyA.did).toMatch(/^did:key:z6Mk/)

    // The claim: K_a's, for authentication, threaded to the request.
    const [url, claim] = post.mock.calls[0]
    expect(url).toBe(`${BASE}/trust-tasks`)
    expect(claim).toMatchObject({
      type: OOB_TASKS.claim,
      issuer: claimed.keyA.did,
      recipient: VTC,
      parentThreadId: REQUEST_ID,
      payload: { requestId: REQUEST_ID },
      proof: { proofPurpose: 'authentication', verificationMethod: claimed.keyA.verificationMethod },
    })
    const mb = claimed.keyA.did.slice('did:key:'.length)
    const keyDocument = {
      id: claimed.keyA.did,
      verificationMethod: [
        { id: claimed.keyA.verificationMethod, type: 'Multikey', controller: claimed.keyA.did, publicKeyMultibase: mb },
      ],
      authentication: [claimed.keyA.verificationMethod],
    }
    const resolver = { dids: { resolveDidDocument: async () => keyDocument } } as never
    expect(
      await verifyDocumentProof(resolver, claim as Record<string, unknown>, claimed.keyA.did, {
        proofPurpose: 'authentication',
      })
    ).toBe(true)
  })

  it('takes the endpoint from the DID document, never from the link', async () => {
    const elsewhere = { ...vtcDocument, service: [...(vtcDocument.service ?? [])] }
    elsewhere.service![0] = { id: `${VTC}#tt`, type: 'TrustTaskHTTPS', serviceEndpoint: 'https://tt.example.org/x/' }
    const { deps, post } = depsWith((claim) => answerTo(claim), { resolveDid: async () => elsewhere })
    await claimSignIn(LINK, deps)
    expect(post.mock.calls.map(([url]) => url)).toEqual(['https://tt.example.org/x/trust-tasks'])
  })

  it('refuses a community this phone has not joined, before any network call', async () => {
    const { deps, post, resolveDid } = depsWith((claim) => answerTo(claim), { isKnownCommunity: async () => false })
    const error = await failureOf(claimSignIn(LINK, deps))
    expect(error).toBeInstanceOf(SignInError)
    expect(error.reason).toBe('notAMember')
    expect(resolveDid).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it('refuses a code that is not a sign-in, before any network call', async () => {
    const { deps, post, isKnownCommunity } = depsWith((claim) => answerTo(claim))
    const expired = await failureOf(claimSignIn(LINK.replace(`_exp=${NOW + 120}`, `_exp=${NOW - 61}`), deps))
    expect(expired.reason).toBe('expired')
    const claimLink = await failureOf(claimSignIn(LINK.replace('sign-in/0.1', 'vta-claim/0.1'), deps))
    expect(claimLink.reason).toBe('update')
    expect(isKnownCommunity).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it('says so when the community offers no sign-in endpoint', async () => {
    const noPortal = { ...vtcDocument, service: vtcDocument.service!.filter((s) => s.type !== 'SignInPortal') }
    const { deps, post } = depsWith((claim) => answerTo(claim), { resolveDid: async () => noPortal })
    expect((await failureOf(claimSignIn(LINK, deps))).reason).toBe('noSignIn')
    expect(post).not.toHaveBeenCalled()
  })

  it('says the service cannot be reached when the post fails', async () => {
    const { deps } = depsWith(() => {
      throw new Error('network down')
    })
    expect((await failureOf(claimSignIn(LINK, deps))).reason).toBe('unreachable')
  })

  describe('does not believe an answer', () => {
    it.each([
      [
        'signed by a key the community lists only for authentication',
        (claim: Claim) =>
          answerTo(claim, undefined, { secret: authSecret, method: `${VTC}#key-1`, purpose: 'authentication' }),
        /assertionMethod/,
      ],
      [
        "naming assertionMethod with a key not under the community's assertionMethod",
        (claim: Claim) =>
          answerTo(claim, undefined, { secret: authSecret, method: `${VTC}#key-1`, purpose: 'assertionMethod' }),
        /assertionMethod/,
      ],
      [
        'signed by someone else',
        (claim: Claim) =>
          answerTo(claim, undefined, {
            secret: new Uint8Array(32).fill(9),
            method: `${VTC}#key-0`,
            purpose: 'assertionMethod',
          }),
        /assertionMethod/,
      ],
      [
        'threaded to another message',
        (claim: Claim) => answerTo(claim, (a) => (a.threadId = 'urn:uuid:another')),
        /thread/,
      ],
      [
        'addressed to another key',
        (claim: Claim) => answerTo(claim, (a) => (a.recipient = newThrowawayKey().did)),
        /addressed/,
      ],
      [
        'for another request',
        (claim: Claim) => answerTo(claim, (_, p) => (p.requestId = 'AAAAAAAAAAAAAAAAAAAAAA')),
        /another request/,
      ],
      [
        'naming another community',
        (claim: Claim) => answerTo(claim, (_, p) => (p.service = { did: 'did:web:other.example', name: 'x' })),
        /another community/,
      ],
      ['for another purpose', (claim: Claim) => answerTo(claim, (_, p) => (p.purpose = 'payment')), /signing in/],
      [
        "from an origin that is not the community's portal",
        (claim: Claim) => answerTo(claim, (_, p) => (p.origin = 'https://attacker.example.com')),
        /origin/,
      ],
      [
        'whose decision deadline has passed',
        (claim: Claim) => answerTo(claim, (_, p) => (p.decisionDeadline = NOW)),
        /deadline has passed/,
      ],
      [
        'with no decision deadline',
        (claim: Claim) => answerTo(claim, (_, p) => delete p.decisionDeadline),
        /no decision deadline/,
      ],
    ])('%s', async (_, answer, detail) => {
      const { deps } = depsWith(answer)
      const error = await failureOf(claimSignIn(LINK, deps))
      expect(error.reason).toBe('badAnswer')
      expect(error.detail).toMatch(detail)
      expect(error.message).toBe(SIGN_IN_FAILURE_MESSAGES.badAnswer)
    })

    it('altered after it was signed', async () => {
      const { deps } = depsWith((claim) => {
        const signed = answerTo(claim)
        return { ...signed, payload: { ...(signed.payload as object), decisionDeadline: NOW + 9999 } }
      })
      expect((await failureOf(claimSignIn(LINK, deps))).reason).toBe('badAnswer')
    })
  })

  describe("the community's refusals, matched by their full codes", () => {
    it.each([
      ['auth/oob/claim:alreadyClaimed', 'alreadyClaimed'],
      ['auth/oob:requestExpired', 'expired'],
      ['auth/oob:requestNotFound', 'notFound'],
      // A bare code is not the VTC's: it is not taken for the full one.
      ['alreadyClaimed', 'refused'],
      ['auth/oob/claim:somethingNew', 'refused'],
    ])('%s is %s', async (code, reason) => {
      const { deps } = depsWith(() => errorDocument(code))
      const error = await failureOf(claimSignIn(LINK, deps))
      expect(error.reason).toBe(reason)
      expect(error.detail).toBe(code)
    })
  })
})

describe('cancelling a claimed sign-in', () => {
  it("is signed by the claim's key, threaded to the request, and reads the status", async () => {
    const { deps } = depsWith((claim) => answerTo(claim))
    const claimed = await claimSignIn(LINK, deps)
    const post = jest.fn(async () => ({
      type: 'https://trusttasks.org/spec/auth/oob/cancel/0.1#response',
      payload: { status: 'cancelled' },
    }))
    await expect(cancelSignIn(claimed, { post })).resolves.toEqual({ cancelled: true })
    expect(post).toHaveBeenCalledWith(
      `${BASE}/trust-tasks`,
      expect.objectContaining({
        type: OOB_TASKS.cancel,
        issuer: claimed.keyA.did,
        recipient: VTC,
        parentThreadId: REQUEST_ID,
        payload: { requestId: REQUEST_ID },
        proof: expect.objectContaining({ proofPurpose: 'authentication' }),
      })
    )
  })

  it('maps a refusal as the claim does', async () => {
    const { deps } = depsWith((claim) => answerTo(claim))
    const claimed = await claimSignIn(LINK, deps)
    const post = jest.fn(async () => errorDocument('auth/oob:requestNotFound'))
    expect((await failureOf(cancelSignIn(claimed, { post }))).reason).toBe('notFound')
  })
})

describe("the community's name", () => {
  it("is Keyring's own record of it, else its DID — never the answer's service.name", () => {
    expect(signInCommunityLabel('Test Community', VTC)).toBe('Test Community')
    expect(signInCommunityLabel(undefined, VTC)).toBe(VTC)
    expect(signInCommunityLabel('  ', VTC)).toBe(VTC)
  })
})
