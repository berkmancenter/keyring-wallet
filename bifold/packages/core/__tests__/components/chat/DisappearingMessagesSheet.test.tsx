/**
 * The disappearing-messages sheet, through the real English strings: what it says is a promise about when messages
 * vanish, so the words are checked as they are shown, name and length filled in.
 */
import { useAgent } from '@bifold/react-hooks'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import i18next from 'i18next'
import React from 'react'

import DisappearingMessagesSheet from '../../../src/components/chat/DisappearingMessagesSheet'
import { counterpartySpeaksChat } from '../../../src/modules/chat/capability'
import { useChatEvents } from '../../../src/modules/chat/chatEventsStore'
import { ChatEventRecord } from '../../../src/modules/chat/records/ChatEventRecord'
import { setChatTimer } from '../../../src/modules/chat/send'
import en from '../../../src/localization/en/en.json'
import { testIdWithKey } from '../../../src/utils/testable'

const mockI18n = i18next.createInstance()
mockI18n.init({ lng: 'en', resources: { en: { translation: en } }, initImmediate: false })
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockI18n.t.bind(mockI18n) }) }))
jest.mock('../../../src/modules/chat/capability', () => ({ counterpartySpeaksChat: jest.fn() }))
jest.mock('../../../src/modules/chat/chatEventsStore', () => ({ useChatEvents: jest.fn() }))
jest.mock('../../../src/modules/chat/send', () => ({ setChatTimer: jest.fn(async () => ({ carriedAs: 'chat' })) }))

const NAME = 'Ana/Bea'
const ABOUT_A_WEEK =
  "Messages sent in this chat from now on disappear after 1 week: ones you send, 1 week after you send them; ones you receive, 1 week after you first open the chat they're in. Ana/Bea's phone does the same if Ana/Bea has a current Keyring. Messages already sent keep the setting they were sent with."
const KEPT =
  "Once a message disappears from this phone, it can't be brought back here. It can still be kept elsewhere: in a screenshot or copy, in a phone backup made before it disappeared, or on a phone without a current Keyring. A message that hasn't been delivered yet can wait on the message server for up to 7 days."

const timerSetBy = (role: 'sent' | 'received', expiresIn: number) =>
  new ChatEventRecord({
    connectionId: '1',
    eventId: '01JB3XKX6F8Q2W4E5R6T7Y8Z9A',
    eventType: 'timer',
    role,
    sentTime: new Date(Date.UTC(2026, 9, 25, 12)),
    timer: { expiresIn, version: 1 },
  })

const id = (key: string) => testIdWithKey(key)
const checked = (tree: ReturnType<typeof render>, testID: string) =>
  tree.getByTestId(id(testID)).props.accessibilityState?.checked
const sheet = (onClose = jest.fn()) =>
  render(<DisappearingMessagesSheet visible connectionId="1" name={NAME} onClose={onClose} />)
/**
 * The sheet's one read: whether their Keyring speaks chat. What it offers is asserted once that read has answered,
 * awaited rather than timed, so a loaded CI worker can't run a 1 s wait out first (the slow detector found five
 * that could).
 */
