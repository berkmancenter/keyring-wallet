import { Agent, W3cCredentialRecord } from '@credo-ts/core'
import { DidCommConnectionRecord } from '@credo-ts/didcomm'
import { isDTGCredential, isRelationshipCredential } from '../credentialTypes'
import { RelationshipDidRepository } from '../repositories/RelationshipDidRepository'
import { resolveContactDisplayInfo, toRawCredential } from './rcardDisplayUtils'

/**
 * Extract issuer information from a W3C credential
 * 
 * @param credential - The W3C credential record
 * @returns Object containing issuer id and optional name, or null if extraction fails
 */
export function extractIssuerFromCredential(credential: W3cCredentialRecord): { id: string; name?: string } | null {
  try {
    const issuerValue = toRawCredential(credential)?.issuer

    // Handle issuer as string
    if (typeof issuerValue === 'string') {
      return { id: issuerValue }
    }

    // Handle issuer as object with id property
    if (issuerValue && typeof issuerValue === 'object' && 'id' in issuerValue) {
      return {
        id: issuerValue.id,
        name: issuerValue.name || undefined,
      }
    }
  } catch (_error) {
    // Silently fail - caller will handle missing data
  }

  return null
}

/**
 * Check if a W3C credential is a VRC (Verifiable Relationship Credential)
 * 
 * @param credential - The W3C credential record to check
 * @returns true if the credential is a VRC, false otherwise
 */
export function isVrcCredential(credential: W3cCredentialRecord): boolean {
  try {
    const raw = toRawCredential(credential)
    if (raw) {
      // Check for RelationshipCredential or DTGCredential types
      return isRelationshipCredential(raw) || isDTGCredential(raw)
    }
  } catch (_error) {
    // Silently fail
  }

  return false
}

/**
 * Get the VRC name for a connection by looking up the counterparty's relationship DID
 * and finding the matching W3C credential with issuer.name
 * 
 * @param agent - The Credo agent instance
 * @param connectionId - The connection ID to look up
 * @param w3cCredentialRecords - Array of W3C credential records to search
 * @returns The issuer name from the VRC, or null if not found
 */
export async function getVrcNameForConnection(
  agent: Agent | null | undefined,
  connectionId: string | undefined,
  w3cCredentialRecords: W3cCredentialRecord[]
): Promise<string | null> {
  if (!agent || !connectionId) {
    return null
  }

  try {
    // Get the relationship DID repository
    const repository = agent.dependencyManager.resolve(RelationshipDidRepository)
    
    // Find the relationship record for this connection
    const allRecords = await repository.getAll(agent.context)
    const relationshipRecord = allRecords.find((r) => r.connectionId === connectionId)

    if (!relationshipRecord?.counterpartyRelationshipDid) {
      return null
    }

    const counterpartyRelationshipDid = relationshipRecord.counterpartyRelationshipDid

    // Resolve display name: received RCard first, then the legacy VRC
    // issuer.name (pre-RCard-separation exchanges)
    const displayInfo = resolveContactDisplayInfo(w3cCredentialRecords, counterpartyRelationshipDid)
    if (displayInfo.name) {
      return displayInfo.name
    }
  } catch (_error) {
    // Silently fail - caller will use fallback name
  }

  return null
}

/**
 * Synchronously get VRC name from a connection record if it was previously cached in metadata
 * This is a fallback for non-React contexts where hooks cannot be used
 * 
 * @param connection - The connection record
 * @returns The cached VRC name, or null if not available
 */
export function getVrcNameFromConnectionMetadata(connection: DidCommConnectionRecord | undefined): string | null {
  if (!connection) {
    return null
  }

  try {
    const vrcMetadata = connection.metadata.get('vrcName') as { name?: string } | undefined
    return vrcMetadata?.name || null
  } catch (_error) {
    // Silently fail
  }

  return null
}

/**
 * Store VRC name in connection metadata for faster synchronous access
 * This should be called when a VRC is received/processed
 * 
 * @param agent - The Credo agent instance
 * @param connectionId - The connection ID
 * @param vrcName - The VRC name to cache
 */
export async function cacheVrcNameInConnection(
  agent: Agent,
  connectionId: string,
  vrcName: string
): Promise<void> {
  try {
    const connection = await agent.modules.didcomm.connections.getById(connectionId)
    await connection.metadata.set('vrcName', { name: vrcName })
    // Credo auto-persists metadata changes
  } catch (_error) {
    // Silently fail - caching is optional optimization
  }
}
