/** Credo's real numalgo-2 expansion of the service spellings the shared-connect flow reads (plan WP2 risk). */
import { didToNumAlgo2DidDocument } from '@credo-ts/core'

import { chooseInviterService } from '../module/sharedConnectInviter'

import { KEYRING_STYLE_DID, MEDIATOR_DID, peer2, REFERENCE_STYLE_DID } from './fixtures/sharedConnectFixtures'

const expand = (did: string) =>
  didToNumAlgo2DidDocument(did).toJSON() as { service?: { id: string; type: string; serviceEndpoint: unknown }[] }

describe('a real numalgo-2 expansion', () => {
  it('keeps TSPTransport and a string endpoint, and abbreviates only DIDCommMessaging', () => {
    const doc = expand(KEYRING_STYLE_DID)
    expect(doc.service?.map((s) => s.type)).toEqual(['DIDCommMessaging', 'TSPTransport'])
    expect(doc.service?.[1].serviceEndpoint).toBe(MEDIATOR_DID)
    expect(chooseInviterService(KEYRING_STYLE_DID, doc as never)).toMatchObject({
      carriage: 'tsp',
      endpoint: MEDIATOR_DID,
    })
  })

  it('keeps the TSP reference spelling, tsp with a {uri} endpoint', () => {
    const doc = expand(REFERENCE_STYLE_DID)
    expect(doc.service?.[0].type).toBe('tsp')
    expect(chooseInviterService(REFERENCE_STYLE_DID, doc as never)).toMatchObject({
      carriage: 'tsp',
      relayHost: 'relay.example.org',
    })
  })

  it('expands a TSP service with an array endpoint', () => {
    const did = peer2([{ t: 'tsp', s: [{ uri: 'https://relay.example.org' }] }])
    expect(chooseInviterService(did, expand(did) as never)).toMatchObject({
      carriage: 'tsp',
      relayHost: 'relay.example.org',
    })
  })
})
