import i18next from 'i18next'
import { Alert, Linking } from 'react-native'
import Toast from 'react-native-toast-message'

import en from '../../../../localization/en/en.json'
import fr from '../../../../localization/fr/fr.json'
import ptBr from '../../../../localization/pt-br/pt-br.json'
import { confirmGifAsIs, explainPhotoOutcome, showPhotoOutcome } from '../outcome'

const t = ((key: string) => key) as never

beforeEach(() => {
  jest.restoreAllMocks()
  jest.spyOn(Toast, 'show').mockImplementation(() => undefined)
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined)
})

describe('explainPhotoOutcome', () => {
  it.each([
    ['sent', undefined],
    ['cancelled', undefined],
    ['gif-too-large', { kind: 'toast', text: 'Chat.GifTooLarge' }],
    ['photo-too-large', { kind: 'toast', text: 'Chat.PhotoTooLarge' }],
    ['unreadable', { kind: 'toast', text: 'Chat.PhotoUnreadable' }],
    ['not-sent', { kind: 'toast', text: 'Chat.PhotoNotSent' }],
    ['no-permission', { kind: 'settings', title: 'Chat.PhotoNoPermissionTitle', text: 'Chat.PhotoNoPermission' }],
  ] as const)('%s', (outcome, notice) => {
    expect(explainPhotoOutcome(outcome)).toEqual(notice)
  })
})

describe('showPhotoOutcome', () => {
  it('says nothing for a photo that went or a cancel', () => {
    showPhotoOutcome('sent', t)
    showPhotoOutcome('cancelled', t)
    expect(Toast.show).not.toHaveBeenCalled()
    expect(Alert.alert).not.toHaveBeenCalled()
  })

  it('says in a toast why a photo was not sent', () => {
    showPhotoOutcome('not-sent', t)
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ text1: 'Chat.PhotoNotSent' }))
    expect(Alert.alert).not.toHaveBeenCalled()
  })

  // A toast here read as the tap doing nothing, and once refused, access can only be given back in Settings.
  it('asks about a missing permission until answered, with a way to Settings', () => {
    showPhotoOutcome('no-permission', t)
    expect(Toast.show).not.toHaveBeenCalled()
    const [title, body, buttons] = (Alert.alert as jest.Mock).mock.calls[0] as [
      string,
      string,
      { text: string; style?: string; onPress?: () => void }[],
    ]
    expect([title, body]).toEqual(['Chat.PhotoNoPermissionTitle', 'Chat.PhotoNoPermission'])
    expect(buttons.map((button) => button.text)).toEqual(['Global.Cancel', 'Chat.OpenSettings'])
    expect(Linking.openSettings).not.toHaveBeenCalled()
    buttons[1].onPress?.()
    expect(Linking.openSettings).toHaveBeenCalledTimes(1)
  })
})

// A GIF goes as it is, with whatever the file carries: it is sent only on an explicit yes.
describe('confirmGifAsIs', () => {
  type Button = { text: string; onPress?: () => void }
  const ask = () => {
    const answer = confirmGifAsIs(t)()
    const [title, body, buttons, options] = (Alert.alert as jest.Mock).mock.calls[
      (Alert.alert as jest.Mock).mock.calls.length - 1
    ] as [string, string, Button[], { onDismiss?: () => void }]
    return { answer, title, body, buttons, options }
  }

  it('asks before a GIF goes as it is, with Cancel and Send GIF', () => {
    const { title, body, buttons } = ask()
    expect([title, body]).toEqual(['Chat.GifAsIsTitle', 'Chat.GifAsIsBody'])
    expect(buttons.map((button) => button.text)).toEqual(['Global.Cancel', 'Chat.SendGif'])
  })

  it('says yes only for Send GIF', async () => {
    const send = ask()
    send.buttons[1].onPress?.()
    await expect(send.answer).resolves.toBe(true)

    const cancel = ask()
    cancel.buttons[0].onPress?.()
    await expect(cancel.answer).resolves.toBe(false)

    const dismissed = ask()
    dismissed.options.onDismiss?.()
    await expect(dismissed.answer).resolves.toBe(false)
  })
})

// The tests above pin which keys are shown; these read what a person sees, through real i18next (the jest mock of
// react-i18next returns keys), so a key missing from a language fails here instead of showing as the key itself.
describe('the missing-permission dialog’s words', () => {
  const words = ['Chat.PhotoNoPermissionTitle', 'Chat.PhotoNoPermission', 'Chat.OpenSettings', 'Global.Cancel']

  it.each([
    ['en', en],
    ['fr', fr],
    ['pt-BR', ptBr], // the code the app registers it under (localization/index.ts); 'pt-br' finds nothing
  ])('are all written in %s', async (lng, translation) => {
    const i18n = i18next.createInstance()
    await i18n.init({ lng, resources: { [lng]: { translation } } })
    for (const key of words) expect(i18n.t(key)).not.toBe(key)
  })

  it('read as intended in English', async () => {
    const i18n = i18next.createInstance()
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } })
    expect(i18n.t('Chat.PhotoNoPermissionTitle')).toBe('Access needed')
    expect(i18n.t('Chat.OpenSettings')).toBe('Open settings')
  })
})
