import { useAgent, useBasicMessagesByConnectionId, useConnectionById } from '@bifold/react-hooks'
import { DidCommConnectionRecord, DidCommDidExchangeRole, DidCommDidExchangeState } from '@credo-ts/didcomm'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { AppState } from 'react-native'

import * as network from '../../src/contexts/network'
import { useChatMessagesByConnection } from '../../src/hooks/chat-messages'
import Chat from '../../src/screens/Chat'
import { otaApplyBlockerReasons } from '../../src/utils/otaApply'
import navigationContext from '../contexts/navigation'
import { BasicAppContext } from '../helpers/app'

jest.mock('@react-navigation/elements', () => ({ useHeaderHeight: jest.fn(() => 100) }))
jest.mock('../../src/hooks/chat-messages', () => ({
  ...jest.requireActual('../../src/hooks/chat-messages'),
  useChatMessagesByConnection: jest.fn(),
}))
jest.mock('../../src/modules/chat/send', () => ({
  sendChatText: jest.fn(async () => ({ carriedAs: 'chat' })),
}))
jest.mock('../../src/modules/chat/shown', () => ({ chatEventsShown: jest.fn(async () => undefined) }))

const connection = new DidCommConnectionRecord({
  id: '1',
  createdAt: new Date(2024, 1, 1),
  state: DidCommDidExchangeState.Completed,
  role: DidCommDidExchangeRole.Requester,
  theirDid: 'did:example:123',
  theirLabel: 'Alice',
})

type Kept = { id: string; content: { text?: unknown } }
// The mocked agent's generic records, kept in memory for each test.
const kept = new Map<string, Kept>()
const agent = (useAgent as jest.Mock)().agent as {
  genericRecords: Record<'findById' | 'save' | 'update' | 'delete', jest.Mock>
  config: { logger: { warn: jest.Mock } }
}
const records = agent.genericRecords

const renderChat = () => {
  const tree = render(
    <BasicAppContext>
      <Chat navigation={navigationContext} route={{ params: { connectionId: '1' } } as never} />
    </BasicAppContext>
  )
  fireEvent(tree.getByTestId('GC_WRAPPER'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } },
  })
  return tree
}
const field = (tree: ReturnType<typeof render>) => tree.getByPlaceholderText('Contacts.TypeHere')

beforeEach(() => {
  jest.clearAllMocks()
  kept.clear()
  records.findById.mockImplementation(async (id: string) => kept.get(id) ?? null)
  records.save.mockImplementation(async (record: Kept) => void kept.set(record.id, record))
  records.update.mockImplementation(async (record: Kept) => void kept.set(record.id, record))
  records.delete.mockImplementation(async (record: Kept) => void kept.delete(record.id))
  // @ts-expect-error useConnectionById will be replaced with a mock which will have this method
  useConnectionById.mockReturnValue(connection)
  // @ts-expect-error useBasicMessagesByConnectionId will be replaced with a mock which will have this method
  useBasicMessagesByConnectionId.mockReturnValue([])
  jest.spyOn(network, 'useNetwork').mockImplementation(() => ({
    silentAssertConnectedNetwork: () => true,
    assertNetworkConnected: () => true,
    assertInternetReachable: jest.fn(),
    assertMediatorReachable: jest.fn(),
    displayNetInfoModal: jest.fn(),
    hideNetInfoModal: jest.fn(),
  }))
  ;(useChatMessagesByConnection as jest.Mock).mockReturnValue([])
})

afterAll(() => {
  // Back to the shared mock's quiet store for whatever runs next in this worker.
  records.findById.mockImplementation(async () => null)
  for (const write of [records.save, records.update, records.delete]) write.mockImplementation(async () => undefined)
})

// Unlocking after the app locked resets navigation, and the draft lived only in gifted-chat's state (271, 272).
describe('an unsent draft outlives the chat screen', () => {
  it('is back in the composer when the chat opens again, and counts as a draft', async () => {
    kept.set('chat-draft:1', { id: 'chat-draft:1', content: { text: 'half a thought' } })
    const tree = renderChat()

    await waitFor(() => expect(field(tree).props.value).toBe('half a thought'))
    expect(otaApplyBlockerReasons()).toContain('chat-draft')
  })

  it('is kept shortly after typing pauses', async () => {
    const tree = renderChat()
    fireEvent.changeText(field(tree), 'see you at no')

    await waitFor(() => expect(kept.get('chat-draft:1')?.content.text).toBe('see you at no'), { timeout: 2000 })
  })

  it('never replaces what was typed before the kept draft was read', async () => {
    kept.set('chat-draft:1', { id: 'chat-draft:1', content: { text: 'old draft' } })
    let read: () => void = () => undefined
    records.findById.mockImplementationOnce(
      (id: string) => new Promise((resolve) => (read = () => resolve(kept.get(id) ?? null)))
    )
    const tree = renderChat()
    fireEvent.changeText(field(tree), 'new words')
    // The read is asked for only once the chat's turn comes (draft.ts); answering before then would answer nothing.
    await waitFor(() => expect(records.findById).toHaveBeenCalled())

    await act(async () => read())

    expect(field(tree).props.value).toBe('new words')
  })

  it('is forgotten once it is sent', async () => {
    const tree = renderChat()
    fireEvent.changeText(field(tree), 'see you at noon')
    await waitFor(() => expect(kept.has('chat-draft:1')).toBe(true), { timeout: 2000 })

    await act(async () => fireEvent.press(tree.getByTestId('GC_SEND_TOUCHABLE')))

    await waitFor(() => expect(kept.has('chat-draft:1')).toBe(false), { timeout: 2000 })
  })

  // The app locks only after a while away, and locking shuts the agent down as it unmounts the screen, so the save
  // that counts is the one made on leaving the app.
  it('is kept at once when the app leaves the foreground, without waiting for typing to pause', async () => {
    const listeners: ((state: string) => void)[] = []
    // addEventListener is already react-native's jest.fn: spyOn hands back that same mock, and mockRestore would leave
    // it returning nothing, so its own implementation is put back instead.
    const addListener = AppState.addEventListener as jest.Mock
    const original = addListener.getMockImplementation()
    addListener.mockImplementation((_type: string, listener: unknown) => {
      listeners.push(listener as (state: string) => void)
      return { remove: jest.fn() } as never
    })
    const tree = renderChat()
    fireEvent.changeText(field(tree), 'leaving now')

    await act(async () => listeners.forEach((listener) => listener('background')))

    // Sooner than typing's pause (DRAFT_SAVE_DELAY_MS, 400 ms) would have saved it.
    await waitFor(() => expect(kept.get('chat-draft:1')?.content.text).toBe('leaving now'), { timeout: 250 })
    // Back in the foreground: other listeners on this screen keep app state of their own past this test.
    await act(async () => listeners.forEach((listener) => listener('active')))
    addListener.mockImplementation(original)
  })

  it('is logged, never thrown, when the store is already closed as the screen goes', async () => {
    records.save.mockRejectedValue(new Error('the store is closed'))
    const tree = renderChat()
    fireEvent.changeText(field(tree), 'last words')

    tree.unmount()

    await waitFor(() =>
      expect(agent.config.logger.warn).toHaveBeenCalledWith(
        '[Chat:draft] the draft for 1 was not saved',
        expect.anything()
      )
    )
  })
})
