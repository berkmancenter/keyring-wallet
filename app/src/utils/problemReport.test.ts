import * as Sharing from 'expo-sharing'
import { Platform, Share } from 'react-native'
import { writeFile } from 'react-native-fs'

import {
  clearLogBuffer,
  getRecentLogLines,
  installLogBuffer,
  LOG_BUFFER_CAPACITY,
  LOG_LINE_MAX_LENGTH,
  OPAQUE_TOKEN_MAX_LENGTH,
  recordLogLine,
  shortenOpaqueTokens,
} from './logBuffer'
import { buildProblemReport, errorChain, ReportEnvironment, shareReport } from './problemReport'

jest.mock('react-native-fs', () => ({ CachesDirectoryPath: '/cache', writeFile: jest.fn(async () => undefined) }))
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}))

const env: ReportEnvironment = {
  app: 'KeyRing',
  version: '0.2.0',
  build: '205',
  system: 'iOS 26.3',
  device: 'iPhone 16',
  time: '2026-09-21T19:26:59.462Z',
}

describe('log buffer', () => {
  beforeEach(() => clearLogBuffer())

  it('keeps the newest lines up to its capacity, oldest first', () => {
    for (let i = 0; i < LOG_BUFFER_CAPACITY + 5; i++) {
      recordLogLine('debug', [`line ${i}`], new Date(0))
    }
    const lines = getRecentLogLines()
    expect(lines).toHaveLength(LOG_BUFFER_CAPACITY)
    expect(lines[0]).toContain('line 5')
    expect(lines[lines.length - 1]).toContain(`line ${LOG_BUFFER_CAPACITY + 4}`)
  })

  it('captures console output and still passes it through', () => {
    const calls: unknown[][] = []
    const fake = {
      debug: jest.fn(),
      log: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: (...a: unknown[]) => calls.push(a),
    }
    installLogBuffer(fake as unknown as Console)
    fake.error('Agent initialization failed:', new Error('boom'))
    expect(calls).toHaveLength(1)
    expect(getRecentLogLines().pop()).toMatch(/ERROR Agent initialization failed: Error: boom$/)
  })
})

describe('problem report', () => {
  it('walks the cause chain', () => {
    const inner = new TypeError('undefined is not a function')
    const middle = new Error('Could not decode data from utf8 string', { cause: inner })
    const outer = new Error("Error during call to 'onInitializeContext'", { cause: middle })
    expect(errorChain(outer)).toEqual([
      "Error: Error during call to 'onInitializeContext'",
      'Error: Could not decode data from utf8 string',
      'TypeError: undefined is not a function',
    ])
  })

  it('carries the reference, build, error chain and the recent log', () => {
    const report = buildProblemReport(
      {
        referenceCode: 'ABC-123',
        title: 'Oops! Something went wrong',
        message: "Error during call to 'onInitializeContext'",
        error: new Error('outer', { cause: new TypeError('inner') }),
      },
      env,
      ['l1', 'l2', 'l3']
    )
    expect(report).toContain('Keyring problem report ABC-123')
    expect(report).toContain('KeyRing 0.2.0 (205) · iOS 26.3 · iPhone 16')
    expect(report).toContain('Error chain:\n  Error: outer\n  <- TypeError: inner')
    expect(report).toContain('Recent log (3 of 3 lines, oldest first):\nl1\nl2\nl3')
  })

  it('trims the log to the newest lines when asked (email body)', () => {
    const report = buildProblemReport({ referenceCode: 'X' }, env, ['a', 'b', 'c', 'd'], 2)
    expect(report).toContain('Recent log (2 of 4 lines, oldest first):\nc\nd')
    expect(report).not.toContain('\na\n')
  })
})