const answered = async () => {
  await waitFor(() => expect(counterpartySpeaksChat).toHaveBeenCalled())
  await act(async () => {
    await Promise.allSettled((counterpartySpeaksChat as jest.Mock).mock.results.map((result) => result.value))
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(useChatEvents as jest.Mock).mockReturnValue([])
  ;(counterpartySpeaksChat as jest.Mock).mockResolvedValue(true)
})

describe('a contact whose Keyring speaks chat', () => {
  test('off: Off is checked, and choosing a length shows what it means, word for word, before it is saved', async () => {
    const tree = sheet()
    await answered()
    expect(tree.getByTestId(id('ChatDisappearingOption-0'))).toBeTruthy()
    expect(checked(tree, 'ChatDisappearingOption-0')).toBe(true)
    expect(tree.getByText('Messages already sent keep the setting they were sent with.')).toBeTruthy()
    expect(tree.queryByText(KEPT)).toBeNull()

    fireEvent.press(tree.getByTestId(id('ChatDisappearingOption-604800')))
    expect(checked(tree, 'ChatDisappearingOption-604800')).toBe(true)
    expect(checked(tree, 'ChatDisappearingOption-0')).toBe(false)
    expect(tree.getByText(ABOUT_A_WEEK)).toBeTruthy()
    expect(tree.getByText(KEPT)).toBeTruthy()
    expect(setChatTimer).not.toHaveBeenCalled()
  })

  test('Save sets the chosen length, and closes', async () => {
    const onClose = jest.fn()
    const tree = sheet(onClose)
    await answered()
    expect(tree.getByTestId(id('ChatDisappearingOption-3600'))).toBeTruthy()
    fireEvent.press(tree.getByTestId(id('ChatDisappearingOption-3600')))
    await act(async () => fireEvent.press(tree.getByTestId(id('ChatDisappearingSave'))))
    expect(setChatTimer).toHaveBeenCalledWith((useAgent as jest.Mock)().agent, '1', 3600)
    expect(onClose).toHaveBeenCalled()
  })

  test('Save does nothing while the choice is the current setting', async () => {
    ;(useChatEvents as jest.Mock).mockReturnValue([timerSetBy('sent', 86400)])
    const tree = sheet()
    await answered()
    expect(tree.getByTestId(id('ChatDisappearingSave'))).toBeTruthy()
    expect(checked(tree, 'ChatDisappearingOption-86400')).toBe(true)
    await act(async () => fireEvent.press(tree.getByTestId(id('ChatDisappearingSave'))))
    expect(setChatTimer).not.toHaveBeenCalled()
  })

  test('a length the other phone set that no choice offers: shown as it is, checked, with every choice unchecked', async () => {
    ;(useChatEvents as jest.Mock).mockReturnValue([timerSetBy('received', 12345)])
    const tree = sheet()
    await answered()
    expect(tree.getByTestId(id('ChatDisappearingCurrent'))).toBeTruthy()
    expect(tree.getByText('Messages disappear after 3 hours 26 minutes, set by Ana/Bea')).toBeTruthy()
    expect(checked(tree, 'ChatDisappearingCurrent')).toBe(true)
    for (const choice of [0, 3600, 86400, 604800, 2419200]) {
      expect(checked(tree, `ChatDisappearingOption-${choice}`)).toBe(false)
    }
  })

  test('a length every choice offers is not shown twice', async () => {
    ;(useChatEvents as jest.Mock).mockReturnValue([timerSetBy('received', 3600)])
    const tree = sheet()
    await answered()
    expect(tree.getByTestId(id('ChatDisappearingOption-3600'))).toBeTruthy()
    expect(tree.queryByTestId(id('ChatDisappearingCurrent'))).toBeNull()
  })
})

describe('a contact whose Keyring does not speak chat', () => {
  test('nothing to choose: only what to ask of them', async () => {
    ;(counterpartySpeaksChat as jest.Mock).mockResolvedValue(false)
    const tree = sheet()
    await answered()
    expect(tree.getByText('Ask Ana/Bea to update Keyring to use disappearing messages')).toBeTruthy()
    expect(tree.queryByTestId(id('ChatDisappearingOption-0'))).toBeNull()
    expect(tree.queryByTestId(id('ChatDisappearingSave'))).toBeNull()
  })

  test('nothing is offered before the answer', () => {
    ;(counterpartySpeaksChat as jest.Mock).mockReturnValue(new Promise(() => undefined))
    const tree = sheet()
    expect(tree.queryByTestId(id('ChatDisappearingOption-0'))).toBeNull()
    expect(tree.queryByTestId(id('ChatDisappearingSave'))).toBeNull()
  })
})
