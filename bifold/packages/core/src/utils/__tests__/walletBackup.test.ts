import RNFS from 'react-native-fs'

import { removeWalletBackups, sweepStaleWalletBackups, WALLET_BACKUP_MAX_AGE_MS } from '../walletBackup'

jest.mock('react-native-fs', () => ({
  CachesDirectoryPath: '/caches',
  readDir: jest.fn(),
  unlink: jest.fn(async () => undefined),
}))

const now = Date.UTC(2026, 9, 25, 12, 0, 0)
const hour = 60 * 60 * 1000
const dir = (name: string) => ({ name, path: `/caches/${name}`, isDirectory: () => true })
const caches = [
  dir(`wallet-backup-${now - 25 * hour}`),
  dir(`wallet-backup-${now - 23 * hour}`),
  dir(`wallet-backup-${now - 72 * hour}`),
  dir('community-logos'),
  dir('wallet-backup-notes'),
  {
    name: `wallet-backup-${now - 48 * hour}`,
    path: `/caches/wallet-backup-${now - 48 * hour}`,
    isDirectory: () => false,
  },
]
const removed = () => (RNFS.unlink as jest.Mock).mock.calls.map((c) => c[0])

describe('wallet backups under the caches', () => {
  beforeEach(() => {
    ;(RNFS.readDir as jest.Mock).mockResolvedValue(caches)
  })
  afterEach(() => jest.clearAllMocks())

  test('app start removes the backup folders older than a day, and nothing else', async () => {
    await sweepStaleWalletBackups(now)
    expect(WALLET_BACKUP_MAX_AGE_MS).toBe(24 * hour)
    expect(removed().sort()).toEqual(
      [`/caches/wallet-backup-${now - 25 * hour}`, `/caches/wallet-backup-${now - 72 * hour}`].sort()
    )
  })

  test('a new export removes every backup folder, whatever its age, and nothing else', async () => {
    await removeWalletBackups()
    expect(removed().sort()).toEqual(
      [
        `/caches/wallet-backup-${now - 23 * hour}`,
        `/caches/wallet-backup-${now - 25 * hour}`,
        `/caches/wallet-backup-${now - 72 * hour}`,
      ].sort()
    )
  })

  test('a caches folder that cannot be read, or a folder that cannot be removed, is not an error', async () => {
    ;(RNFS.readDir as jest.Mock).mockRejectedValueOnce(new Error('no caches'))
    await expect(sweepStaleWalletBackups(now)).resolves.toBeUndefined()
    ;(RNFS.unlink as jest.Mock).mockRejectedValue(new Error('busy'))
    await expect(sweepStaleWalletBackups(now)).resolves.toBeUndefined()
  })
})
