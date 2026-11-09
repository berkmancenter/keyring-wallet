/** Resolving the inviter's `_from` and choosing a carriage (plan WP2), against fake documents and a fake agent. */
import { didToNumAlgo4DidDocument, type Agent } from '@credo-ts/core'
import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'

import { chooseInviterService, resolveInviter } from '../module/sharedConnectInviter'

import { KEYRING_STYLE_DID, MEDIATOR_DID } from './fixtures/sharedConnectFixtures'
import { base58, multikey, unbase58 } from './fixtures/shared-connect/inviter'

const logger = { debug: jest.fn() }
const agentResolving = (resolve: jest.Mock) =>
  ({ dids: { resolveDidDocument: resolve }, config: { logger } }) as unknown as Agent

describe('chooseInviterService', () => {
  it('chooses TSP and no relay host for a mediator named by DID', () => {
    expect(
      chooseInviterService(KEYRING_STYLE_DID, {
        service: [
          { id: '#didcomm', type: 'DIDCommMessaging', serviceEndpoint: { uri: MEDIATOR_DID } },
          { id: '#tsp', type: 'TSPTransport', serviceEndpoint: MEDIATOR_DID },
        ],
      })
    ).toEqual({ outcome: 'select', did: KEYRING_STYLE_DID, carriage: 'tsp', endpoint: MEDIATOR_DID })
  })

  it('chooses TSP with a relay host for the reference spelling', () => {
    expect(
      chooseInviterService('did:peer:2.x', {
        service: [{ id: '#tsp', type: 'tsp', serviceEndpoint: { uri: 'https://relay.example.org/tsp' } }],
      })
    ).toEqual({
      outcome: 'select',
      did: 'did:peer:2.x',
      carriage: 'tsp',
      endpoint: 'https://relay.example.org/tsp',
      relayHost: 'relay.example.org',
    })
  })

  it('chooses DIDComm when that is all the document offers', () => {
    expect(
      chooseInviterService('did:peer:2.x', { service: [{ type: 'DIDCommMessaging', serviceEndpoint: MEDIATOR_DID }] })
    ).toMatchObject({ outcome: 'select', carriage: 'didcomm' })
  })

  it('says no-common-transport for a document with no service, or none usable', () => {
    expect(chooseInviterService('did:peer:2.x', {})).toEqual({ outcome: 'no-common-transport', did: 'did:peer:2.x' })
    expect(
      chooseInviterService('did:peer:2.x', {
        service: [{ type: 'LinkedDomains', serviceEndpoint: 'https://a.example' }],
      })
    ).toMatchObject({ outcome: 'no-common-transport' })
  })
})

describe('resolveInviter', () => {
  beforeEach(() => logger.debug.mockClear())

  it('resolves through the agent and chooses', async () => {
    const resolve = jest.fn(async () => ({
      service: [{ id: '#tsp', type: 'TSPTransport', serviceEndpoint: MEDIATOR_DID }],
    }))
    await expect(resolveInviter(agentResolving(resolve), KEYRING_STYLE_DID)).resolves.toMatchObject({
      outcome: 'select',
      carriage: 'tsp',
    })
    expect(resolve).toHaveBeenCalledWith(KEYRING_STYLE_DID)
  })

  it('does not resolve a DID that is not a peer DID', async () => {
    const resolve = jest.fn()
    await expect(resolveInviter(agentResolving(resolve), 'did:web:example.org')).resolves.toEqual({
      outcome: 'unresolved',
      did: 'did:web:example.org',
    })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('is unresolved when the agent cannot expand the DID, and logs only a prefix and an error name', async () => {
    const resolve = jest.fn(async () => {
      throw new TypeError(`secret-endpoint-sentinel ${KEYRING_STYLE_DID}`)
    })
    await expect(resolveInviter(agentResolving(resolve), KEYRING_STYLE_DID)).resolves.toEqual({
      outcome: 'unresolved',
      did: KEYRING_STYLE_DID,
    })
    const logged = JSON.stringify(logger.debug.mock.calls)
    expect(logged).not.toContain('secret-endpoint-sentinel')
    expect(logged).not.toContain(KEYRING_STYLE_DID)
  })
})

// A long-form did:peer:4 carries its document and the hash of it, and resolveInviter treats what resolves as verified
// ("a peer DID is its own verification"). That holds only because Credo's expansion refuses a document that does not
// match the hash: these rows run Credo's own expansion, not a stand-in, so a resolver that stopped checking fails here.
describe('resolveInviter, a did:peer:4 whose document has been swapped', () => {
  const utf8 = (text: string) => new TextEncoder().encode(text)
  const ed = ed25519.getPublicKey(new Uint8Array(32).fill(7))
  const x = x25519.getPublicKey(new Uint8Array(32).fill(9))
  /** The encoded document part of a long-form did:peer:4 reaching its relay at `relay`. */
  const encodedDocument = (relay: string): string => {
    const doc = {
      '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/multikey/v1'],
      verificationMethod: [
        { id: '#key-1', type: 'Multikey', publicKeyMultibase: multikey(Uint8Array.from([0xed, 0x01]), ed) },
        { id: '#key-2', type: 'Multikey', publicKeyMultibase: multikey(Uint8Array.from([0xec, 0x01]), x) },
      ],
      authentication: ['#key-1'],
      assertionMethod: ['#key-1'],
      keyAgreement: ['#key-2'],
      service: [{ id: '#tsp', type: 'TSPTransport', serviceEndpoint: relay }],
    }
    return 'z' + base58(Uint8Array.from([0x80, 0x04, ...utf8(JSON.stringify(doc))]))
  }
  const hashOf = (encoded: string) => 'z' + base58(Uint8Array.from([0x12, 0x20, ...sha256(utf8(encoded))]))
  const OTHER_RELAY = 'did:peer:2.Vz6MkSomeoneElsesRelay.Ez6LSSomeoneElsesRelay'
  const genuine = `did:peer:4${hashOf(encodedDocument(MEDIATOR_DID))}:${encodedDocument(MEDIATOR_DID)}`
  const swapped = `did:peer:4${hashOf(encodedDocument(MEDIATOR_DID))}:${encodedDocument(OTHER_RELAY)}`
  const credo = () => agentResolving(jest.fn(async (did: string) => didToNumAlgo4DidDocument(did)))

  it('resolves a genuine one through Credo and reaches the relay its document names', async () => {
    await expect(resolveInviter(credo(), genuine)).resolves.toMatchObject({ outcome: 'select', endpoint: MEDIATOR_DID })
  })

  it('is unresolved when the document no longer matches its hash, so the swapped relay is never chosen', async () => {
    await expect(resolveInviter(credo(), swapped)).resolves.toEqual({ outcome: 'unresolved', did: swapped })
  })

  it('(control) read without the hash check, the swapped document would have sent the code to the other relay', () => {
    const bytes = unbase58((swapped.split(':').pop() as string).slice(1))
    const document = JSON.parse(new TextDecoder().decode(bytes.slice(2)))
    expect(chooseInviterService(swapped, document)).toMatchObject({ outcome: 'select', endpoint: OTHER_RELAY })
  })
})
