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
    expect(send).toHaveBeenCalledWith(agent, 'conn-1', jpeg, { fallbackText: 'FALLBACK', eventId: expect.any(String) })
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
    expect(send).toHaveBeenCalledWith(agent, 'conn-1', gif, { fallbackText: 'FALLBACK', eventId: expect.any(String) })
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

// The screen shows nothing for a cancel, and an iOS picker refused access, or never presented, reports one too.
describe('what a pick that ends in nothing leaves in the log', () => {
  const logger = { info: jest.fn(), warn: jest.fn() }
  const logged = { config: { logger } } as never

  it.each([
    [
      'a cancelled pick',
      () => pick.mockResolvedValue(undefined),
      'info',
      '[Chat:photo] the camera picker closed without a photo',
    ],
    [
      'no permission',
      () => pick.mockRejectedValue(new ChatPhotoPermissionError('camera')),
      'info',
      '[Chat:photo] no permission to use the camera',
    ],
    [
      'a picker that failed',
      () => pick.mockRejectedValue(new Error('picker broke')),
      'warn',
      '[Chat:photo] the camera picker failed',
    ],
  ])('logs %s', async (_label, arrange, level, line) => {
    arrange()
    await pickAndSendPhoto(logged, 'conn-1', 'camera', options())
    expect(logger[level as 'info' | 'warn']).toHaveBeenCalledWith(
      line,
      ...(level === 'warn' ? [expect.anything()] : [])
    )
  })

  it('logs nothing for a photo that went', async () => {
    await expect(pickAndSendPhoto(logged, 'conn-1', 'library', options())).resolves.toBe('sent')
    expect(logger.info).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })
})

// The screen shows the photo while it goes (media/pending.ts): picked, then being sent, or not sent with a retry.
describe('what the screen hears while a photo goes', () => {
  const hooked = () => {
    const heard: string[] = []
    let retry: (() => Promise<boolean>) | undefined
    const hooks = {
      picked: jest.fn((p: { uri: string }) => heard.push(`picked ${p.uri}`)),
      goOn: jest.fn(() => true),
      sending: jest.fn(() => heard.push('sending')),
      failed: jest.fn((r: () => Promise<boolean>) => {
        heard.push('failed')
        retry = r
      }),
    }
    return { heard, hooks, retry: () => retry }
  }

  it('picked, then sending, then nothing more when it went', async () => {
    const h = hooked()
    await expect(pickAndSendPhoto(agent, 'conn-1', 'camera', { ...options(), hooks: h.hooks })).resolves.toBe('sent')
    expect(h.heard).toEqual([`picked ${picked.uri}`, 'sending'])
    expect(h.hooks.failed).not.toHaveBeenCalled()
  })

  it('stopped while it was made ready: nothing is sent, and it never says sending', async () => {
    const h = hooked()
    h.hooks.goOn.mockReturnValue(false)
    await expect(pickAndSendPhoto(agent, 'conn-1', 'camera', { ...options(), hooks: h.hooks })).resolves.toBe(
      'cancelled'
    )
    expect(send).not.toHaveBeenCalled()
    expect(h.hooks.sending).not.toHaveBeenCalled()
  })

  it('not sent: Try again sends the same prepared photo, not a new pick, and says whether it went', async () => {
    const h = hooked()
    send.mockRejectedValueOnce(new Error('mediator unreachable'))
    await expect(pickAndSendPhoto(agent, 'conn-1', 'camera', { ...options(), hooks: h.hooks })).resolves.toBe(
      'not-sent'
    )
    expect(h.heard).toEqual([`picked ${picked.uri}`, 'sending', 'failed'])
    send.mockRejectedValueOnce(new Error('still unreachable'))
    await expect(h.retry()?.()).resolves.toBe(false)
    await expect(h.retry()?.()).resolves.toBe(true)
    expect(send).toHaveBeenCalledTimes(3)
    for (const call of send.mock.calls) expect(call[2]).toBe(jpeg)
    // Every attempt names the same event, so a receiver that got the first drops the retry instead of showing it twice.
    const ids = send.mock.calls.map((call) => call[3].eventId)
    expect(new Set(ids).size).toBe(1)
    expect(pick).toHaveBeenCalledTimes(1)
    expect(prepare).toHaveBeenCalledTimes(1)
  })

  it('two photos are two events (control for the retry above)', async () => {
    await pickAndSendPhoto(agent, 'conn-1', 'camera', options())
    await pickAndSendPhoto(agent, 'conn-1', 'camera', options())
    expect(send.mock.calls[0][3].eventId).not.toBe(send.mock.calls[1][3].eventId)
  })

  it('a pick that ends in nothing is never shown (control: no picked)', async () => {
    const h = hooked()
    pick.mockResolvedValue(undefined)
    await expect(pickAndSendPhoto(agent, 'conn-1', 'camera', { ...options(), hooks: h.hooks })).resolves.toBe(
      'cancelled'
    )
    expect(h.hooks.picked).not.toHaveBeenCalled()
  })
})
