import { Platform } from 'react-native'
import RNFS from 'react-native-fs'

import { chatMediaFolder, deleteChatMessages } from '../../history'
import { ChatEventRepository } from '../../records/ChatEventRepository'
import {
  CHAT_MEDIA_FILE_PROTECTION,
  chatMediaFileName,
  chatMediaPath,
  chatMediaUri,
  removeChatMedia,
  writeChatMedia,
} from '../store'

// The package-wide react-native-fs mock is empty on purpose: this suite brings a small file system of its own.
let mockFiles: Map<string, string>
jest.mock('react-native-fs', () => ({
  LibraryDirectoryPath: '/lib',
  DocumentDirectoryPath: '/files',
  mkdir: jest.fn(async () => undefined),
  writeFile: jest.fn(async (p: string, contents: string) => {
    mockFiles.set(p, contents)
  }),
  exists: jest.fn(async (p: string) => [...mockFiles.keys()].some((f) => f === p || f.startsWith(`${p}/`))),
  readDir: jest.fn(async (dir: string) =>
    [...mockFiles.keys()]
      .filter((f) => f.startsWith(`${dir}/`) && !f.slice(dir.length + 1).includes('/'))
      .map((f) => ({ name: f.slice(dir.length + 1), path: f }))
  ),
  unlink: jest.fn(async (p: string) => {
    for (const f of [...mockFiles.keys()]) if (f === p || f.startsWith(`${p}/`)) mockFiles.delete(f)
  }),
}))
jest.mock('../../expired', () => ({ forgetExpired: jest.fn(async () => undefined) }))

const CONNECTION = '6f1c2a9e-0b7d-4c1e-9a55-2f0c1d3e4b5a'
const EVENT = '01JB3XKX6F8Q2W4E5R6T7Y8Z9A'
const OTHER_EVENT = '01JB3XKX6F8Q2W4E5R6T7Y8Z9B'

const setPlatform = (os: 'ios' | 'android') => Object.defineProperty(Platform, 'OS', { value: os, configurable: true })
const originalOs = Platform.OS

beforeEach(() => {
  mockFiles = new Map()
  jest.clearAllMocks()
})
afterEach(() => setPlatform(originalOs as 'ios' | 'android'))

describe('chatMediaFileName', () => {
  it('names a photo by its eventId and type, never by anything the sender chose', () => {
    expect(chatMediaFileName(EVENT, 'image/jpeg')).toBe(`${EVENT}.jpg`)
    expect(chatMediaFileName(EVENT, 'image/png')).toBe(`${EVENT}.png`)
    expect(chatMediaFileName(EVENT, 'image/gif')).toBe(`${EVENT}.gif`)
    expect(chatMediaFileName(EVENT, 'image/webp')).toBe(`${EVENT}.webp`)
  })

  it.each([
    ['an eventId that is not a ULID', '../../Documents/x', 'image/jpeg'],
    ['a type chat does not take', EVENT, 'image/heic'],
    ['an inherited object key as the type', EVENT, 'toString'],
  ])('refuses %s', (_name, eventId, mediaType) => {
    expect(chatMediaFileName(eventId, mediaType)).toBeUndefined()
  })
})

describe('writeChatMedia', () => {
  it('on iOS, writes into the chat’s folder, excluded from backups, protected until first unlock after opening', async () => {
    setPlatform('ios')
    const name = await writeChatMedia(CONNECTION, EVENT, 'image/jpeg', 'AAAA')
    const folder = chatMediaFolder(CONNECTION)
    expect(folder).toBe(`/lib/Application Support/chat-media/${CONNECTION}`)
    expect(RNFS.mkdir).toHaveBeenCalledWith(folder, { NSURLIsExcludedFromBackupKey: true })
    expect(RNFS.writeFile).toHaveBeenCalledWith(`${folder}/${EVENT}.jpg`, 'AAAA', {
      encoding: 'base64',
      NSFileProtectionKey: CHAT_MEDIA_FILE_PROTECTION,
    })
    expect(CHAT_MEDIA_FILE_PROTECTION).toBe('NSFileProtectionCompleteUnlessOpen')
    expect(name).toBe(`${EVENT}.jpg`)
  })

  // react-native-fs 2.20: LibraryDirectoryPath is NSLibraryDirectory and DocumentDirectoryPath is Documents on iOS;
  // DocumentDirectoryPath is getFilesDir() on Android. The mock gives each a distinct value so the folder's base shows.
  it('on iOS, keeps the folder under Library, never Documents, and marks it excluded from backup on every write', async () => {
    setPlatform('ios')
    await writeChatMedia(CONNECTION, EVENT, 'image/jpeg', 'AAAA')
    await writeChatMedia(CONNECTION, OTHER_EVENT, 'image/jpeg', 'BBBB')
    const folder = chatMediaFolder(CONNECTION)
    expect(folder.startsWith(`${RNFS.LibraryDirectoryPath}/Application Support/`)).toBe(true)
    expect(folder.startsWith(RNFS.DocumentDirectoryPath)).toBe(false)
    expect(RNFS.mkdir).toHaveBeenCalledTimes(2)
    for (const call of (RNFS.mkdir as jest.Mock).mock.calls)
      expect(call).toEqual([folder, { NSURLIsExcludedFromBackupKey: true }])
  })

  it('on Android, writes into app-private storage', async () => {
    setPlatform('android')
    await writeChatMedia(CONNECTION, EVENT, 'image/png', 'AAAA')
    expect(RNFS.writeFile).toHaveBeenCalledWith(`/files/chat-media/${CONNECTION}/${EVENT}.png`, 'AAAA', 'base64')
  })

  // An iOS data container can move on an update or a restore; a stored absolute path would then point nowhere.
  it('returns a file name to store, never a path', async () => {
    const name = await writeChatMedia(CONNECTION, EVENT, 'image/gif', 'AAAA')
    expect(name).not.toContain('/')
    expect(name.startsWith(EVENT)).toBe(true)
  })

  it.each([
    ['an eventId that is not a ULID', CONNECTION, 'not-a-ulid', 'image/jpeg'],
    ['an unsupported type', CONNECTION, EVENT, 'image/svg+xml'],
    ['a connection id with a path in it', '../other', EVENT, 'image/jpeg'],
  ])('throws, writing nothing, for %s', async (_name, connectionId, eventId, mediaType) => {
    await expect(writeChatMedia(connectionId, eventId, mediaType, 'AAAA')).rejects.toThrow()
    expect(RNFS.writeFile).not.toHaveBeenCalled()
  })

  // A peer knows the eventIds of the photos this phone sent it; reusing one must not replace this phone's copy.
  it('never overwrites a file for the same event, under any extension', async () => {
    await writeChatMedia(CONNECTION, EVENT, 'image/jpeg', 'MINE')
    const mine = chatMediaPath(CONNECTION, `${EVENT}.jpg`) as string
    ;(RNFS.writeFile as jest.Mock).mockClear()
    await expect(writeChatMedia(CONNECTION, EVENT, 'image/jpeg', 'THEIRS')).rejects.toThrow('already there')
    await expect(writeChatMedia(CONNECTION, EVENT, 'image/png', 'THEIRS')).rejects.toThrow('already there')
    expect(RNFS.writeFile).not.toHaveBeenCalled()
    expect(mockFiles.get(mine)).toBe('MINE')
    // The same eventId in another chat is another file.
    await writeChatMedia('7a2b3c4d-0000-4000-8000-000000000000', EVENT, 'image/jpeg', 'OTHER CHAT')
    expect(RNFS.writeFile).toHaveBeenCalledTimes(1)
  })
})

