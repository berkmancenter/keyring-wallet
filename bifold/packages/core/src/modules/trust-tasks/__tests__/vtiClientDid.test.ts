import {
  didDocumentToNumAlgo2Did,
  didToNumAlgo2DidDocument,
  JsonEncoder,
  JsonTransformer,
  TypedArrayEncoder,
} from '@credo-ts/core'
import { generateKeyPairFromSeed } from '@stablelib/ed25519'

import { createVtiClientDid, createVtiTemporaryDidKey, type VtiMediatorEndpoints } from '../module/VtiMediatorTransport'

// A VTA pushes a consent request to an approver only when the approver's DID
// document names its mediator in a `DIDCommMessaging` service (vti #1579). The
// phone's client DID used to carry Credo's DIDComm v1 `did-communication`
// service with the socket URL, which the VTA reads as "no route" — so a phone
// approver was never pushed to, and saw a request only by fetching it.

const MEDIATOR_DID = 'did:peer:2.Ez6LSmediator.Vz6Mkmediator'
const mediator: VtiMediatorEndpoints = {
  did: MEDIATOR_DID,
  authEndpoint: 'https://mediator.example/mediator/v1',
  wsEndpoint: 'wss://mediator.example/mediator/v1/ws',
  publicJwk: {} as never,
  kid: `${MEDIATOR_DID}#key-1`,
}

/** An agent whose KMS hands back a fixed Ed25519 key and whose registrar encodes the document it is given. */
function agentMinting() {
  const x = TypedArrayEncoder.toBase64Url(generateKeyPairFromSeed(new Uint8Array(32).fill(7)).publicKey)
  return {
    kms: { createKey: async () => ({ keyId: 'kms-1', publicJwk: { kty: 'OKP', crv: 'Ed25519', x, kid: 'kms-1' } }) },
    dids: {
      create: async ({ didDocument }: { didDocument: Parameters<typeof didDocumentToNumAlgo2Did>[0] }) => ({
        didState: { state: 'finished', did: didDocumentToNumAlgo2Did(didDocument) },
      }),
    },
  } as never
}

describe('the client DID a phone presents to its VTA', () => {
  it('names its mediator by DID in a DIDCommMessaging service', async () => {
    const did = await createVtiClientDid(agentMinting(), mediator)
    const doc = didToNumAlgo2DidDocument(did)
    const services = (doc.service ?? []).map((s) => JsonTransformer.toJSON(s) as Record<string, unknown>)
    expect(services).toHaveLength(1)
    expect(services[0].type).toBe('DIDCommMessaging')
    expect(services[0].serviceEndpoint).toMatchObject({ uri: MEDIATOR_DID, accept: ['didcomm/v2'] })
  })

  it('encodes the service the way the reference client does', async () => {
    const did = await createVtiClientDid(agentMinting(), mediator)
    const segment = did.split('.').find((part) => part.startsWith('S'))
    expect(segment).toBeDefined()
    const abbreviated = JsonEncoder.fromBase64Url(segment!.slice(1)) as Record<string, unknown>
    expect(abbreviated.t).toBe('dm')
    // Credo nests the endpoint as the DIDComm v2 object form and leaves its
    // keys unabbreviated; the VTA reads `uri` from either form.
    expect(abbreviated.s).toMatchObject({ uri: MEDIATOR_DID, accept: ['didcomm/v2'] })
    // Nothing of the old v1 shape survives.
    expect(JSON.stringify(abbreviated)).not.toContain('did-communication')
    expect(JSON.stringify(abbreviated)).not.toContain('wss://')
  })

  it('keeps the keys the mediator login and the TSP session read', async () => {
    const did = await createVtiClientDid(agentMinting(), mediator)
    const doc = didToNumAlgo2DidDocument(did)
    expect(doc.authentication).toHaveLength(1)
    expect(doc.keyAgreement).toHaveLength(1)
  })
})

// The VTA Farm's Admin DID field accepts only an Ed25519 did:key ("Paste only
// the did:key value (e.g. did:key:z6Mk…)", measured 2026-09-25), the form pnm
// and the plugin show. A link without a QR shows one; the first connect swaps
// it onto a did:peer:2 that names the mediator.
describe('the temporary key a person pastes into the Farm', () => {
  function agentImporting() {
    const x = TypedArrayEncoder.toBase64Url(generateKeyPairFromSeed(new Uint8Array(32).fill(7)).publicKey)
    const imported: { did: string; keys?: { didDocumentRelativeKeyId: string; kmsKeyId: string }[] }[] = []
    const agent = {
      kms: { createKey: async () => ({ keyId: 'kms-1', publicJwk: { kty: 'OKP', crv: 'Ed25519', x, kid: 'kms-1' } }) },
      dids: { import: async (o: (typeof imported)[number]) => void imported.push(o) },
    } as never
    return { agent, imported }
  }

  it('is an Ed25519 did:key', async () => {
    const { agent } = agentImporting()
    await expect(createVtiTemporaryDidKey(agent)).resolves.toMatch(/^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]+$/)
  })

  it('records its signing and key-agreement methods against the one KMS key', async () => {
    const { agent, imported } = agentImporting()
    const did = await createVtiTemporaryDidKey(agent)
    expect(imported).toHaveLength(1)
    expect(imported[0].did).toBe(did)
    const ids = (imported[0].keys ?? []).map((k) => k.didDocumentRelativeKeyId).sort()
    // The Ed25519 method (#z6Mk…) and the X25519 one derived from it (#z6LS…).
    expect(ids).toHaveLength(2)
    expect(ids.some((id) => id.startsWith('#z6Mk'))).toBe(true)
    expect(ids.some((id) => id.startsWith('#z6LS'))).toBe(true)
    expect(new Set((imported[0].keys ?? []).map((k) => k.kmsKeyId))).toEqual(new Set(['kms-1']))
  })
})
