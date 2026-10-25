import { useAgent, useBasicMessagesByConnectionId, useConnectionById } from '@bifold/react-hooks'
import {
  DidCommBasicMessageRecord,
  DidCommBasicMessageRole,
  DidCommConnectionRecord,
  DidCommDidExchangeRole,
  DidCommDidExchangeState,
} from '@credo-ts/didcomm'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import * as network from '../../src/contexts/network'
import { FLOW_TIMEOUT_MS_NON_WITNESSED } from '../../src/hooks/chat-messages'
import { vrcFlowStore } from '../../src/modules/vrc/witnessStatusStore'
import Chat from '../../src/screens/Chat'
import { BasicMessageMetadata } from '../../src/types/metadata'
import { hasOtaApplyBlockers, otaApplyBlockerReasons } from '../../src/utils/otaApply'
import navigationContext from '../contexts/navigation'
import { BasicAppContext } from '../helpers/app'

jest.mock('@react-navigation/elements', () => ({
  useHeaderHeight: jest.fn(() => 100),
}))

const props = { params: { connectionId: '1' } }

const connection = new DidCommConnectionRecord({
  id: '1',
  createdAt: new Date(2024, 1, 1),
  state: DidCommDidExchangeState.Completed,
  role: DidCommDidExchangeRole.Requester,
  theirDid: 'did:example:123',
  theirLabel: 'Alice',
})

const unseenMessage = new DidCommBasicMessageRecord({
  threadId: '1',
  connectionId: '1',
  role: DidCommBasicMessageRole.Receiver,
  content: 'Hello',
  sentTime: '20200303',
})

unseenMessage.metadata = {
  get: jest.fn().mockReturnValue(undefined),
  set: jest.fn(),
  add: jest.fn(),
  delete: jest.fn(),
  keys: [BasicMessageMetadata.customMetadata],
  data: {
    [BasicMessageMetadata.customMetadata]: {
      seen: false,
    },
  },
}

const seenMessage = new DidCommBasicMessageRecord({
  threadId: '2',
  connectionId: '1',
  role: DidCommBasicMessageRole.Receiver,
  content: 'Hi',
  sentTime: '20200303',
})

seenMessage.metadata = {
  get: jest.fn().mockReturnValue({ seen: true }),
  set: jest.fn(),
  add: jest.fn(),
  delete: jest.fn(),
  keys: [BasicMessageMetadata.customMetadata],
  data: {
    [BasicMessageMetadata.customMetadata]: {
      seen: true,
    },
  },
}

const testBasicMessages: DidCommBasicMessageRecord[] = [unseenMessage, seenMessage]

describe('Chat Screen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // @ts-expect-error useConnectionById will be replaced with a mock which will have this method
    useConnectionById.mockReturnValue(connection)
    // @ts-expect-error useBasicMessagesByConnectionId will be replaced with a mock which will have this method
    useBasicMessagesByConnectionId.mockReturnValue(testBasicMessages)
  })

  test('Renders correctly', async () => {
    jest.spyOn(network, 'useNetwork').mockImplementation(() => ({
      silentAssertConnectedNetwork: () => true,
      assertNetworkConnected: () => true,
      assertInternetReachable: jest.fn(),
      assertMediatorReachable: jest.fn(),
      displayNetInfoModal: jest.fn(),
      hideNetInfoModal: jest.fn(),
    }))
    const element = (
      <BasicAppContext>
        <Chat navigation={navigationContext} route={props as any} />
      </BasicAppContext>
    )
    const tree = render(element)

    expect(tree).toMatchSnapshot()
  })
})

describe('Chat screen with messages', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // @ts-expect-error useConnectionById will be replaced with a mock which will have this method
    useConnectionById.mockReturnValue(connection)
    // @ts-expect-error useBasicMessagesByConnectionId will be replaced with a mock which will have this method
    useBasicMessagesByConnectionId.mockReturnValue(testBasicMessages)
    jest.spyOn(network, 'useNetwork').mockImplementation(() => ({
      silentAssertConnectedNetwork: () => true,
      assertNetworkConnected: () => true,
      assertInternetReachable: jest.fn(),
      assertMediatorReachable: jest.fn(),
      displayNetInfoModal: jest.fn(),
      hideNetInfoModal: jest.fn(),
    }))
  })

  test('Marks messages as seen', async () => {
    render(
      <BasicAppContext>
        <Chat navigation={navigationContext} route={props as any} />
      </BasicAppContext>
    )

    expect(unseenMessage.metadata.set).toBeCalled()
    expect(seenMessage.metadata.set).not.toBeCalled()
  })
})

