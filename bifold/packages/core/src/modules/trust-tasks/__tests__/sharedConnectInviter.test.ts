/** Resolving the inviter's `_from` and choosing a carriage (plan WP2), against fake documents and a fake agent. */
import type { Agent } from '@credo-ts/core'

import { chooseInviterService, resolveInviter } from '../module/sharedConnectInviter'

import { KEYRING_STYLE_DID, MEDIATOR_DID } from './fixtures/sharedConnectFixtures'

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
