import { ClaimFormat, JsonTransformer, W3cCredentialRecord } from '@credo-ts/core'
import { DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL } from '../types/relationshipContext'

/**
 * Parameters for creating a DTG credential
 * Mirrors the actual W3C credential structure
 */
export interface CreateDTGCredentialParams {
  issuer: {
    id: string
    name: string
    email?: string
    organization?: string
  }
  credentialSubject: {
    id: string
  }
  validFrom?: string
  id?: string
  createdAt?: string
  updatedAt?: string
}

/**
 * Generate a deterministic test DID based on a name
 * Returns a did:peer:2 format DID for consistency with the system
 */
export function generateTestDid(name: string): string {
  // Create a simple hash from the name for consistency
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    const char = name.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  const hashStr = Math.abs(hash).toString(16).padStart(8, '0')
  return `did:peer:2.Ez6LSms${hashStr}${name.substring(0, 3).toLowerCase()}`
}

/**
 * Generate a random UUID for credential IDs
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Preset test contacts for common testing scenarios
 */
export const TEST_CONTACTS = {
  alice: {
    issuer: {
      id: generateTestDid('alice'),
      name: 'Alice Smith',
      email: 'alice@example.com',
      organization: 'Tech Corp',
    },
  },
  bob: {
    issuer: {
      id: generateTestDid('bob'),
      name: 'Bob Jones',
      email: 'bob@example.org',
    },
  },
  charlie: {
    issuer: {
      id: generateTestDid('charlie'),
      name: 'Charlie Wilson',
      organization: 'Wilson Industries',
    },
  },
  diana: {
    issuer: {
      id: generateTestDid('diana'),
      name: 'Diana Martinez',
    },
  },
  faber: {
    issuer: {
      id: generateTestDid('faber'),
      name: 'Faber College',
      email: 'contact@faber.edu',
      organization: 'Faber College',
    },
  },
  bestbc: {
    issuer: {
      id: generateTestDid('bestbc'),
      name: 'BestBC Tea',
      organization: 'BestBC Tea Company',
    },
  },
}

/**
 * Create a DTG credential (RelationshipCredential) as a W3cCredentialRecord
 * This mirrors the actual credential structure created by the VRC manager
 */
export function createDTGCredential(params: CreateDTGCredentialParams): W3cCredentialRecord {
  const id = params.id || `urn:uuid:${generateUUID()}`
  const validFrom = params.validFrom || new Date().toISOString()
  const createdAt = params.createdAt || new Date().toISOString()
  const updatedAt = params.updatedAt || createdAt

  // Build issuer object with all available properties
  const issuer: Record<string, string> = {
    id: params.issuer.id,
    name: params.issuer.name,
  }
  if (params.issuer.email) {
    issuer.email = params.issuer.email
  }
  if (params.issuer.organization) {
    issuer.organization = params.issuer.organization
  }

  const credentialData = {
    _tags: {
      claimFormat: ClaimFormat.LdpVc,
      contexts: ['https://www.w3.org/ns/credentials/v2', DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL],
      types: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
      expandedTypes: [
        'https://www.w3.org/2018/credentials#VerifiableCredential',
        'https://www.firstperson.network/dtg#DTGCredential',
        'https://www.firstperson.network/relationship#RelationshipCredential',
      ],
      issuerId: params.issuer.id,
    },
    type: 'W3cCredentialRecord',
    id,
    createdAt,
    updatedAt,
    credential: {
      '@context': ['https://www.w3.org/ns/credentials/v2', DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL],
      type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
      issuer,
      validFrom,
      credentialSubject: {
        id: params.credentialSubject.id,
      },
      // Mock proof - not used in tests but needed for completeness
      proof: {
        type: 'Ed25519Signature2018',
        created: validFrom,
        proofPurpose: 'assertionMethod',
        verificationMethod: `${params.issuer.id}#key-1`,
        jws: 'mock-jws-signature',
      },
    },
  }

  return JsonTransformer.fromJSON(credentialData, W3cCredentialRecord)
}

/**
 * Create multiple DTG credentials, useful for testing grouping and sorting
 */
export function createMultipleDTGCredentials(credentialParams: CreateDTGCredentialParams[]): W3cCredentialRecord[] {
  return credentialParams.map((params) => createDTGCredential(params))
}

/**
 * Create test credentials with a shared counterparty (the credential holder)
 * This simulates a user's wallet with credentials from multiple issuers
 */
export function createTestCredentialsForHolder(
  holderDid: string,
  issuers: Array<{ issuer: { id: string; name: string }; validFrom?: string }>
): W3cCredentialRecord[] {
  return issuers.map(({ issuer, validFrom }) =>
    createDTGCredential({
      issuer,
      credentialSubject: { id: holderDid },
      validFrom,
    })
  )
}

/**
 * Create multiple credentials from the same issuer at different times
 * Useful for testing the "most recent credential" grouping logic
 */
export function createCredentialsFromSameIssuer(
  issuer: { id: string; name: string },
  holderDid: string,
  count: number,
  startDate?: Date
): W3cCredentialRecord[] {
  const baseDate = startDate || new Date('2024-01-01T00:00:00Z')
  const credentials: W3cCredentialRecord[] = []

  for (let i = 0; i < count; i++) {
    const date = new Date(baseDate)
    date.setDate(date.getDate() + i * 7) // One week apart

    credentials.push(
      createDTGCredential({
        issuer,
        credentialSubject: { id: holderDid },
        validFrom: date.toISOString(),
      })
    )
  }

  return credentials
}