describe('opaque token shortening', () => {
  const run = (n: number, from = 'a') => from.repeat(n)

  beforeEach(() => {
    clearLogBuffer()
  })

  it('shortens a long opaque run and records its original length', () => {
    const token = run(1000)
    const out = shortenOpaqueTokens(`ciphertext ${token} end`)

    expect(out).toBe(`ciphertext ${run(OPAQUE_TOKEN_MAX_LENGTH)}[…of 1000] end`)
    expect(out).not.toContain(token)
  })

  it('leaves a token alone when annotating it would make the line longer', () => {
    // 81 characters is over the threshold, but the marker costs more than the
    // 1 character it would save.
    const token = run(81)
    expect(shortenOpaqueTokens(token)).toBe(token)
  })

  it('never touches a message type or a message_count', () => {
    const line =
      '{"@type":"https://didcomm.org/messagepickup/2.0/status","message_count":0,"~thread":{"thid":"7c85bbfc-fea4-4eb2-880f-8de78f39d5fd"}}'

    expect(shortenOpaqueTokens(line)).toBe(line)
  })

  it('keeps a did:peer:4 hash intact and shortens only the encoded document', () => {
    const hash = '4zQmQ5EBC4uJeJq34gR6b96ptzyZpa7nKx9g8ydHyojSKuNU'
    const document = run(900, 'z')
    const out = shortenOpaqueTokens(`resolving didUrl did:peer:${hash}:${document}`)

    // The hash is what tells two DIDs apart, so it must survive whole.
    expect(out).toContain(`did:peer:${hash}:`)
    expect(out).toContain('[…of 900]')
    expect(out).not.toContain(document)
  })

  it('shortens before the length cap, so an oversized line keeps its structure', () => {
    // A connection `_tags` dump: small readable fields wrapped around two long
    // DIDs, arriving well over LOG_LINE_MAX_LENGTH. Capping first would discard
    // the tail — including `mediatorId` — for good.
    // `did:peer:` splits on the colon, so the run the pattern sees starts at the
    // method's `4` — the marker reports that whole run, not just the tail.
    const theirs = `4${run(2500, 'z')}`
    const previous = `4${run(2500, 'y')}`
    const text = `Retrieving services {"connectionId":"ee10e267","theirDid":"did:peer:${theirs}","previousTheirDids":["did:peer:${previous}"],"mediatorId":"m-42"}`
    expect(text.length).toBeGreaterThan(LOG_LINE_MAX_LENGTH)

    recordLogLine('debug', [text], new Date('2026-09-23T01:50:04.274Z'))
    const [line] = getRecentLogLines()

    expect(line).toContain('"mediatorId":"m-42"')
    expect(line).toContain(`[…of ${theirs.length}]`)
    expect(line).toContain(`[…of ${previous.length}]`)
    expect(line).not.toContain('more chars')
    expect(line.length).toBeLessThan(LOG_LINE_MAX_LENGTH)
  })

  it('still caps a long line that shortening cannot help', () => {
    // No opaque runs at all — punctuation breaks it up — so the cap is the only
    // thing standing between this and the buffer.
    const text = 'ab. '.repeat(1000)
    recordLogLine('debug', [text])
    const [line] = getRecentLogLines()

    expect(line).toContain('more chars')
    expect(line.length).toBeLessThan(LOG_LINE_MAX_LENGTH + 100)
  })
})

describe('sharing the report (IN-15)', () => {
  // A full log: Android's text share could not carry it, so it goes as a file.
  const fullLog = () => {
    for (let i = 1; i <= LOG_BUFFER_CAPACITY; i++) recordLogLine('debug', [`line ${i}`])
  }
  const input = { referenceCode: 'KR-TEST-1', title: 'Feedback from Settings' }
  const originalOS = Platform.OS

  beforeEach(() => {
    clearLogBuffer()
    jest.clearAllMocks()
    jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' })
  })
  afterEach(() => {
    Platform.OS = originalOS
  })

  it('Android: the whole log goes as a .txt file, not as text', async () => {
    Platform.OS = 'android'
    fullLog()
    await shareReport(input, env)
    const [path, written] = (writeFile as jest.Mock).mock.calls[0]
    expect(path).toBe('/cache/keyring-report-KR-TEST-1.txt')
    expect(written).toContain('line 1\n')
    expect(written).toContain(`line ${LOG_BUFFER_CAPACITY}`)
    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/keyring-report-KR-TEST-1.txt', {
      mimeType: 'text/plain',
      dialogTitle: expect.stringContaining('KR-TEST-1'),
    })
    expect(Share.share).not.toHaveBeenCalled()
  })

  it('Android with no way to hand over a file: the newest lines as text, as email does', async () => {
    Platform.OS = 'android'
    ;(Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false)
    fullLog()
    await shareReport(input, env)
    expect(Sharing.shareAsync).not.toHaveBeenCalled()
    const { message } = (Share.share as jest.Mock).mock.calls[0][0]
    expect(message).toContain(`line ${LOG_BUFFER_CAPACITY}`)
    expect(message).not.toContain('line 1\n')
  })

  it('iOS: the file, through the system share sheet, as before', async () => {
    Platform.OS = 'ios'
    await shareReport(input, env)
    expect(Share.share).toHaveBeenCalledWith({
      url: 'file:///cache/keyring-report-KR-TEST-1.txt',
      title: expect.stringContaining('KR-TEST-1'),
    })
    expect(Sharing.shareAsync).not.toHaveBeenCalled()
  })
})
