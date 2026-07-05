/**
 * Document loader for W3C Verifiable Relationship Credentials (VRC)
 *
 * Handles DID resolution, custom VRC contexts, and HTTP fallback
 * for JSON-LD signature creation and verification.
 */
import type { AgentContext, VerificationMethod } from '@credo-ts/core'
import { DidResolverService, isDid } from '@credo-ts/core'

import {
  DTG_CONTEXT_URL,
  DTG_CONTEXT_DOCUMENT,
  RELATIONSHIP_CONTEXT_URL,
  RELATIONSHIP_CONTEXT_DOCUMENT,
} from './types/relationshipContext'
import {
  WITNESSED_EXCHANGE_CONTEXT_URL,
  WITNESSED_EXCHANGE_CONTEXT_DOCUMENT,
} from './types/witnessedExchangeContext'
import { CACHED_SECURITY_CONTEXTS } from './types/cachedSecurityContexts'

/**
 * Maps verification method types to their required JSON-LD contexts
 */
const VERIFICATION_METHOD_CONTEXTS: Record<string, string[]> = {
  Ed25519VerificationKey2018: ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/ed25519-2018/v1'],
}

/**
 * Converts a VerificationMethod to a plain JSON object suitable for JSON-LD processing
 */
function toPlainVerificationMethod(key: VerificationMethod): Record<string, unknown> {
  const plain: Record<string, unknown> = {
    id: key.id,
    type: key.type,
    controller: key.controller,
  }

  if (VERIFICATION_METHOD_CONTEXTS[key.type]) {
    plain['@context'] = VERIFICATION_METHOD_CONTEXTS[key.type]
  }

  if (key.publicKeyBase58) plain.publicKeyBase58 = key.publicKeyBase58
  if (key.publicKeyBase64) plain.publicKeyBase64 = key.publicKeyBase64
  if (key.publicKeyHex) plain.publicKeyHex = key.publicKeyHex
  if (key.publicKeyPem) plain.publicKeyPem = key.publicKeyPem
  if (key.publicKeyMultibase) plain.publicKeyMultibase = key.publicKeyMultibase
  if (key.publicKeyJwk) plain.publicKeyJwk = key.publicKeyJwk

  return plain
}

/**
 * Enriches a DID document by copying authentication methods to assertionMethod if missing.
 * Needed because some DID methods (like did:peer:0) don't explicitly include assertionMethod.
 */
function enrichDidDocument(documentJson: Record<string, any>): Record<string, any> {
  const assertionMethods = documentJson.assertionMethod as Array<string | Record<string, unknown>> | undefined
  const authenticationMethods = documentJson.authentication as Array<string | Record<string, unknown>> | undefined

  if ((!assertionMethods || assertionMethods.length === 0) && authenticationMethods?.length) {
    documentJson.assertionMethod = authenticationMethods.map((m) => (typeof m === 'string' ? m : { ...m }))
  }

  return documentJson
}

/**
 * Creates a document loader function for W3C credentials module.
 * Handles DID resolution, custom VRC contexts, and HTTP fallback.
 *
 * @param agentContext - The agent context containing dependency manager
 * @returns A document loader function that resolves URLs to JSON-LD documents
 *
 * @example
 * ```typescript
 * w3cCredentials: new W3cCredentialsModule({
 *   documentLoader: createVrcDocumentLoader,
 * }),
 * ```
 */
export function createVrcDocumentLoader(agentContext: AgentContext) {
  const didResolver = agentContext.dependencyManager.resolve(DidResolverService)

  return async (url: string) => {
    const normalizedUrl = url.split('#')[0]

    // Handle DID resolution (including fragment dereference)
    if (isDid(normalizedUrl)) {
      const result = await didResolver.resolve(agentContext, normalizedUrl)

      if (result.didResolutionMetadata.error || !result.didDocument) {
        throw new Error(`Unable to resolve DID: ${normalizedUrl}`)
      }

      const { didDocument } = result
      const documentJson = enrichDidDocument(didDocument.toJSON())

      // Handle fragment (e.g., did:peer:0z...#key-1)
      if (url.includes('#')) {
        const fragment = `#${url.split('#').pop() ?? ''}`
        const key = didDocument.dereferenceKey(fragment)
        return {
          contextUrl: null,
          documentUrl: url,
          document: toPlainVerificationMethod(key),
        }
      }

      return {
        contextUrl: null,
        documentUrl: url,
        document: documentJson,
      }
    }

    // Handle custom VRC context URLs
    if (url === DTG_CONTEXT_URL) {
      return { contextUrl: null, documentUrl: url, document: DTG_CONTEXT_DOCUMENT }
    }
    if (url === RELATIONSHIP_CONTEXT_URL) {
      return { contextUrl: null, documentUrl: url, document: RELATIONSHIP_CONTEXT_DOCUMENT }
    }
    if (url === WITNESSED_EXCHANGE_CONTEXT_URL) {
      return { contextUrl: null, documentUrl: url, document: WITNESSED_EXCHANGE_CONTEXT_DOCUMENT }
    }

    // Handle well-known W3C/DID/security contexts locally to avoid
    // network dependencies on mobile (w3id.org redirects can be unreliable)
    if (CACHED_SECURITY_CONTEXTS[url]) {
      return { contextUrl: null, documentUrl: url, document: CACHED_SECURITY_CONTEXTS[url] }
    }

    // Handle non-HTTP URLs (return minimal document)
    if (!/^https?:/i.test(normalizedUrl)) {
      return { contextUrl: null, documentUrl: url, document: { '@id': url } }
    }

    // Fallback: fetch remote context via HTTP
    const response = await fetch(url)
    const document = await response.json()
    return { contextUrl: null, documentUrl: url, document }
  }
}
