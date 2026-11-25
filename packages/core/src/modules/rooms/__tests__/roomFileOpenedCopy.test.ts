/**
 * The copy of a file being opened: built under a blank name in the one directory, and moved to its own name only once
 * it has passed. Deleted whole however it ends.
 */
const mockUnlink = jest.fn(async (_path: string) => undefined)
const mockAppend = jest.fn(async (_path: string, _data: string, _encoding: string) => undefined)
const mockMove = jest.fn(async (_from: string, _to: string) => undefined)
jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    CachesDirectoryPath: '/caches',
    unlink: (path: string) => mockUnlink(path),
    mkdir: async () => undefined,
    writeFile: async () => undefined,
    appendFile: (path: string, data: string, encoding: string) => mockAppend(path, data, encoding),
    moveFile: (from: string, to: string) => mockMove(from, to),
  },
}))

import { createOpenedCopy, releaseOpenedCopy } from '../real/files/openedCopy'

const DIR = /^\/caches\/keyring-room-files\/[0-9a-f]{32}$/
const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/'))

beforeEach(() => jest.clearAllMocks())

describe('an opened file’s copy', () => {
  it('is written under a blank name, in base64, and takes its own name only at the end', async () => {
    const copy = await createOpenedCopy('minutes.pdf')
    await copy.append(Uint8Array.from([1, 2, 3]))
    expect(mockAppend).toHaveBeenCalledTimes(1)
    const [partial, data, encoding] = mockAppend.mock.calls[0]
    expect([data, encoding]).toEqual(['AQID', 'base64'])
    expect(dirOf(partial)).toMatch(DIR)
    expect(partial).not.toContain('minutes')
    expect(mockMove).not.toHaveBeenCalled()

    const uri = await copy.finish()

    const [from, to] = mockMove.mock.calls[0]
    expect(from).toBe(partial)
    expect(dirOf(to)).toMatch(DIR)
    expect(dirOf(to)).not.toBe(dirOf(partial))
    expect(to.endsWith('/minutes.pdf')).toBe(true)
    expect(uri).toBe(`file://${to}`)
    expect(mockUnlink).toHaveBeenCalledWith(dirOf(partial)) // the emptied directory goes too
    expect(mockUnlink).not.toHaveBeenCalledWith(dirOf(to))
  })

  it('gives a URI that survives a name with spaces and #, and releases by it', async () => {
    const copy = await createOpenedCopy('Agenda #2, Oct 30.pdf')
    const uri = await copy.finish()
    expect(uri.endsWith('/Agenda%20%232%2C%20Oct%2030.pdf')).toBe(true)
    const final = mockMove.mock.calls[0][1]
    mockUnlink.mockClear()
    await releaseOpenedCopy(uri)
    expect(mockUnlink).toHaveBeenCalledWith(dirOf(final))
  })

  it('a name cannot climb out of its directory', async () => {
    const copy = await createOpenedCopy('../../Documents/secrets')
    await copy.finish()
    expect(dirOf(mockMove.mock.calls[0][1])).toMatch(DIR)
  })

  it('discarded before it finished: the partial goes', async () => {
    const copy = await createOpenedCopy('minutes.pdf')
    await copy.append(Uint8Array.from([1]))
    const partial = mockAppend.mock.calls[0][0]
    await copy.discard()
    expect(mockUnlink).toHaveBeenCalledWith(dirOf(partial))
    expect(mockMove).not.toHaveBeenCalled()
  })

  it('discarded after it finished (a lock at the last moment): the final copy goes too', async () => {
    const copy = await createOpenedCopy('minutes.pdf')
    await copy.finish()
    const final = mockMove.mock.calls[0][1]
    await copy.discard()
    expect(mockUnlink).toHaveBeenCalledWith(dirOf(final))
  })

  it('a URI from elsewhere deletes nothing', async () => {
    await releaseOpenedCopy('file:///caches/wallet-backup-1/wallet.db')
    expect(mockUnlink).not.toHaveBeenCalled()
  })
})
