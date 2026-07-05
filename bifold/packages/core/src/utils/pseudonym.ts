/**
 * Pseudonym utility for generating deterministic names from reporting DIDs
 *
 * Uses the `unique-names-generator` package to create friendly pseudonyms
 * that are consistent for the same reporting DID (deterministic).
 * 
 * Adapted from witness-server for use in the React Native app.
 */

import { Hasher } from '@credo-ts/core'
import { uniqueNamesGenerator, Config } from 'unique-names-generator'
import { pseudonymAdjectives, pseudonymNouns } from './pseudonym-dictionaries'

/**
 * Dictionary configuration for pseudonyms
 * Uses adjectives and names for friendly identifiers like "Creative Alice"
 */
const PSEUDONYM_DICTS: Config['dictionaries'] = [pseudonymAdjectives, pseudonymNouns]

/**
 * Convert Uint8Array to hex string
 */
function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generate a deterministic pseudonym from a reporting DID
 *
 * The same DID will always produce the same pseudonym because we seed
 * the random generator with a hash of the DID string.
 *
 * @param reportingDid - The did:peer reporting DID
 * @returns A friendly pseudonym like "Creative Alice"
 */
export const generatePseudonym = (reportingDid: string): string => derivePseudonym(reportingDid)

export function derivePseudonym(reportingDid: string): string {
  // Use Hasher to create a numeric seed from the DID
  const hash = uint8ArrayToHex(Hasher.hash(reportingDid, 'sha-256'))
  // Use the first 8 characters as a seed value
  const seed = parseInt(hash.substring(0, 8), 16)
  
  // Generate pseudonym with seeded randomness
  return uniqueNamesGenerator({ 
    dictionaries: PSEUDONYM_DICTS, 
    separator: ' ', 
    length: 2, 
    seed 
  })
}

/**
 * Truncate a DID for compact display
 *
 * @param did - The DID string
 * @param prefixLength - Number of characters to keep from the start
 * @param suffixLength - Number of characters to keep from the end
 * @returns Truncated DID like "did:peer:0z...xMkq"
 */
export function truncateDid(did: string, prefixLength: number = 20, suffixLength: number = 4): string {
  if (did.length <= prefixLength + suffixLength) {
    return did
  }
  return `${did.substring(0, prefixLength)}...${did.substring(did.length - suffixLength)}`
}
