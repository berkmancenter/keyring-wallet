/**
 * A continuity question ("Is this you?") waiting in a chat counts as one unread there until it is answered, so the
 * Messages badge and the chat row show it; a connection left out of notifications stays out.
 */
import { act, renderHook } from '@testing-library/react-native'
import { useBasicMessages } from '@bifold/react-hooks'

import {
  addExcludedNotificationConnectionId,
  removeExcludedNotificationConnectionId,
} from '../../src/hooks/notifications'
import { useUnreadMessages } from '../../src/hooks/useUnreadMessages'
import { continuityPromptStore, resetContinuityLimits } from '../../src/modules/vrc/contacts/continuity'

jest.mock('@bifold/react-hooks')
const mockUseBasicMessages = useBasicMessages as jest.MockedFunction<typeof useBasicMessages>

const promptOn = (connectionId: string) => ({
  connectionId,
  asker: 'Bob Jones',
  earlier: 'Bob J.',
  request: {},
  challenge: 'abc',
  receivedAt: new Date().toISOString(),
})

describe('unread chat with a continuity question waiting', () => {
  beforeEach(() => {
    resetContinuityLimits()
    mockUseBasicMessages.mockReturnValue({ records: [] } as any)
  })
  afterEach(() => removeExcludedNotificationConnectionId('conn-quiet'))

  test('counts as one unread on its connection while it waits, and none once answered', () => {
    const { result } = renderHook(() => useUnreadMessages())
    expect(result.current.totalUnread).toBe(0)
    act(() => continuityPromptStore.set(promptOn('conn-new')))
    expect(result.current.unreadByConnection).toEqual({ 'conn-new': 1 })
    expect(result.current.totalUnread).toBe(1)
    act(() => {
      continuityPromptStore.take('conn-new')
    })
    expect(result.current.totalUnread).toBe(0)
  })

  test('a connection left out of notifications is not counted', () => {
    addExcludedNotificationConnectionId('conn-quiet')
    const { result } = renderHook(() => useUnreadMessages())
    act(() => {
      continuityPromptStore.set(promptOn('conn-quiet'))
      continuityPromptStore.set(promptOn('conn-new'))
    })
    // conn-new is the positive control: counting works, and only the excluded connection is left out.
    expect(result.current.unreadByConnection).toEqual({ 'conn-new': 1 })
  })
})
