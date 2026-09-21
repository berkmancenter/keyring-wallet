import { DidDocument, JsonTransformer, TypedArrayEncoder } from '@credo-ts/core'
import { ed25519 } from '@noble/curves/ed25519.js'

import { enrolmentCode, signCompactJws, type EnrolmentOffer } from '@bifold/trust-tasks'

import { EnrolmentError, submitEnrolment, waitForGrant } from '../module/vtaEnrolment'

// The phone's half of linking by QR (plan §5.1): mint a temporary manager key,
// prove it holds it to the admin's page, show the same code the page shows,
// then wait for the admin's decision.

const TEMP_DID = 'did:peer:2.Vz6MkTemporary.Ez6LSTemporary'

jest.mock('../module/VtaClient', () => ({
  resolveVtaMediator: jest.fn(async () => ({ did: 'did:peer:2.mediator' })),
}))
jest.mock('../module/VtiMediatorTransport', () => ({
  createVtiClientDid: jest.fn(async () => 'did:peer:2.Vz6MkTemporary.Ez6LSTemporary'),
}))
jest.mock('@bifold/trust-tasks', () => ({
  ...jest.requireActual('@bifold/trust-tasks'),
  signCompactJws: jest.fn(async () => 'header.payload.signature'),
}))

const offer: EnrolmentOffer = {
  v: 1,
  t: 'vta-enrol',
  vta: 'did:webvh:Qm:alice',
  label: 'Lab agent',
  url: 'http://page/api/offers/NONCE0123456789ABCD',
  n: 'NONCE0123456789ABCD',
  exp: 2_000_000_000,
}

const store = () => {
  const managers: unknown[] = []
  return { managers, setManager: jest.fn(async (m: unknown) => void managers.push(m)) } as never as {
    managers: unknown[]
    setManager: jest.Mock
  }
}

const reply = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response

