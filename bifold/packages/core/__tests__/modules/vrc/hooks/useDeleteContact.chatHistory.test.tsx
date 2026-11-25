/**
 * Removing a contact removes its chat history (rich-messaging-plan.md §4.6), through the real hook. A merged contact
 * is removed one relationship at a time (ContactDetails calls deleteContact once per connection), so each
 * connection's history goes with its own call.
 */
import { act, renderHook } from '@testing-library/react-native'

import { useDeleteContact } from '../../../../src/modules/vrc/hooks/useDeleteContact'
import { deleteChatMessages } from '../../../../src/modules/chat/history'

const mockAgent = {
  context: {},
  dependencyManager: { resolve: () => ({ findByCounterpartyRelationshipDid: async () => null }) },
  modules: {
    didcomm: {
      connections: { getById: jest.fn(async (id: string) => ({ id })), deleteById: jest.fn(async () => undefined) },
      oob: { deleteById: jest.fn(async () => undefined) },
    },
  },
}
jest.mock('@bifold/react-hooks', () => ({ useAgent: () => ({ agent: mockAgent }) }))
jest.mock('../../../../src/modules/openid/context/OpenIDCredentialRecordProvider', () => ({
  useOpenIDCredentials: () => ({ openIdState: { w3cCredentialRecords: [] }, removeCredential: jest.fn() }),
}))
jest.mock('react-native-toast-message', () => ({ show: jest.fn() }))
jest.mock('../../../../src/modules/chat/history', () => ({ deleteChatMessages: jest.fn(async () => undefined) }))

describe('removing a contact removes its chat', () => {
  afterEach(() => jest.clearAllMocks())

  test('a merged contact with two relationships loses both chats, each before its connection goes', async () => {
    const { result } = renderHook(() => useDeleteContact())
    const order: string[] = []
    ;(deleteChatMessages as jest.Mock).mockImplementation(async (_agent: unknown, id: string) => {
      order.push(`chat ${id}`)
    })
    mockAgent.modules.didcomm.connections.deleteById.mockImplementation(async (id: string) => {
      order.push(`connection ${id}`)
    })

    let removed: boolean[] = []
    await act(async () => {
      removed = [
        await result.current.deleteContact({ issuerId: 'did:a', connectionId: 'conn-a' }),
        await result.current.deleteContact({ issuerId: 'did:b', connectionId: 'conn-b' }),
      ]
    })

    expect(removed).toEqual([true, true])
    expect(deleteChatMessages).toHaveBeenNthCalledWith(1, mockAgent, 'conn-a')
    expect(deleteChatMessages).toHaveBeenNthCalledWith(2, mockAgent, 'conn-b')
    expect(order).toEqual(['chat conn-a', 'connection conn-a', 'chat conn-b', 'connection conn-b'])
  })

  test('a chat that cannot be deleted makes the removal report failure, and the connection is kept', async () => {
    const { result } = renderHook(() => useDeleteContact())
    ;(deleteChatMessages as jest.Mock).mockRejectedValueOnce(new Error('the store could not be written'))

    let removed = true
    await act(async () => {
      removed = await result.current.deleteContact({ issuerId: 'did:a', connectionId: 'conn-a' })
    })

    expect(removed).toBe(false)
    expect(mockAgent.modules.didcomm.connections.deleteById).not.toHaveBeenCalled()
  })

  test('a contact with no connection has no chat to remove', async () => {
    const { result } = renderHook(() => useDeleteContact())
    await act(async () => {
      await result.current.deleteContact({ issuerId: 'did:a', connectionId: null })
    })
    expect(deleteChatMessages).not.toHaveBeenCalled()
  })
})
