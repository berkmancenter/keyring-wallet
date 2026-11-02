/**
 * A room file's temporary copy is the file in the clear, so the rule that clears it is held here: one directory, every
 * copy told apart by a random id, a sharer's name never a path, nothing outside that directory ever removed, and
 * nothing left behind a locked wallet.
 */
const mockUnlink = jest.fn(async (_path: string) => undefined)
const mockMkdir = jest.fn(async (_path: string, _options?: unknown) => undefined)
const mockWriteFile = jest.fn(async (_path: string, _contents: string, _options?: unknown) => undefined)
const mockMoveFile = jest.fn(async (_from: string, _to: string, _options?: unknown) => undefined)
jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    CachesDirectoryPath: '/caches',
    unlink: (path: string) => mockUnlink(path),
    mkdir: (path: string, options?: unknown) => mockMkdir(path, options),
    writeFile: (path: string, contents: string, options?: unknown) => mockWriteFile(path, contents, options),
    moveFile: (from: string, to: string, options?: unknown) => mockMoveFile(from, to, options),
  },
}))

import { DeviceEventEmitter, Platform } from 'react-native'

import {
  adoptRoomFileCopy,
  createRoomFileCopy,
  holdRoomFileTransfer,
  removeRoomFileCopy,
  roomFileCopyPath,
} from '../real/files/tempCopies'
import { WALLET_LOCKED_EVENT } from '../../../utils/walletLocked'

const COPIES = '/caches/keyring-room-files'
const ID = '[0-9a-f]{32}'
const PROTECTION = 'NSFileProtectionCompleteUnlessOpen'
const flush = () => new Promise((resolve) => setImmediate(resolve))

beforeEach(() => {
  jest.clearAllMocks()
  Platform.OS = 'ios'
})