describe('submitting the temporary key', () => {
  it('records it as temporary, proves it to the page, and returns the code both screens show', async () => {
    const identities = store()
    const code = enrolmentCode(offer.n, TEMP_DID)
    const fetch = jest.fn(async () => reply(202, { state: 'submitted', code }))
    const result = await submitEnrolment({} as never, offer, identities as never, {
      fetch: fetch as never,
      now: () => 1_900_000_000_000,
    })
    expect(result).toEqual({ did: TEMP_DID, code })
    expect(identities.managers[0]).toMatchObject({ vtaDid: offer.vta, did: TEMP_DID, stage: 'temporary' })
    expect(signCompactJws).toHaveBeenCalledWith({}, TEMP_DID, {
      iss: TEMP_DID,
      aud: offer.url,
      nonce: offer.n,
      iat: 1_900_000_000,
      exp: 1_900_000_300,
    })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${offer.url}/submit`)
    expect(JSON.parse(String(init.body))).toEqual({ did: TEMP_DID, proof: 'header.payload.signature' })
  })

  it('never shows a code the page did not derive from this key', async () => {
    const fetch = jest.fn(async () => reply(202, { state: 'submitted', code: 'XXXX-XXXX' }))
    await expect(
      submitEnrolment({} as never, offer, store() as never, { fetch: fetch as never })
    ).rejects.toMatchObject({
      reason: 'rejected',
    })
  })

  it('names an expired offer and an unreachable page', async () => {
    const expired = jest.fn(async () => reply(410, { error: 'offer expired' }))
    await expect(
      submitEnrolment({} as never, offer, store() as never, { fetch: expired as never })
    ).rejects.toMatchObject({
      reason: 'expired',
    })
    const down = jest.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    await expect(submitEnrolment({} as never, offer, store() as never, { fetch: down as never })).rejects.toMatchObject(
      {
        reason: 'unreachable',
      }
    )
    await expect(
      submitEnrolment({} as never, { ...offer, exp: 1 }, store() as never, { fetch: down as never })
    ).rejects.toMatchObject({ reason: 'expired' })
  })
})

describe('waiting for the admin', () => {
  const statuses = (...states: string[]) => {
    const queue = [...states]
    return jest.fn(async () => reply(200, { state: queue.shift() ?? states[states.length - 1] }))
  }
  const noSleep = async () => undefined

  it('resolves on a grant', async () => {
    await expect(
      waitForGrant(offer, { fetch: statuses('submitted', 'submitted', 'granted') as never, sleep: noSleep })
    ).resolves.toBeUndefined()
  })

  it('rejects with the reason on a refusal or an expiry', async () => {
    await expect(waitForGrant(offer, { fetch: statuses('refused') as never, sleep: noSleep })).rejects.toMatchObject({
      reason: 'refused',
    })
    await expect(waitForGrant(offer, { fetch: statuses('expired') as never, sleep: noSleep })).rejects.toMatchObject({
      reason: 'expired',
    })
  })

  it('stops when the person cancels', async () => {
    await expect(
      waitForGrant(offer, { fetch: statuses('submitted') as never, sleep: noSleep, shouldStop: () => true })
    ).rejects.toBeInstanceOf(EnrolmentError)
  })

  it('waits out a page that blips, and reports one that stays away', async () => {
    let calls = 0
    const flaky = jest.fn(async () => {
      calls++
      if (calls < 3) throw new Error('blip')
      return reply(200, { state: 'granted' })
    })
    await expect(waitForGrant(offer, { fetch: flaky as never, sleep: noSleep })).resolves.toBeUndefined()
    const gone = jest.fn(async () => {
      throw new Error('gone')
    })
    await expect(waitForGrant(offer, { fetch: gone as never, sleep: noSleep })).rejects.toMatchObject({
      reason: 'unreachable',
    })
  })
})

describe('signCompactJws', () => {
  const { signCompactJws: realSignCompactJws } = jest.requireActual('@bifold/trust-tasks') as {
    signCompactJws: typeof signCompactJws
  }

  it('signs header.payload with the DID key, naming the full verification method as kid', async () => {
    const secret = new Uint8Array(32).fill(9)
    const publicKey = ed25519.getPublicKey(secret)
    const did = 'did:example:phone'
    const didDocument = JsonTransformer.fromJSON(
      {
        '@context': ['https://www.w3.org/ns/did/v1'],
        id: did,
        verificationMethod: [
          {
            id: '#key-1',
            type: 'Ed25519VerificationKey2018',
            controller: did,
            publicKeyBase58: TypedArrayEncoder.toBase58(publicKey),
          },
        ],
      },
      DidDocument
    )
    const agent = {
      dids: {
        resolveDidDocument: async () => didDocument,
        getCreatedDids: async () => [{ keys: [{ didDocumentRelativeKeyId: '#key-1', kmsKeyId: 'kms-1' }] }],
      },
      dependencyManager: {
        resolve: () => {
          return {
            sign: async ({ keyId, data }: { keyId: string; data: Uint8Array }) => {
              expect(keyId).toBe('kms-1')
              return { signature: ed25519.sign(data, secret) }
            },
          }
        },
      },
    }
    const jws = await realSignCompactJws(agent as never, did, { iss: did, aud: 'x' })
    const [h, p, s] = jws.split('.')
    expect(JSON.parse(TypedArrayEncoder.toUtf8String(TypedArrayEncoder.fromBase64Url(h)))).toEqual({
      alg: 'EdDSA',
      kid: `${did}#key-1`,
      typ: 'JWT',
    })
    expect(JSON.parse(TypedArrayEncoder.toUtf8String(TypedArrayEncoder.fromBase64Url(p)))).toEqual({
      iss: did,
      aud: 'x',
    })
    expect(ed25519.verify(TypedArrayEncoder.fromBase64Url(s), new TextEncoder().encode(`${h}.${p}`), publicKey)).toBe(
      true
    )
  })
})
