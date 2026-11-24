import { rmSync } from 'fs'

import { resolveConfig, walletFilePath } from './config'

/**
 * Delete the mediator's askar store so the next boot starts with no
 * connections and no queued messages. `MEDIATOR_PUBLIC_URL` is not used for
 * anything here, but `resolveConfig` requires it, so allow a placeholder —
 * wiping a wallet should not need a running tunnel.
 */
const config = resolveConfig({ ...process.env, MEDIATOR_PUBLIC_URL: process.env.MEDIATOR_PUBLIC_URL || 'http://unused' })

for (const path of [walletFilePath(config), `${walletFilePath(config)}-shm`, `${walletFilePath(config)}-wal`]) {
  rmSync(path, { force: true })
}

console.log(`[mediator] wallet cleared: ${walletFilePath(config)}`)
