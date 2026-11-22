/**
 * "Confirm with <name>" in a 1:1 chat's "+" sheet (Confirm it's you, 278.17): offered last, only with its switch on, no
 * remote off, and a relationship to ask over; it opens the same note form as the contact page, in a sheet. The other
 * entries keep their order and testIDs.
 */
import { useAgent, useBasicMessagesByConnectionId, useConnectionById } from '@bifold/react-hooks'
import { DidCommConnectionRecord, DidCommDidExchangeRole, DidCommDidExchangeState } from '@credo-ts/didcomm'
import { act, fireEvent, render, userEvent } from '@testing-library/react-native'
import React from 'react'
import { Actions } from 'react-native-gifted-chat'
import Toast from 'react-native-toast-message'

import * as network from '../../src/contexts/network'
import { useChatMessagesByConnection } from '../../src/hooks/chat-messages'
import ConfirmWithSheet, { ConfirmWithSheetIds } from '../../src/modules/trust-tasks/components/ConfirmWithSheet'
import * as confirmItsYou from '../../src/modules/trust-tasks/confirmItsYou'
import {
  CONFIRM_ITS_YOU_REMOTE_OFF,
  setConfirmItsYouEnabled,
} from '../../src/modules/trust-tasks/module/confirmItsYouFlag'
import { SEDI_KERI_REMOTE_OFF } from '../../src/modules/trust-tasks/module/sediKeriRemoteOff'
import { ConfirmItsYouRowIds } from '../../src/modules/trust-tasks/screens/ConfirmItsYouRow'
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

const id = (key: string) => testIdWithKey(key)
const AGENT = { config: {} } as never

const connection = new DidCommConnectionRecord({
  id: '1',
  createdAt: new Date(2024, 1, 1),
  state: DidCommDidExchangeState.Completed,
  role: DidCommDidExchangeRole.Requester,
  theirDid: 'did:example:123',
  theirLabel: 'Alice',
})

const renderChat = async () => {
  const tree = render(
    <BasicAppContext>
      <Chat navigation={navigationContext} route={{ params: { connectionId: '1' } } as never} />
    </BasicAppContext>
  )
  fireEvent(tree.getByTestId('GC_WRAPPER'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } },
  })
  await act(async () => undefined)
  return tree
}
const openPlus = (tree: Awaited<ReturnType<typeof renderChat>>) =>
  act(() => (tree.UNSAFE_getByType(Actions).props.onPressActionButton as () => void)())
const ENTRY = new RegExp(`^${testIdWithKey('')}Chat(Attach|ConfirmWith)`)
const entryIds = (tree: Awaited<ReturnType<typeof renderChat>>) =>
  tree.queryAllByTestId(ENTRY).map((node) => String(node.props.testID).slice(testIdWithKey('').length))

let can: jest.SpyInstance
beforeEach(() => {
  jest.clearAllMocks()
  // @ts-expect-error mocked
  useConnectionById.mockReturnValue(connection)
  // @ts-expect-error mocked
  useBasicMessagesByConnectionId.mockReturnValue([])
  ;(useAgent as jest.Mock).mockReturnValue({ agent: AGENT })
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
  CONFIRM_ITS_YOU_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
  setConfirmItsYouEnabled(true)
  can = jest.spyOn(confirmItsYou, 'canConfirmWith').mockResolvedValue(true)
  jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([])
})
afterEach(() => {
  can.mockRestore()
  CONFIRM_ITS_YOU_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
})
afterAll(() => setConfirmItsYouEnabled(false))

