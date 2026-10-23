/**
 * Removing a contact reports success only for what it removed. A record that is already gone counts as removed; a
 * store that fails mid-way does not, so the caller (which, for a merged contact, decides from this whether to go on
 * and whether to drop its links) is never told "removed" over a connection or relationship record that survived.
 */
import { RecordNotFoundError } from '@credo-ts/core'
import { act, renderHook } from '@testing-library/react-native'
import { useAgent } from '@bifold/react-hooks'

import { useDeleteContact } from '../../../src/modules/vrc/hooks/useDeleteContact'
import { useOpenIDCredentials } from '../../../src/modules/openid/context/OpenIDCredentialRecordProvider'

jest.mock('@bifold/react-hooks')
jest.mock('../../../src/modules/openid/context/OpenIDCredentialRecordProvider')
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }))

const mockUseAgent = useAgent as jest.MockedFunction<typeof useAgent>
const mockUseOpenIDCredentials = useOpenIDCredentials as jest.MockedFunction<typeof useOpenIDCredentials>

const storeDown = () => new Error('store unavailable')
const gone = () => new RecordNotFoundError('not found', { recordType: 'X' })

describe('useDeleteContact', () => {
  let connections: { getById: jest.Mock; deleteById: jest.Mock }
  let oob: { deleteById: jest.Mock }
  let repository: { findByCounterpartyRelationshipDid: jest.Mock; delete: jest.Mock }

  beforeEach(() => {
    connections = {
      getById: jest.fn(async () => ({ outOfBandId: 'oob-1' })),
      deleteById: jest.fn(async () => undefined),
    }
    oob = { deleteById: jest.fn(async () => undefined) }
    repository = {
      findByCounterpartyRelationshipDid: jest.fn(async () => ({ id: 'rel-1' })),
      delete: jest.fn(async () => undefined),
    }
    mockUseAgent.mockReturnValue({
      agent: {
        context: {},
        modules: { didcomm: { connections, oob } },
        dependencyManager: { resolve: () => repository },
      },
    } as any)
    mockUseOpenIDCredentials.mockReturnValue({
      openIdState: { w3cCredentialRecords: [] },
      removeCredential: jest.fn(async () => undefined),
    } as any)
  })

  const remove = async () => {
    const { result } = renderHook(() => useDeleteContact())
    let removed: boolean | undefined
    await act(async () => {
      removed = await result.current.deleteContact({ issuerId: 'did:peer:alice', connectionId: 'conn-1' })
    })
    return removed
  }

  test('everything removed: success', async () => {
    expect(await remove()).toBe(true)
    expect(connections.deleteById).toHaveBeenCalledWith('conn-1')
    expect(oob.deleteById).toHaveBeenCalledWith('oob-1')
    expect(repository.delete).toHaveBeenCalled()
  })

  test('a connection or invitation already gone still counts as removed', async () => {
    connections.getById.mockRejectedValueOnce(gone())
    expect(await remove()).toBe(true)
    oob.deleteById.mockRejectedValueOnce(gone())
    expect(await remove()).toBe(true)
  })

  test('a store failing while the connection is deleted is a failure, not a success', async () => {
    connections.deleteById.mockRejectedValueOnce(storeDown())
    expect(await remove()).toBe(false)
  })

  test('a store failing while the relationship record is deleted is a failure, not a success', async () => {
    repository.delete.mockRejectedValueOnce(storeDown())
    expect(await remove()).toBe(false)
  })
})
