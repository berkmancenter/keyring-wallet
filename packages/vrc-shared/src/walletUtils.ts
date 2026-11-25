import * as fs from 'fs'

import { getWalletDir, WALLET_BASE_PATH } from './config'

// Re-export WALLET_BASE_PATH so it can be imported by other modules
export { WALLET_BASE_PATH }

/**
 * Get the wallet directory path for a given wallet ID
 */
export function getWalletPath(walletId: string): string {
  return getWalletDir(walletId)
}

/**
 * Check if a wallet exists
 */
export function walletExists(walletId: string): boolean {
  const walletPath = getWalletPath(walletId)
  return fs.existsSync(walletPath)
}

/**
 * Delete a wallet directory
 */
export function deleteWallet(walletId: string): boolean {
  const walletPath = getWalletPath(walletId)
  if (fs.existsSync(walletPath)) {
    fs.rmSync(walletPath, { recursive: true, force: true })
    return true
  }
  return false
}

/**
 * Parse command line arguments for --fresh flag
 */
export function shouldUseFresh(): boolean {
  return process.argv.includes('--fresh') || process.argv.includes('-f')
}
