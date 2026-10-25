import { sendChatPhoto } from '../../send'
import { pickAndSendPhoto } from '../compose'
import { ChatPhotoPermissionError, pickChatPhoto } from '../pick'
import { ChatPhotoError, prepareChatPhoto } from '../prepare'

jest.mock('../pick', () => ({ ...jest.requireActual('../pick'), pickChatPhoto: jest.fn() }))
jest.mock('../prepare', () => ({ ...jest.requireActual('../prepare'), prepareChatPhoto: jest.fn() }))
jest.mock('../../send', () => ({ sendChatPhoto: jest.fn(async () => ({ carriedAs: 'chat' })) }))

const pick = pickChatPhoto as jest.Mock
const prepare = prepareChatPhoto as jest.Mock
const send = sendChatPhoto as jest.Mock
const agent = {} as never
const picked = { uri: 'file:///cache/IMG.jpg', width: 4032, height: 3024 }
const jpeg = { mediaType: 'image/jpeg', base64: 'AAAA', byteCount: 3, width: 1600, height: 1200 }
const gif = { ...jpeg, mediaType: 'image/gif' }
const options = (confirm = true) => ({
  fallbackText: 'FALLBACK',
  confirmGif: jest.fn(async () => confirm),
  tools: {} as never,
})

beforeEach(() => {
  jest.clearAllMocks()
  pick.mockResolvedValue(picked)
  prepare.mockResolvedValue(jpeg)
})

describe('pickAndSendPhoto', () => {
  it('sends the prepared photo with the fallback text, and asks nothing for a photo', async () => {
    const o = options()
    await expect(pickAndSendPhoto(agent, 'conn-1', 'library', o)).resolves.toBe('sent')
    expect(send).toHaveBeenCalledWith(agent, 'conn-1', jpeg, { fallbackText: 'FALLBACK' })
    expect(o.confirmGif).not.toHaveBeenCalled()
  })

  // A GIF goes as it is, with whatever the file carries: nothing is sent unless the person agrees.
  it('asks before a GIF, and sends nothing when the answer is no', async () => {
    prepare.mockResolvedValue(gif)
    const no = options(false)
    await expect(pickAndSendPhoto(agent, 'conn-1', 'library', no)).resolves.toBe('cancelled')
    expect(no.confirmGif).toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    await expect(pickAndSendPhoto(agent, 'conn-1', 'library', options(true))).resolves.toBe('sent')
    expect(send).toHaveBeenCalledWith(agent, 'conn-1', gif, { fallbackText: 'FALLBACK' })
  })

  it.each([
    ['a cancelled pick', () => pick.mockResolvedValue(undefined), 'cancelled'],
    ['no permission', () => pick.mockRejectedValue(new ChatPhotoPermissionError('camera')), 'no-permission'],
    ['a GIF over the limit', () => prepare.mockRejectedValue(new ChatPhotoError('gif-too-large')), 'gif-too-large'],
    [
      'a photo that will not fit',
      () => prepare.mockRejectedValue(new ChatPhotoError('photo-too-large')),
      'photo-too-large',
    ],
    ['an unreadable file', () => prepare.mockRejectedValue(new Error('decode failed')), 'unreadable'],
    ['a failed send', () => send.mockRejectedValueOnce(new Error('mediator unreachable')), 'not-sent'],
  ])('says so for %s, and never throws', async (_label, arrange, outcome) => {
    arrange()
    await expect(pickAndSendPhoto(agent, 'conn-1', 'camera', options())).resolves.toBe(outcome)
    if (outcome !== 'not-sent') expect(send).not.toHaveBeenCalled()
  })
})
