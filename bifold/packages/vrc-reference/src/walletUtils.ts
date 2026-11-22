import * as fs from 'fs'

import { greenText, purpleText } from './OutputClass'
import { getWalletDir, WALLET_BASE_PATH } from '@bifold/vrc-shared'

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
    console.log(greenText(`[${walletId}] Wallet deleted for fresh start`))
    return true
  }
  return false
}

/**
 * Delete all demo wallets (alice, bob, witness)
 */
export function deleteAllWallets(): void {
  const wallets = ['alice', 'bob', 'witness']
  console.log(purpleText('\n=== Cleaning up all wallets ==='))
  console.log(purpleText(`Wallet base path: ${WALLET_BASE_PATH}\n`))

  for (const wallet of wallets) {
    if (deleteWallet(wallet)) {
      // Already logged
    } else {
      console.log(purpleText(`[${wallet}] No existing wallet found`))
    }
  }
  console.log(greenText('\n✓ All wallets cleaned up\n'))
}

/**
 * Parse command line arguments for --fresh flag
 */
export function shouldUseFresh(): boolean {
  return process.argv.includes('--fresh') || process.argv.includes('-f')
}

/**
 * Run the "fresh all" command
 */
if (require.main === module) {
  deleteAllWallets()
}