describe('removeChatMedia', () => {
  it('removes a file it wrote, by the name it returned, and leaves the others', async () => {
    const mine = await writeChatMedia(CONNECTION, EVENT, 'image/jpeg', 'MINE')
    await writeChatMedia(CONNECTION, OTHER_EVENT, 'image/jpeg', 'OTHER')
    await removeChatMedia(CONNECTION, mine)
    expect(mockFiles.has(chatMediaPath(CONNECTION, mine) as string)).toBe(false)
    expect(mockFiles.has(chatMediaPath(CONNECTION, `${OTHER_EVENT}.jpg`) as string)).toBe(true)
  })

  it('does nothing for a file already gone, or a name it would not make', async () => {
    await expect(removeChatMedia(CONNECTION, `${EVENT}.jpg`)).resolves.toBeUndefined()
    await removeChatMedia(CONNECTION, '../../Documents/wallet.db')
    await removeChatMedia('../x', `${EVENT}.jpg`)
    expect(RNFS.unlink).not.toHaveBeenCalled()
  })
})

describe('chatMediaPath and chatMediaUri', () => {
  it('build the path from the folder when read, and refuse a name this module did not make', () => {
    setPlatform('ios')
    expect(chatMediaPath(CONNECTION, `${EVENT}.jpg`)).toBe(`${chatMediaFolder(CONNECTION)}/${EVENT}.jpg`)
    // The iOS folder is under "Application Support": a raw space is not valid in a URI.
    expect(chatMediaUri(CONNECTION, `${EVENT}.jpg`)).toBe(
      `file:///lib/Application%20Support/chat-media/${CONNECTION}/${EVENT}.jpg`
    )
    expect(chatMediaUri(CONNECTION, `${EVENT}.jpg`)).not.toContain(' ')
    expect(decodeURIComponent(chatMediaUri(CONNECTION, `${EVENT}.jpg`) as string)).toBe(
      `file://${chatMediaFolder(CONNECTION)}/${EVENT}.jpg`
    )
    expect(chatMediaPath(CONNECTION, '../../Documents/wallet.db')).toBeUndefined()
    expect(chatMediaPath(CONNECTION, `/abs/${EVENT}.jpg`)).toBeUndefined()
    expect(chatMediaPath('../x', `${EVENT}.jpg`)).toBeUndefined()
  })
})

// The naming contract with history.ts: a file written here goes when its message is deleted there, and only then.
describe('deleting a message deletes the photo written for it', () => {
  const agentWith = (eventIds: string[]) => {
    const events = eventIds.map((eventId) => ({
      id: `rec-${eventId}`,
      connectionId: CONNECTION,
      eventId,
      eventType: 'message',
    }))
    const repository = {
      findByConnection: async () => events,
      delete: async (_ctx: unknown, record: { id: string }) => {
        events.splice(
          events.findIndex((e) => e.id === record.id),
          1
        )
      },
    }
    const basic = { findByQuery: async () => [], delete: async () => undefined }
    const resolve = (t: unknown) => (t === ChatEventRepository ? repository : basic)
    const container = { isRegistered: () => true, resolve }
    return { context: {}, dependencyManager: { container, resolve } } as never
  }

  it.each(['ios', 'android'] as const)('on %s', async (os) => {
    setPlatform(os)
    const mine = await writeChatMedia(CONNECTION, EVENT, 'image/webp', 'AAAA')
    const other = await writeChatMedia(CONNECTION, OTHER_EVENT, 'image/jpeg', 'BBBB')
    await deleteChatMessages(agentWith([EVENT, OTHER_EVENT]), CONNECTION, { eventIds: [EVENT] })
    expect(mockFiles.has(chatMediaPath(CONNECTION, mine) as string)).toBe(false)
    expect(mockFiles.has(chatMediaPath(CONNECTION, other) as string)).toBe(true)
  })
})