describe('Chat screen while an exchange waits on the other phone', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    vrcFlowStore.clearFlow('1')
    // @ts-expect-error useConnectionById will be replaced with a mock which will have this method
    useConnectionById.mockReturnValue(connection)
    // @ts-expect-error useBasicMessagesByConnectionId will be replaced with a mock which will have this method
    useBasicMessagesByConnectionId.mockReturnValue(testBasicMessages)
    jest.spyOn(network, 'useNetwork').mockImplementation(() => ({
      silentAssertConnectedNetwork: () => true,
      assertNetworkConnected: () => true,
      assertInternetReachable: jest.fn(),
      assertMediatorReachable: jest.fn(),
      displayNetInfoModal: jest.fn(),
      hideNetInfoModal: jest.fn(),
    }))
  })

  afterEach(() => {
    vrcFlowStore.clearFlow('1')
    jest.useRealTimers()
  })

  test('says who it is waiting for, never that the exchange failed, and can be dismissed', () => {
    const tree = render(
      <BasicAppContext>
        <Chat navigation={navigationContext} route={props as any} />
      </BasicAppContext>
    )

    act(() => {
      vrcFlowStore.setStatus('1', 'proposed', false)
    })
    expect(tree.getByText('Waiting for your contact to accept...')).toBeTruthy()

    act(() => {
      jest.advanceTimersByTime(FLOW_TIMEOUT_MS_NON_WITNESSED)
    })
    // Translations render as their keys here.
    expect(tree.getByText('Relationship.WaitingForAnswer')).toBeTruthy()
    expect(tree.queryByText(/didn't complete/)).toBeNull()

    fireEvent.press(tree.getByText('Global.Dismiss'))
    expect(tree.queryByText('Relationship.WaitingForAnswer')).toBeNull()
    expect(vrcFlowStore.getStatus('1')).toBe('proposed')
  })
})

describe('Chat screen draft and over-the-air updates', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // @ts-expect-error useConnectionById will be replaced with a mock which will have this method
    useConnectionById.mockReturnValue(connection)
    // @ts-expect-error useBasicMessagesByConnectionId will be replaced with a mock which will have this method
    useBasicMessagesByConnectionId.mockReturnValue(testBasicMessages)
    jest.spyOn(network, 'useNetwork').mockImplementation(() => ({
      silentAssertConnectedNetwork: () => true,
      assertNetworkConnected: () => true,
      assertInternetReachable: jest.fn(),
      assertMediatorReachable: jest.fn(),
      displayNetInfoModal: jest.fn(),
      hideNetInfoModal: jest.fn(),
    }))
  })

  // gifted-chat renders its composer only after its first layout with a height.
  const renderWithComposer = () => {
    const tree = render(
      <BasicAppContext>
        <Chat navigation={navigationContext} route={props as any} />
      </BasicAppContext>
    )
    fireEvent(tree.getByTestId('GC_WRAPPER'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } },
    })
    return tree
  }

  test('blocks applying an update while a draft is unsent, and not otherwise', () => {
    const tree = renderWithComposer()
    const input = tree.getByPlaceholderText('Contacts.TypeHere')
    expect(hasOtaApplyBlockers()).toBe(false)

    fireEvent.changeText(input, '   ')
    expect(hasOtaApplyBlockers()).toBe(false)

    fireEvent.changeText(input, 'See you at')
    expect(otaApplyBlockerReasons()).toEqual(['chat-draft'])

    fireEvent.changeText(input, '')
    expect(hasOtaApplyBlockers()).toBe(false)
  })

  test('releases the block when the draft is sent', async () => {
    const basicMessages = (useAgent as jest.Mock)().agent.modules.didcomm.basicMessages
    const original = basicMessages.sendMessage
    basicMessages.sendMessage = jest.fn(async () => undefined)
    try {
      const tree = renderWithComposer()
      fireEvent.changeText(tree.getByPlaceholderText('Contacts.TypeHere'), 'See you at noon')
      expect(otaApplyBlockerReasons()).toEqual(['chat-draft'])

      fireEvent.press(tree.getByTestId('GC_SEND_TOUCHABLE'))
      expect(hasOtaApplyBlockers()).toBe(false)
      // A contact without chat gets a plain BasicMessage (sendChatText decides, after reading its capability).
      await waitFor(() => expect(basicMessages.sendMessage).toHaveBeenCalledWith('1', 'See you at noon'))
    } finally {
      basicMessages.sendMessage = original
    }
  })

  test('releases the block when the screen closes', () => {
    const tree = renderWithComposer()
    fireEvent.changeText(tree.getByPlaceholderText('Contacts.TypeHere'), 'See you at noon')
    expect(hasOtaApplyBlockers()).toBe(true)

    tree.unmount()
    expect(hasOtaApplyBlockers()).toBe(false)
  })
})