describe('"Confirm with <name>" in the chat\'s "+"', () => {
  test('on, with a relationship: offered LAST, the other entries unchanged; one tap opens the note form in a sheet', async () => {
    const send = jest.spyOn(confirmItsYou, 'sendConfirmRequest').mockResolvedValue('sent')
    const tree = await renderChat()
    expect(can).toHaveBeenCalledWith(AGENT, '1')
    await openPlus(tree)
    expect(entryIds(tree)).toEqual(['ChatAttachCamera', 'ChatAttachLibrary', 'ChatConfirmWith'])
    expect(tree.getByText('ConfirmItsYou.Title')).toBeTruthy()

    const user = userEvent.setup()
    await user.press(tree.getByTestId(id('ChatConfirmWith')))
    expect(tree.queryByTestId(id('ChatAttachCamera'))).toBeNull()
    expect(tree.getByTestId(id(ConfirmWithSheetIds.sheet))).toBeTruthy()
    // The same form as the contact page: the note field and Send, for this chat's connection.
    await user.type(tree.getByTestId(id(ConfirmItsYouRowIds.note)), 'Is this really you?')
    await user.press(tree.getByTestId(id(ConfirmItsYouRowIds.send)))
    expect(send).toHaveBeenCalledWith(AGENT, '1', 'Is this really you?')

    await user.press(tree.getByTestId(id(ConfirmWithSheetIds.close)))
    expect(tree.queryByTestId(id(ConfirmWithSheetIds.sheet))).toBeNull()
  })

  test.each([
    ['the switch off', () => setConfirmItsYouEnabled(false)],
    ['its remote off', () => (CONFIRM_ITS_YOU_REMOTE_OFF.off = true)],
    ['the SEDI/KERI umbrella off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
  ])('%s: not offered, nothing read, and the other entries unchanged (control: on, above)', async (_name, off) => {
    off()
    const send = jest.spyOn(confirmItsYou, 'sendConfirmRequest')
    const tree = await renderChat()
    await openPlus(tree)
    expect(entryIds(tree)).toEqual(['ChatAttachCamera', 'ChatAttachLibrary'])
    expect(can).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  test('on, with no relationship to ask over: not offered', async () => {
    can.mockResolvedValue(false)
    const tree = await renderChat()
    await openPlus(tree)
    expect(entryIds(tree)).toEqual(['ChatAttachCamera', 'ChatAttachLibrary'])
  })

  test('the witness\'s chat: no "+" at all, and nothing read', async () => {
    ;(useWitnessConnection as jest.Mock).mockReturnValue({ connectedWitness: { connectionId: '1' } })
    try {
      const tree = await renderChat()
      expect(tree.UNSAFE_queryByType(Actions)).toBeNull()
      expect(can).not.toHaveBeenCalled()
    } finally {
      ;(useWitnessConnection as jest.Mock).mockReturnValue({ connectedWitness: undefined })
    }
  })
})

describe('the sheet itself carries the gate', () => {
  const sheet = (connectionId: string | null = '1') =>
    render(
      <BasicAppContext>
        <ConfirmWithSheet connectionId={connectionId} name="Alice" visible onClose={jest.fn()} />
      </BasicAppContext>
    )

  test('opened by a parent with the switch on: it shows (control for the rows below)', async () => {
    const tree = sheet()
    await act(async () => undefined)
    expect(tree.getByTestId(id(ConfirmWithSheetIds.sheet))).toBeTruthy()
    expect(tree.getByTestId(id(ConfirmItsYouRowIds.note))).toBeTruthy()
  })

  test.each([
    ['the switch off', () => setConfirmItsYouEnabled(false)],
    ['its remote off', () => (CONFIRM_ITS_YOU_REMOTE_OFF.off = true)],
    ['the SEDI/KERI umbrella off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
  ])('%s: opened by a parent anyway, it shows nothing and reads nothing', async (_name, off) => {
    off()
    const read = jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([])
    const tree = sheet()
    await act(async () => undefined)
    expect(tree.queryByTestId(id(ConfirmWithSheetIds.sheet))).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })

  test('with no connection (null), it shows nothing', async () => {
    const tree = sheet(null)
    await act(async () => undefined)
    expect(tree.queryByTestId(id(ConfirmWithSheetIds.sheet))).toBeNull()
  })
})
