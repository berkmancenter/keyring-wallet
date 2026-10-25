import { useConnectionById, useBasicMessagesByConnectionId } from '@bifold/react-hooks'
import { DidCommConnectionRecord, DidCommDidExchangeRole, DidCommDidExchangeState } from '@credo-ts/didcomm'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { Alert } from 'react-native'
import { Actions } from 'react-native-gifted-chat'
import Toast from 'react-native-toast-message'

import * as network from '../../src/contexts/network'
import { useChatMessagesByConnection } from '../../src/hooks/chat-messages'
import { pickAndSendPhoto } from '../../src/modules/chat/media/compose'
import { useWitnessConnection } from '../../src/modules/vrc/context/WitnessConnectionProvider'
import Chat from '../../src/screens/Chat'
import { testIdWithKey } from '../../src/utils/testable'
import navigationContext from '../contexts/navigation'
import { BasicAppContext } from '../helpers/app'

jest.mock('@react-navigation/elements', () => ({ useHeaderHeight: jest.fn(() => 100) }))
jest.mock('../../src/hooks/chat-messages', () => ({
  ...jest.requireActual('../../src/hooks/chat-messages'),
  useChatMessagesByConnection: jest.fn(),
}))
jest.mock('../../src/modules/chat/media/compose', () => ({ pickAndSendPhoto: jest.fn(async () => 'sent') }))
jest.mock('../../src/modules/chat/shown', () => ({ chatEventsShown: jest.fn(async () => undefined) }))
jest.mock('../../src/modules/vrc/context/WitnessConnectionProvider', () => ({
  ...jest.requireActual('../../src/modules/vrc/context/WitnessConnectionProvider'),
  useWitnessConnection: jest.fn(() => ({ connectedWitness: undefined })),
}))

const send = pickAndSendPhoto as jest.Mock
const id = (key: string) => testIdWithKey(key)

const connection = new DidCommConnectionRecord({
  id: '1',
  createdAt: new Date(2024, 1, 1),
  state: DidCommDidExchangeState.Completed,
  role: DidCommDidExchangeRole.Requester,
  theirDid: 'did:example:123',
  theirLabel: 'Alice',
})

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

// The composer's "+" (testID ChatActionsButton on its icon). Under jest, gesture-handler's mocked TouchableOpacity
// renders no children, so the icon never appears; it is pressed the way gifted-chat's Actions does on a device.
const openPlus = (tree: ReturnType<typeof render>) =>
  act(() => (tree.UNSAFE_getByType(Actions).props.onPressActionButton as () => void)())

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
  jest.spyOn(Toast, 'show').mockImplementation(() => undefined)
  ;(useChatMessagesByConnection as jest.Mock).mockReturnValue([])
})

describe('the composer’s "+"', () => {
  it('offers Camera and Photo library, and sends the chosen photo on this chat', async () => {
    const tree = renderChat()
    await openPlus(tree)
    expect(tree.getByTestId(id('ChatAttachCamera'))).toBeTruthy()
    await act(async () => fireEvent.press(tree.getByTestId(id('ChatAttachLibrary'))))
    expect(send).toHaveBeenCalledWith(
      expect.anything(),
      '1',
      'library',
      expect.objectContaining({ fallbackText: 'Chat.PhotoFallback' })
    )
    expect(tree.queryByTestId(id('ChatAttachLibrary'))).toBeNull()
    expect(Toast.show).not.toHaveBeenCalled()
  })

  it.each([
    ['photo-too-large', 'Chat.PhotoTooLarge'],
    ['gif-too-large', 'Chat.GifTooLarge'],
    ['no-permission', 'Chat.PhotoNoPermission'],
    ['not-sent', 'Chat.PhotoNotSent'],
  ])('says why when the photo was not sent (%s)', async (outcome, words) => {
    send.mockResolvedValueOnce(outcome)
    const tree = renderChat()
    await openPlus(tree)
    await act(async () => fireEvent.press(tree.getByTestId(id('ChatAttachCamera'))))
    await waitFor(() => expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ text1: words })))
  })

  it('says nothing when the person cancels', async () => {
    send.mockResolvedValueOnce('cancelled')
    const tree = renderChat()
    await openPlus(tree)
    await act(async () => fireEvent.press(tree.getByTestId(id('ChatAttachCamera'))))
    expect(Toast.show).not.toHaveBeenCalled()
  })

  it('asks before a GIF goes as it is: Send GIF sends it, Cancel does not', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    const tree = renderChat()
    await openPlus(tree)
    await act(async () => fireEvent.press(tree.getByTestId(id('ChatAttachLibrary'))))
    const { confirmGif } = send.mock.calls[0][3] as { confirmGif: () => Promise<boolean> }
    const answer = (index: number) => {
      const pending = confirmGif()
      const buttons = alert.mock.calls[alert.mock.calls.length - 1][2] as { onPress: () => void }[]
      buttons[index].onPress()
      return pending
    }
    await expect(answer(1)).resolves.toBe(true)
    await expect(answer(0)).resolves.toBe(false)
    expect(alert.mock.calls[0][0]).toBe('Chat.GifAsIsTitle')
  })

  it('is not offered in the witness’s chat', () => {
    ;(useWitnessConnection as jest.Mock).mockReturnValueOnce({ connectedWitness: { connectionId: '1' } })
    const tree = renderChat()
    expect(tree.UNSAFE_queryByType(Actions)).toBeNull()
  })
})
