import { clearLogBuffer, getRecentLogLines, installLogBuffer, LOG_BUFFER_CAPACITY, recordLogLine } from './logBuffer'
import { buildProblemReport, errorChain, ReportEnvironment } from './problemReport'

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
