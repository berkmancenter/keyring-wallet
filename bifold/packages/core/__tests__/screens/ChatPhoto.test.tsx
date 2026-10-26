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
    ['not-sent', 'Chat.PhotoNotSent'],
  ])('says why when the photo was not sent (%s)', async (outcome, words) => {
    send.mockResolvedValueOnce(outcome)
    const tree = renderChat()
    await openPlus(tree)
    await act(async () => fireEvent.press(tree.getByTestId(id('ChatAttachCamera'))))
    await waitFor(() => expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ text1: words })))
  })

  it('asks about a missing permission with a way to Settings, not a passing toast', async () => {
    send.mockResolvedValueOnce('no-permission')
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    const tree = renderChat()
    await openPlus(tree)
    await act(async () => fireEvent.press(tree.getByTestId(id('ChatAttachLibrary'))))
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith('Chat.PhotoNoPermissionTitle', 'Chat.PhotoNoPermission', expect.any(Array))
    )
    expect(Toast.show).not.toHaveBeenCalled()
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

// Chat redesign C2: the composer's right-hand button is Camera while the field is empty, Send once it holds text.
describe('the composer (Option A)', () => {
  it('one field: the short placeholder in a pill, and no decorative icon in it', () => {
    const tree = renderChat()
    expect(tree.getByPlaceholderText('Chat.MessagePlaceholder')).toBeTruthy()
    expect(tree.getByTestId(id('ChatComposerField'))).toBeTruthy()
    expect(tree.UNSAFE_queryAllByProps({ name: 'message-text-outline' })).toHaveLength(0)
    // The emoji button stays, inside the field, by its testID (the e2e drivers tap it).
    expect(tree.getByTestId(id('ChatComposerEmojiButton'))).toBeTruthy()
  })

  it('a plain "+" in a full tap target, not the boxed 40-point icon', () => {
    const tree = renderChat()
    const plus = tree.UNSAFE_getByType(Actions)
    // buttonStyle, not wrapperStyle: with an icon of our own, v3 sizes only the touchable (chatActionsProps).
    expect(plus.props.buttonStyle.width).toBeGreaterThanOrEqual(44)
    expect(plus.props.buttonStyle.height).toBeGreaterThanOrEqual(44)
    const icon = render(<>{(plus.props.icon as () => React.ReactElement)()}</>)
    expect(icon.UNSAFE_getByProps({ name: 'plus' }).props.size).toBe(26)
    expect(icon.UNSAFE_queryAllByProps({ name: 'plus-box-outline' })).toHaveLength(0)
  })

  it('empty: Camera, which takes a photo for this chat; Send is not offered', async () => {
    const tree = renderChat()
    expect(tree.queryByTestId('GC_SEND_TOUCHABLE')).toBeNull()
    await act(async () => fireEvent.press(tree.getByTestId(id('ChatComposerCamera'))))
    expect(send).toHaveBeenCalledWith(expect.anything(), '1', 'camera', expect.anything())
  })

  it('with text: Send, and Camera goes (the control above shows Camera)', () => {
    const tree = renderChat()
    fireEvent.changeText(tree.getByPlaceholderText('Chat.MessagePlaceholder'), 'See you at noon')
    // gifted-chat's Send, by its own testID: under jest its mocked touchable renders no children (ours included).
    expect(tree.getByTestId('GC_SEND_TOUCHABLE')).toBeTruthy()
    expect(tree.queryByTestId(id('ChatComposerCamera'))).toBeNull()
  })

  it('offline, Camera is disabled with the field: it takes no photo', async () => {
    ;(network.useNetwork as jest.Mock).mockImplementation(() => ({
      silentAssertConnectedNetwork: () => false,
      assertNetworkConnected: () => false,
      assertInternetReachable: jest.fn(),
      assertMediatorReachable: jest.fn(),
      displayNetInfoModal: jest.fn(),
      hideNetInfoModal: jest.fn(),
    }))
    const tree = renderChat()
    const camera = tree.getByTestId(id('ChatComposerCamera'))
    expect(camera.props.accessibilityState).toEqual({ disabled: true })
    await act(async () => fireEvent.press(camera))
    expect(send).not.toHaveBeenCalled()
  })

  it('a chat that takes no photos (the witness chat) shows Send greyed, never Camera', () => {
    ;(useWitnessConnection as jest.Mock).mockReturnValue({ connectedWitness: { connectionId: '1' } })
    try {
      const tree = renderChat()
      expect(tree.queryByTestId(id('ChatComposerCamera'))).toBeNull()
      expect(tree.getByTestId('GC_SEND_TOUCHABLE')).toBeTruthy()
    } finally {
      ;(useWitnessConnection as jest.Mock).mockReturnValue({ connectedWitness: undefined })
    }
  })
})
