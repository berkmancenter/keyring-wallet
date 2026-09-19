/**
 * Tests that issuing an RCard records which of the user's own profiles was
 * shared with the counterparty (editable-multi-profile-plan §4.3), by
 * exercising the exported issueRCardForAcceptedExchange entrypoint — the
 * profile-recording logic lives inside the non-exported issueRCardCredential
 * it calls.
 */

const testDids = {
  counterpartyConnectionDid: 'did:peer:1zQmZMygzYqNwU6Uhmewx5Xepf2VLp5S4HLSwwgf2aiKZuwa',
  myRelationshipDid: 'did:peer:0z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
  counterpartyRelationshipDid: 'did:peer:0z6MknGc3ocHs3zdPiJbnaaqDi58NGb4pk1Sp9WNhJhvaFed',
}

const relationshipRecord = {
  myRelationshipDid: testDids.myRelationshipDid,
  counterpartyRelationshipDid: testDids.counterpartyRelationshipDid,
  // >= 2 so the RCE-v2 gate (counterpartySpeaksVc20) lets the RCard offer proceed.
  counterpartyRceVersion: 2,
}

const mockRepository = {
  findByConnectionDid: jest.fn().mockResolvedValue(relationshipRecord),
  findByCounterpartyRelationshipDid: jest.fn().mockResolvedValue(relationshipRecord),
  updateSharedProfile: jest.fn().mockResolvedValue(undefined),
}

// issueRCardCredential dedupes per-connection-id via module-level state, so
// each test uses its own connection id to stay independent of the others.
const makeConnection = (id: string) => ({
  id,
  theirDid: testDids.counterpartyConnectionDid,
  outOfBandId: undefined,
})

const mockOfferCredential = jest.fn().mockResolvedValue(undefined)

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

const mockAgent = {
  dependencyManager: {
    resolve: jest.fn().mockReturnValue(mockRepository),
  },
  config: {
    logger: mockLogger,
  },
  context: {},
  modules: {
    didcomm: {
      connections: {
        getById: jest.fn(),
      },
      credentials: {
        offerCredential: mockOfferCredential,
      },
    },
  },
}

jest.mock('../../../src/modules/vrc/repositories/RelationshipDidRepository', () => ({
  RelationshipDidRepository: jest.fn(),
}))

jest.mock('../../../src/modules/vrc/services/rCardCredential', () => ({
  buildRCardCredential: jest.fn(),
  loadRCardTemplate: jest.fn(),
}))

import { issueRCardForAcceptedExchange } from '../../../src/modules/vrc/vrc-manager'
import { buildRCardCredential, loadRCardTemplate } from '../../../src/modules/vrc/services/rCardCredential'

const mockBuildRCardCredential = buildRCardCredential as jest.Mock
const mockLoadRCardTemplate = loadRCardTemplate as jest.Mock

describe('issueRCardCredential — shared-profile recording', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRepository.findByConnectionDid.mockResolvedValue(relationshipRecord)
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(relationshipRecord)
    mockRepository.updateSharedProfile.mockResolvedValue(undefined)
    mockAgent.dependencyManager.resolve.mockReturnValue(mockRepository)
    mockOfferCredential.mockResolvedValue(undefined)
    mockBuildRCardCredential.mockResolvedValue({ mockCredential: true })
    mockLoadRCardTemplate.mockResolvedValue({ id: 'profile-123', label: 'Work', jcard: ['vcard', []] })
  })

  it('records the active profile as shared with the counterparty after a successful offer', async () => {
    const connection = makeConnection('connection-1')
    mockAgent.modules.didcomm.connections.getById.mockResolvedValue(connection)

    await issueRCardForAcceptedExchange(mockAgent as any, connection.id)

    expect(mockOfferCredential).toHaveBeenCalled()
    expect(mockRepository.updateSharedProfile).toHaveBeenCalledWith(
      mockAgent.context,
      testDids.counterpartyConnectionDid,
      'profile-123',
      'Work'
    )
  })

  it('does not record a shared profile when no R-Card template exists', async () => {
    const connection = makeConnection('connection-2')
    mockAgent.modules.didcomm.connections.getById.mockResolvedValue(connection)
    mockBuildRCardCredential.mockResolvedValue(undefined)

    await issueRCardForAcceptedExchange(mockAgent as any, connection.id)

    expect(mockOfferCredential).not.toHaveBeenCalled()
    expect(mockRepository.updateSharedProfile).not.toHaveBeenCalled()
  })

  it('does not record a shared profile when the offer itself fails', async () => {
    const connection = makeConnection('connection-3')
    mockAgent.modules.didcomm.connections.getById.mockResolvedValue(connection)
    mockOfferCredential.mockRejectedValue(new Error('network error'))

    await expect(issueRCardForAcceptedExchange(mockAgent as any, connection.id)).rejects.toThrow('network error')

    expect(mockRepository.updateSharedProfile).not.toHaveBeenCalled()
  })

  it('does not throw when recording the shared profile fails — the offer already went out', async () => {
    const connection = makeConnection('connection-4')
    mockAgent.modules.didcomm.connections.getById.mockResolvedValue(connection)
    mockRepository.updateSharedProfile.mockRejectedValue(new Error('storage error'))

    await expect(issueRCardForAcceptedExchange(mockAgent as any, connection.id)).resolves.toBeUndefined()

    expect(mockOfferCredential).toHaveBeenCalled()
  })
})
