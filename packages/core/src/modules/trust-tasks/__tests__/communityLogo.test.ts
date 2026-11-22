/**
 * A community's logo is fetched once (https, a small PNG/JPEG/WebP) and kept on the phone; anything else, or any
 * failure, is no logo, and a failure is not asked again in the same run.
 */
import RNFS from 'react-native-fs'

import { MAX_LOGO_BYTES, cachedCommunityLogo, resetCommunityLogos } from '../module/communityLogo'

jest.mock('react-native-fs', () => ({
  CachesDirectoryPath: '/caches',
  exists: jest.fn(),
  mkdir: jest.fn(async () => undefined),
  downloadFile: jest.fn(),
  stopDownload: jest.fn(),
  moveFile: jest.fn(async () => undefined),
  unlink: jest.fn(async () => undefined),
}))

const fs = RNFS as unknown as Record<string, jest.Mock>
const DID = 'did:webvh:Qm:dids.example.org:harbor'
const LOGO = 'https://vtc.example.org/logo.png'

/** A download whose server answers with `type`, `length` and `status`, writing `written` bytes. */
function serves(type: string, { status = 200, length = 2000, written = 2000 } = {}) {
  // As react-native-fs does: the headers (begin) arrive before the download settles.
  fs.downloadFile.mockImplementation(({ begin }: { begin: (r: unknown) => void }) => ({
    jobId: 7,
    promise: new Promise((resolve) =>
      setTimeout(() => {
        begin({ statusCode: status, contentLength: length, headers: { 'Content-Type': type } })
        resolve({ statusCode: status, bytesWritten: written })
      }, 0)
    ),
  }))
}

beforeEach(() => {
  resetCommunityLogos()
  jest.clearAllMocks()
  fs.exists.mockResolvedValue(false)
})

describe('a community logo', () => {
  test('fetched once and kept: the second ask reads the kept file without the network', async () => {
    serves('image/png')
    const first = await cachedCommunityLogo(DID, LOGO)
    expect(first).toMatch(/^file:\/\/\/caches\/community-logos\/[0-9a-f]{64}$/)
    expect(fs.downloadFile).toHaveBeenCalledTimes(1)
    expect(fs.moveFile).toHaveBeenCalledWith(`${first!.slice(7)}.part`, first!.slice(7))
    expect(await cachedCommunityLogo(DID, LOGO)).toBe(first)
    expect(fs.downloadFile).toHaveBeenCalledTimes(1)
  })

  test('kept from an earlier run: no download at all', async () => {
    fs.exists.mockResolvedValue(true)
    expect(await cachedCommunityLogo(DID, LOGO)).toMatch(/^file:\/\//)
    expect(fs.downloadFile).not.toHaveBeenCalled()
  })

  test('keyed by community and address: another community’s same address is its own file', async () => {
    serves('image/png')
    const mine = await cachedCommunityLogo(DID, LOGO)
    const theirs = await cachedCommunityLogo(`${DID}-other`, LOGO)
    expect(theirs).not.toBe(mine)
  })

  test('only https is fetched', async () => {
    expect(await cachedCommunityLogo(DID, 'http://vtc.example.org/logo.png')).toBeUndefined()
    expect(await cachedCommunityLogo(DID, undefined)).toBeUndefined()
    expect(fs.downloadFile).not.toHaveBeenCalled()
  })

  test.each([
    ['an SVG (not drawn by the app)', 'image/svg+xml', {}],
    ['a web page', 'text/html', {}],
    ['a missing type', '', {}],
    ['a file announced too large', 'image/png', { length: MAX_LOGO_BYTES + 1 }],
    ['a file that turned out too large', 'image/png', { written: MAX_LOGO_BYTES + 1 }],
    ['a failing status', 'image/png', { status: 404 }],
  ])('%s is no logo, and nothing is kept', async (_label, type, opts) => {
    serves(type, opts)
    expect(await cachedCommunityLogo(DID, LOGO)).toBeUndefined()
    expect(fs.moveFile).not.toHaveBeenCalled()
    expect(fs.unlink).toHaveBeenCalled()
  })

  test('a file sent without its size is stopped once it passes the limit, not written out in full', async () => {
    const reported: number[] = []
    fs.downloadFile.mockImplementation(
      ({ begin, progress }: { begin: (r: unknown) => void; progress: (r: { bytesWritten: number }) => void }) => ({
        jobId: 9,
        promise: new Promise((resolve) =>
          setTimeout(() => {
            begin({ statusCode: 200, contentLength: -1, headers: { 'Content-Type': 'image/png' } })
            for (const bytesWritten of [MAX_LOGO_BYTES / 2, MAX_LOGO_BYTES, MAX_LOGO_BYTES + 1]) {
              reported.push(bytesWritten)
              progress({ bytesWritten })
              // Under the limit, it carries on (the control for the stop below).
              if (bytesWritten <= MAX_LOGO_BYTES) expect(fs.stopDownload).not.toHaveBeenCalled()
            }
            resolve({ statusCode: 200, bytesWritten: MAX_LOGO_BYTES + 1 })
          }, 0)
        ),
      })
    )
    expect(await cachedCommunityLogo(DID, LOGO)).toBeUndefined()
    expect(reported).toHaveLength(3)
    expect(fs.stopDownload).toHaveBeenCalledWith(9)
    expect(fs.moveFile).not.toHaveBeenCalled()
    expect(fs.unlink).toHaveBeenCalled()
  })

  test('a failure is not asked again in the same run', async () => {
    fs.downloadFile.mockImplementation(() => ({ jobId: 1, promise: Promise.reject(new Error('offline')) }))
    expect(await cachedCommunityLogo(DID, LOGO)).toBeUndefined()
    expect(await cachedCommunityLogo(DID, LOGO)).toBeUndefined()
    expect(fs.downloadFile).toHaveBeenCalledTimes(1)
  })
})
