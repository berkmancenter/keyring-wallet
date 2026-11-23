import * as path from 'path'

/**
 * Configuration for the VRC demo
 *
 * Wallet storage path can be overridden via environment variable:
 *   VRC_WALLET_PATH=/custom/path yarn alice
 */

/**
 * Base path for wallet storage
 * Default: ./.wallets (local to the project)
 * Override: VRC_WALLET_PATH environment variable
 */
export const WALLET_BASE_PATH = process.env.VRC_WALLET_PATH || path.join(process.cwd(), '.wallets')

/**
 * Get the full storage path for a specific wallet (including the sqlite.db filename)
 * Askar expects the full path to the database file
 */
export function getWalletStoragePath(walletId: string): string {
  return path.join(WALLET_BASE_PATH, walletId, 'sqlite.db')
}

/**
 * Get the wallet directory (for deletion purposes)
 */
export function getWalletDir(walletId: string): string {
  return path.join(WALLET_BASE_PATH, walletId)
}
