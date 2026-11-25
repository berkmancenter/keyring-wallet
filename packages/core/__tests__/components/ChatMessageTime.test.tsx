/**
 * A message's time: the words of the app's language from our own locale files, and the clock the phone is set to,
 * whatever the language. A French screen on a 12-hour phone says "4:01 PM"; an English one on a 24-hour phone says
 * "16:01". Under Hermes the engine's own formatting answered in English whatever the locale (simulator check on
 * #606), so nothing here comes from Intl.
 */
import { render } from '@testing-library/react-native'
import i18next from 'i18next'
import React from 'react'
import { MessageProps } from 'react-native-gifted-chat'

import { ChatMessage, ExtendedChatMessage } from '../../src/components/chat/ChatMessage'
import en from '../../src/localization/en/en.json'
import fr from '../../src/localization/fr/fr.json'
import ptBr from '../../src/localization/pt-br/pt-br.json'
import { Role } from '../../src/types/chat'

const mockI18n = i18next.createInstance()
mockI18n.init({
  lng: 'en',
  resources: { en: { translation: en }, fr: { translation: fr }, 'pt-BR': { translation: ptBr } },
  initImmediate: false,
})
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockI18n.t.bind(mockI18n), i18n: mockI18n }),
}))

const mockUses24HourClock = jest.fn()
jest.mock('react-native-localize', () => ({
  ...jest.requireActual('../../__mocks__/custom/react-native-localize'),
  uses24HourClock: () => mockUses24HourClock(),
}))

const item = (at: Date, overrides: Partial<ExtendedChatMessage> = {}): MessageProps<ExtendedChatMessage> => ({
  user: { _id: Role.me },
  position: 'left',
  currentMessage: {
    _id: 't',
    user: { _id: Role.them },
    renderEvent: () => <></>,
    text: 'hello',
    createdAt: at,
    ...overrides,
  },
})

describe("a message's time", () => {
  const afternoon = new Date(2026, 9, 15, 16, 1)
  const morning = new Date(2026, 9, 15, 9, 5)

  afterEach(() => mockI18n.changeLanguage('en'))

  test.each(['en', 'fr', 'pt-BR'])('%s on a 24-hour phone', async (language) => {
    await mockI18n.changeLanguage(language)
    mockUses24HourClock.mockReturnValue(true)
    expect(render(<ChatMessage messageProps={item(afternoon)} />).getByText('16:01')).toBeTruthy()
    expect(render(<ChatMessage messageProps={item(morning)} />).getByText('09:05')).toBeTruthy()
  })

  test.each(['en', 'fr', 'pt-BR'])('%s on a 12-hour phone', async (language) => {
    await mockI18n.changeLanguage(language)
    mockUses24HourClock.mockReturnValue(false)
    expect(render(<ChatMessage messageProps={item(afternoon)} />).getByText('4:01 PM')).toBeTruthy()
    expect(render(<ChatMessage messageProps={item(morning)} />).getByText('9:05 AM')).toBeTruthy()
  })

  test('only the time: the day is the pill’s to say', () => {
    mockUses24HourClock.mockReturnValue(true)
    const tree = render(<ChatMessage messageProps={item(afternoon)} />)
    expect(tree.getByText('16:01')).toBeTruthy()
    expect(tree.queryByText(/Oct|15|2026/)).toBeNull()
  })

  test('a photo with no caption still shows its time', () => {
    mockUses24HourClock.mockReturnValue(false)
    const photo = item(afternoon, {
      text: 'Chat.Photo',
      image: 'file:///photo.jpg',
      imageSize: { width: 800, height: 600 },
    })
    expect(render(<ChatMessage messageProps={photo} />).getByText('4:01 PM')).toBeTruthy()
  })
})
