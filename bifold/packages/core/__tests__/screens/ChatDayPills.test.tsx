/**
 * The chat's day markers, as the screen draws them: exactly one pill above each day's first message, whatever kind
 * of message that is, and none beside it. A simulator run on C1 found every day drawn twice: gifted-chat calls
 * renderDay above each day itself, and the chat's messages drew a second pill of their own.
 */
import { useBasicMessagesByConnectionId, useConnectionById } from '@bifold/react-hooks'
import { DidCommConnectionRecord, DidCommDidExchangeRole, DidCommDidExchangeState } from '@credo-ts/didcomm'
import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { Text } from 'react-native'

import { ChatIds } from '../../src/components/chat/Chat.ids'
import type { ExtendedChatMessage } from '../../src/components/chat/ChatMessage'
import * as network from '../../src/contexts/network'
import { useChatMessagesByConnection } from '../../src/hooks/chat-messages'
import Chat from '../../src/screens/Chat'
import { Role } from '../../src/types/chat'
import { testIdWithKey } from '../../src/utils/testable'
import navigationContext from '../contexts/navigation'
import { BasicAppContext } from '../helpers/app'

jest.mock('@react-navigation/elements', () => ({ useHeaderHeight: jest.fn(() => 100) }))
jest.mock('../../src/hooks/chat-messages', () => ({
  ...jest.requireActual('../../src/hooks/chat-messages'),
  useChatMessagesByConnection: jest.fn(),
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

const message = (id: string, at: Date, overrides: Partial<ExtendedChatMessage> = {}): ExtendedChatMessage => ({
  _id: id,
  text: id,
  createdAt: at,
  user: { _id: Role.them },
  renderEvent: () => <Text>{id}</Text>,
  ...overrides,
})

const pills = (messages: ExtendedChatMessage[]) => {
  ;(useChatMessagesByConnection as jest.Mock).mockReturnValue(messages)
  const tree = render(
    <BasicAppContext>
      <Chat navigation={navigationContext} route={{ params: { connectionId: '1' } } as never} />
    </BasicAppContext>
  )
  fireEvent(tree.getByTestId('GC_WRAPPER'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } },
  })
  return tree.queryAllByTestId(testIdWithKey(ChatIds.dayPill))
}

beforeEach(() => {
  jest.clearAllMocks()
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
})

describe('the day markers', () => {
  // Newest first, as gifted-chat lists them.
  const oct15a = new Date(2026, 9, 15, 9, 0)
  const oct15b = new Date(2026, 9, 15, 16, 1)
  const oct16 = new Date(2026, 9, 16, 9, 0)

  test('two days: exactly two pills, one per day', () => {
    expect(pills([message('c', oct16), message('b', oct15b), message('a', oct15a)])).toHaveLength(2)
  })

  test('one day: exactly one pill (the control above shows two)', () => {
    expect(pills([message('b', oct15b), message('a', oct15a)])).toHaveLength(1)
  })

  test('a line about the chat itself that starts a day gets the day’s pill too', () => {
    expect(pills([message('timer', oct16, { kind: 'system' }), message('a', oct15a)])).toHaveLength(2)
  })
})
