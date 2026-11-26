/**
 * The real rooms backend turns sealed bodies to and from base64url with credo's `TypedArrayEncoder`, never `Buffer`.
 * The app's `Buffer` is the `buffer` package (6.0.3), which has no `base64url` and throws; jest runs on Node's
 * `Buffer`, which has it. So a `Buffer.from(…, 'base64url')` there passes every suite and fails on every phone (bifold
 * #947's `newProposeId` did exactly that). The two encoders are injected (`decodeBase64Url`, `encodeBase64Url`), and
 * every suite supplies its own, so nothing else ever runs the real ones: this reads them.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const SOURCE = join(__dirname, '../real/agentRoomsBackend.ts')

describe('the rooms backend’s base64url', () => {
  test('is credo’s TypedArrayEncoder both ways, and no Buffer appears in the backend at all', () => {
    const source = readFileSync(SOURCE, 'utf8')
    expect(source).toContain('resolveSender') // control: this is the file that builds the real backend
    expect(source).toMatch(/decodeBase64Url:[^\n]*TypedArrayEncoder\.fromBase64Url\(/)
    expect(source).toMatch(/encodeBase64Url:[^\n]*TypedArrayEncoder\.toBase64Url\(/)
    expect(source).not.toMatch(/\bBuffer\b/)
  })

  test('why: the app’s Buffer refuses base64url, where the one jest runs on accepts it', () => {
    // `buffer/` is the npm package the app bundles, not Node's built-in module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Buffer: AppBuffer } = require('buffer/') as typeof import('buffer')
    expect(() => AppBuffer.from('aGk', 'base64url')).toThrow(/Unknown encoding: base64url/)
    expect(Buffer.from('aGk', 'base64url').toString('utf8')).toBe('hi') // Node's, in jest: no fault to see
  })
})
