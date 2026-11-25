/**
 * Clear chat, as the person reads it, through real i18next: it asks first, says the deletion is for good and that
 * the other person keeps their copy, and only a confirmed clear deletes anything.
 */
import { act, renderHook } from '@testing-library/react-native'
import i18next from 'i18next'
import { Alert } from 'react-native'
import Toast from 'react-native-toast-message'

import { translationResources } from '../../../localization'
import { deleteChatMessages } from '../history'
import { useClearChat } from '../useClearChat'

let mockT: (key: string, options?: Record<string, unknown>) => string
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => mockT(key, options) }),
}))
const mockAgent: { config: { logger: { warn: jest.Mock } } } | undefined = { config: { logger: { warn: jest.fn() } } }
let mockAgentNow: typeof mockAgent | undefined = mockAgent
jest.mock('@bifold/react-hooks', () => ({ useAgent: () => ({ agent: mockAgentNow }) }))
jest.mock('react-native-toast-message', () => ({ show: jest.fn() }))
jest.mock('../history', () => ({ deleteChatMessages: jest.fn(async () => undefined) }))

type Button = { text: string; style?: string; onPress?: () => void }
const buttons = () => (Alert.alert as jest.Mock).mock.calls[0][2] as Button[]
const press = async (text: string) => {
  await act(async () => {
    buttons()
      .find((b) => b.text === text)
      ?.onPress?.()
  })
}

describe('Clear chat', () => {
  beforeAll(async () => {
    const i18n = i18next.createInstance()
    await i18n.init({ lng: 'en', fallbackLng: 'en', resources: translationResources })
    mockT = (key, options) => i18n.t(key, options) as string
  })
  beforeEach(() => {
    mockAgentNow = mockAgent
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
  })
  afterEach(() => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
  })

  test('asks first, saying it deletes for good and that the other person keeps their copy', () => {
    const { result } = renderHook(() => useClearChat())
    result.current('conn-1', 'Ada')
    expect(Alert.alert).toHaveBeenCalledWith(
      'Clear this chat?',
      "Every message and photo in this chat will be deleted from this phone for good. Ada keeps their copy. This can't be undone.",
      [{ text: 'Cancel', style: 'cancel' }, expect.objectContaining({ text: 'Clear chat', style: 'destructive' })]
    )
    expect(deleteChatMessages).not.toHaveBeenCalled()
  })

  test('confirmed, it clears that chat, says so and calls back', async () => {
    const onCleared = jest.fn()
    const { result } = renderHook(() => useClearChat())
    result.current('conn-1', 'Ada', onCleared)
    await press('Clear chat')
    expect(deleteChatMessages).toHaveBeenCalledWith(mockAgent, 'conn-1')
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ text1: 'Chat cleared' }))
    expect(onCleared).toHaveBeenCalled()
  })

  test('cancelled, nothing is deleted', async () => {
    const { result } = renderHook(() => useClearChat())
    result.current('conn-1', 'Ada')
    await press('Cancel')
    expect(deleteChatMessages).not.toHaveBeenCalled()
  })

  test('a clear that fails says some messages may already be gone, and does not call back', async () => {
    ;(deleteChatMessages as jest.Mock).mockRejectedValueOnce(new Error('the store could not be written'))
    const onCleared = jest.fn()
    const { result } = renderHook(() => useClearChat())
    result.current('conn-1', 'Ada', onCleared)
    await press('Clear chat')
    expect(Toast.show).toHaveBeenCalledWith(
      expect.objectContaining({
        text1: "The chat couldn't be fully cleared, and some messages may already be gone. Try again.",
      })
    )
    expect(onCleared).not.toHaveBeenCalled()
  })

  test('with no agent yet, it does nothing', () => {
    mockAgentNow = undefined
    const { result } = renderHook(() => useClearChat())
    result.current('conn-1', 'Ada')
    expect(Alert.alert).not.toHaveBeenCalled()
  })

  test('the words exist in French and Portuguese, and the Portuguese does not assume a gender', () => {
    const keys = ['ClearChat', 'ClearChatTitle', 'ClearChatBody', 'ClearChatDone', 'ClearChatFailed']
    for (const lng of ['fr', 'pt-BR']) {
      const chat = (translationResources as any)[lng].translation.Chat
      for (const key of keys) expect(chat[key]).not.toBe((translationResources as any).en.translation.Chat[key])
    }
    expect((translationResources as any)['pt-BR'].translation.Chat.ClearChatBody).not.toMatch(/\bdele\b|\bdela\b/)
  })
})
