#!/usr/bin/env ts-node
/**
 * Cleanup script for witness-server wallet and persisted files
 * 
 * Usage:
 *   yarn fresh        - Delete wallet and persisted files
 *   yarn start:fresh  - Fresh wallet and start
 */

import * as fs from 'fs'
import * as path from 'path'

// Import shared wallet utilities
import { deleteWallet as deleteWalletUtil, walletExists, WALLET_BASE_PATH } from '@bifold/vrc-shared'
import { loadConfig } from './config'

/**
 * Delete the witness-server wallet using shared utilities
 */
function deleteWallet(): boolean {
  const config = loadConfig()
  const walletId = `${config.name}-wallet`
  
  if (walletExists(walletId)) {
    deleteWalletUtil(walletId)
    return true
  } else {
    console.log(`  No wallet found for: ${walletId}`)
    console.log(`  Expected location: ${WALLET_BASE_PATH}/${walletId}`)
    return false
  }
}

/**
 * Delete persisted files
 */
function deletePersistedFiles(): void {
  const files = [
    '.oob-invitation.json',
    '.witness-seed.json',
  ]

  console.log('\nCleaning up persisted files...')
  for (const file of files) {
    const filePath = path.join(process.cwd(), file)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      console.log(`✓ Deleted ${file}`)
    } else {
      console.log(`  No file found: ${file}`)
    }
  }
}

/**
 * Main cleanup function
 */
function cleanAll(): void {
  console.log('\n╔═══════════════════════════════════════════════════════╗')
  console.log('║     WITNESS SERVER - CLEANING WALLET & FILES         ║')
  console.log('╚═══════════════════════════════════════════════════════╝\n')

  deleteWallet()
  deletePersistedFiles()

  console.log('\n✓ Witness server cleanup complete!')
  console.log('  Next startup will be completely fresh.\n')
}

// Run if executed directly
if (require.main === module) {
  cleanAll()
}

export { cleanAll, deleteWallet, deletePersistedFiles }