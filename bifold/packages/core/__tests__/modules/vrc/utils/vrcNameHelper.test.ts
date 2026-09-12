import { Agent, W3cCredentialRecord } from '@credo-ts/core'

import {
  getContactCredentialDetailsForConnection,
  getVrcNameForConnection,
} from '../../../../src/modules/vrc/utils/vrcNameHelper'
import { RelationshipDidRepository } from '../../../../src/modules/vrc/repositories/RelationshipDidRepository'
import { createDTGCredential, TEST_CONTACTS, generateTestDid } from '../../../../src/modules/vrc/fixtures/testContacts'

describe('getContactCredentialDetailsForConnection', () => {
  const CONNECTION_ID = 'connection-1'

  const buildAgent = (
    relationshipRecords: Array<{ connectionId: string; counterpartyRelationshipDid: string }>
  ): Agent => {
    const repository = { getAll: jest.fn().mockResolvedValue(relationshipRecords) }
    return {
      context: {},
      dependencyManager: {
        resolve: jest.fn((token) => (token === RelationshipDidRepository ? repository : undefined)),
      },
    } as unknown as Agent
  }

  it('returns null when this connection has no relationship DID on file', async () => {
    const agent = buildAgent([])

    const result = await getContactCredentialDetailsForConnection(agent, CONNECTION_ID, [])

    expect(result).toBeNull()
  })

  it('resolves the contact from the RCard issuer once a relationship exists', async () => {
    const alice = TEST_CONTACTS.alice
    const agent = buildAgent([{ connectionId: CONNECTION_ID, counterpartyRelationshipDid: alice.issuer.id }])
    const credential = createDTGCredential({ issuer: alice.issuer, credentialSubject: { id: 'did:peer:holder' } })

    const result = await getContactCredentialDetailsForConnection(agent, CONNECTION_ID, [credential])

    expect(result).toEqual({
      issuer: {
        id: alice.issuer.id,
        name: alice.issuer.name,
        email: alice.issuer.email,
        organization: alice.issuer.organization,
        photo: undefined,
      },
      hasWitnessCredentials: false,
      hasHardwareAttestation: false,
    })
  })

  it('falls back to a truncated-DID name when no credential names this issuer', async () => {
    const issuerId = generateTestDid('unnamed')
    const agent = buildAgent([{ connectionId: CONNECTION_ID, counterpartyRelationshipDid: issuerId }])

    const result = await getContactCredentialDetailsForConnection(agent, CONNECTION_ID, [])

    expect(result?.issuer.name).toBe(`Unknown ...${issuerId.slice(-8)}`)
  })

  it('only matches the requested connection, not any relationship on file', async () => {
    const alice = TEST_CONTACTS.alice
    const agent = buildAgent([{ connectionId: 'some-other-connection', counterpartyRelationshipDid: alice.issuer.id }])

    const result = await getContactCredentialDetailsForConnection(agent, CONNECTION_ID, [])

    expect(result).toBeNull()
  })
})

describe('getVrcNameForConnection', () => {
  const CONNECTION_ID = 'connection-1'

  it('returns null without an agent or connectionId', async () => {
    expect(await getVrcNameForConnection(undefined, CONNECTION_ID, [])).toBeNull()
    expect(await getVrcNameForConnection({} as Agent, undefined, [])).toBeNull()
  })

  it('resolves the RCard issuer name for an established relationship', async () => {
    const alice = TEST_CONTACTS.alice
    const repository = {
      getAll: jest
        .fn()
        .mockResolvedValue([{ connectionId: CONNECTION_ID, counterpartyRelationshipDid: alice.issuer.id }]),
    }
    const agent = {
      dependencyManager: { resolve: jest.fn(() => repository) },
    } as unknown as Agent
    const credential = createDTGCredential({ issuer: alice.issuer, credentialSubject: { id: 'did:peer:holder' } })

    const name = await getVrcNameForConnection(agent, CONNECTION_ID, [credential] as W3cCredentialRecord[])

    expect(name).toBe(alice.issuer.name)
  })

  it('returns null when the repository lookup throws', async () => {
    const agent = {
      dependencyManager: {
        resolve: jest.fn(() => {
          throw new Error('resolution failed')
        }),
      },
    } as unknown as Agent

    expect(await getVrcNameForConnection(agent, CONNECTION_ID, [])).toBeNull()
  })
})
