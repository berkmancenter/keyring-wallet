import { Agent, ConnectionRecord, W3cCredentialRecord } from '@credo-ts/core'
import { RelationshipDidRepository } from '../repositories/RelationshipDidRepository'

/**
 * Extract issuer information from a W3C credential
 * 
 * @param credential - The W3C credential record
 * @returns Object containing issuer id and optional name, or null if extraction fails
 */
export function extractIssuerFromCredential(credential: W3cCredentialRecord): { id: string; name?: string } | null {
  try {
    const credentialData = credential.credential

    if (
      credentialData &&
      typeof credentialData === 'object' &&
      !Array.isArray(credentialData) &&
      'issuer' in credentialData
    ) {
      const issuerValue = (credentialData as any).issuer

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
    }
  } catch (error) {
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
    const credentialData = credential.credential

    if (
      credentialData &&
      typeof credentialData === 'object' &&
      !Array.isArray(credentialData) &&
      'type' in credentialData
    ) {
      const typeValue = (credentialData as any).type
      const types = Array.isArray(typeValue) ? typeValue : [typeValue]
      
      // Check for RelationshipCredential or DTGCredential types
      return types.some((type: any) => 
        typeof type === 'string' && 
        (type.includes('RelationshipCredential') || type.includes('DTGCredential'))
      )
    }
  } catch (error) {
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

    // Find the W3C credential issued by the counterparty's relationship DID
    const matchingCredential = w3cCredentialRecords.find((cred) => {
      // Only check VRC credentials
      if (!isVrcCredential(cred)) {
        return false
      }

      const issuer = extractIssuerFromCredential(cred)
      return issuer?.id === counterpartyRelationshipDid
    })

    if (matchingCredential) {
      const issuer = extractIssuerFromCredential(matchingCredential)
      return issuer?.name || null
    }
  } catch (error) {
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
export function getVrcNameFromConnectionMetadata(connection: ConnectionRecord | undefined): string | null {
  if (!connection) {
    return null
  }

  try {
    const vrcMetadata = connection.metadata.get('vrcName') as { name?: string } | undefined
    return vrcMetadata?.name || null
  } catch (error) {
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
    const connection = await agent.connections.getById(connectionId)
    await connection.metadata.set('vrcName', { name: vrcName })
    // Credo auto-persists metadata changes
  } catch (error) {
    // Silently fail - caching is optional optimization
  }
}
