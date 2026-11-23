/**
 * The day-old bound on shared wallet backups holds in any app built on bifold, because MainContainer.init() runs the
 * sweep: the wallet builds its own App, not createApp, but makes its container there (on every render, so only the
 * first init sweeps).
 */
import RNFS from 'react-native-fs'
import { container } from 'tsyringe'

import { MainContainer } from '../src/container-impl'

jest.mock('react-native-fs', () => ({
  CachesDirectoryPath: '/caches',
  readDir: jest.fn(async () => [
    { name: 'wallet-backup-1000', path: '/caches/wallet-backup-1000', isDirectory: () => true },
  ]),
  unlink: jest.fn(async () => undefined),
}))

test('the first container init sweeps day-old wallet backups, and later inits do not', async () => {
  new MainContainer(container.createChildContainer()).init()
  new MainContainer(container.createChildContainer()).init()
  await new Promise((resolve) => setImmediate(resolve))

  expect(RNFS.readDir).toHaveBeenCalledTimes(1)
  expect(RNFS.readDir).toHaveBeenCalledWith('/caches')
  expect(RNFS.unlink).toHaveBeenCalledWith('/caches/wallet-backup-1000')
})