describe('a new copy', () => {
  it('sits in a directory of its own under the one copies directory, and nothing is written yet', async () => {
    const path = await roomFileCopyPath('report.pdf')
    expect(path).toMatch(new RegExp(`^${COPIES}/${ID}/report\\.pdf$`))
    expect(mockMkdir.mock.calls[0][0]).toBe(path.slice(0, path.lastIndexOf('/')))
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('two copies of one name never share a directory', async () => {
    expect(await roomFileCopyPath('a.txt')).not.toEqual(await roomFileCopyPath('a.txt'))
  })

  it.each([
    ['../../Documents/secrets.db', 'secrets.db'],
    ['..\\..\\evil.txt', 'evil.txt'],
    ['/etc/passwd', 'passwd'],
    ['..', 'file'],
    ['.', 'file'],
    ['', 'file'],
    ['a/', 'file'],
    ['na\u0000me\n.txt', 'name.txt'],
  ])('a sharer’s name %j stays one segment inside its directory', async (name, kept) => {
    const path = await roomFileCopyPath(name)
    expect(path).toMatch(new RegExp(`^${COPIES}/${ID}/[^/]+$`))
    expect(path.split('/').pop()).toBe(kept)
  })

  it('a very long name keeps its end, where the extension is', async () => {
    const path = await roomFileCopyPath(`${'x'.repeat(500)}.pdf`)
    const name = path.split('/').pop() as string
    expect(name).toHaveLength(120)
    expect(name.endsWith('.pdf')).toBe(true)
  })

  it('iOS: the folder stays out of backups and an empty copy is protected before anything is appended', async () => {
    const path = await createRoomFileCopy()
    expect(mockMkdir).toHaveBeenCalledWith(path.slice(0, path.lastIndexOf('/')), {
      NSURLIsExcludedFromBackupKey: true,
    })
    expect(mockWriteFile).toHaveBeenCalledWith(path, '', { encoding: 'utf8', NSFileProtectionKey: PROTECTION })
  })

  it('Android: app-private storage, with no iOS attribute', async () => {
    Platform.OS = 'android'
    const path = await createRoomFileCopy()
    expect(mockWriteFile).toHaveBeenCalledWith(path, '', 'utf8')
  })
})

describe('the picker’s copy', () => {
  const picked = 'file:///caches/1234-5678/My%20salary.pdf'

  it('moves under the rule, protected, and loses its name', async () => {
    const path = await adoptRoomFileCopy(picked)
    expect(path).toMatch(new RegExp(`^${COPIES}/${ID}/file$`))
    expect(mockMoveFile).toHaveBeenCalledWith('/caches/1234-5678/My salary.pdf', path, {
      NSFileProtectionKey: PROTECTION,
    })
  })

  it('that cannot be moved is removed, not left in the caches, and the refusal still reaches the caller', async () => {
    mockMoveFile.mockRejectedValueOnce(new Error('disk full'))
    await expect(adoptRoomFileCopy(picked)).rejects.toThrow('disk full')
    expect(mockUnlink).toHaveBeenCalledWith('/caches/1234-5678/My salary.pdf')
    expect(mockUnlink).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${COPIES}/${ID}$`)))
  })

  it('whose directory cannot be made is removed too', async () => {
    mockMkdir.mockRejectedValueOnce(new Error('disk full'))
    await expect(adoptRoomFileCopy(picked)).rejects.toThrow('disk full')
    expect(mockUnlink).toHaveBeenCalledWith('/caches/1234-5678/My salary.pdf')
  })
})

describe('removing a copy', () => {
  it('removes its whole directory, so the name goes too', async () => {
    const path = await roomFileCopyPath('report.pdf')
    await removeRoomFileCopy(path)
    expect(mockUnlink).toHaveBeenCalledWith(path.slice(0, path.lastIndexOf('/')))
  })

  it('does not throw when the removal fails: a finally must not hide what it unwinds', async () => {
    mockUnlink.mockRejectedValueOnce(new Error('no such file'))
    await expect(removeRoomFileCopy(`${COPIES}/abc/file`)).resolves.toBeUndefined()
  })

  it.each([
    ['nothing', undefined],
    ['the app’s documents', '/documents/wallet.db'],
    ['the caches themselves', '/caches'],
    ['the copies directory itself', COPIES],
    ['a sibling that shares the prefix', `${COPIES}-other/abc/file`],
    ['a climb out of the directory', `${COPIES}/../wallet.db`],
    ['the copies directory by a trailing slash', `${COPIES}/`],
  ])('touches nothing for %s', async (_what, path) => {
    await removeRoomFileCopy(path)
    expect(mockUnlink).not.toHaveBeenCalled()
  })
})

describe('the sweep', () => {
  it('runs once per launch, emptying the copies directory and nothing else, and never throws', async () => {
    // Its own module: the once-per-launch guard lives there.
    let sweep: () => Promise<void> = async () => undefined
    jest.isolateModules(() => {
      sweep = require('../real/files/tempCopies').sweepRoomFileCopiesOnce
    })
    mockUnlink.mockRejectedValueOnce(new Error('no such file'))
    await expect(sweep()).resolves.toBeUndefined()
    await sweep()
    expect(mockUnlink.mock.calls).toEqual([[COPIES]])
  })
})

describe('locking the wallet', () => {
  const lock = async () => {
    DeviceEventEmitter.emit(WALLET_LOCKED_EVENT, 'test')
    await flush()
  }

  it('stops a running transfer, then removes every copy', async () => {
    const order: string[] = []
    const controller = new AbortController()
    controller.signal.addEventListener('abort', () => order.push('stopped'))
    mockUnlink.mockImplementationOnce(async () => {
      order.push('removed')
      return undefined
    })
    holdRoomFileTransfer(controller)
    await lock()
    expect(order).toEqual(['stopped', 'removed'])
    expect(mockUnlink.mock.calls).toEqual([[COPIES]])
  })

  it('is not held back by the once-per-launch guard: every lock clears', async () => {
    await lock()
    await lock()
    expect(mockUnlink).toHaveBeenCalledTimes(2)
  })

  it('leaves alone a transfer that has already let go', async () => {
    const controller = new AbortController()
    holdRoomFileTransfer(controller)()
    await lock()
    expect(controller.signal.aborted).toBe(false)
  })
})
