import type { AgentContext, DocumentLoader, DidDocument } from '@credo-ts/core'
import { isDid, vcLibraries, Key } from '@credo-ts/core'

// Import from single source of truth - @bifold/vrc-contexts
// This ensures server uses EXACTLY the same context definitions as mobile app
import {
  DTG_CONTEXT_URL,
  DTG_CONTEXT_DOCUMENT,
  RELATIONSHIP_CONTEXT_URL,
  RELATIONSHIP_CONTEXT_DOCUMENT,
  WITNESSED_EXCHANGE_CONTEXT_URL,
  WITNESSED_EXCHANGE_CONTEXT_DOCUMENT,
} from '@bifold/vrc-contexts'

/**
 * Resolve a did:key DID without using DI
 * did:key DIDs are self-describing - the public key is encoded in the DID itself
 */
function resolveDidKey(did: string): DidDocument | null {
  try {
    // Extract the multibase-encoded key from did:key:<multibase>
    const keyPart = did.replace('did:key:', '').split('#')[0]
    const key = Key.fromFingerprint(keyPart)

    const verificationMethodId = `${did}#${key.fingerprint}`

    // Build a minimal DID Document
    const didDocument = {
      '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/ed25519-2018/v1'],
      id: did,
      verificationMethod: [
        {
          id: verificationMethodId,
          type: 'Ed25519VerificationKey2018',
          controller: did,
          publicKeyBase58: key.publicKeyBase58,
        },
      ],
      authentication: [verificationMethodId],
      assertionMethod: [verificationMethodId],
      capabilityDelegation: [verificationMethodId],
      capabilityInvocation: [verificationMethodId],
    }

    return didDocument as unknown as DidDocument
  } catch {
    // Error during did:key resolution
    return null
  }
}

/**
 * Resolve a did:peer:0 DID without using DI
 * did:peer:0 is an inception key method - the key is encoded in the DID itself
 * Format: did:peer:0<multibase-encoded-key>
 */
function resolveDidPeer0(did: string): DidDocument | null {
  try {
    // Extract the multibase key from did:peer:0<multibase>
    // The '0' is the numalgo, followed by the multibase-encoded key
    const peerPart = did.replace('did:peer:', '')
    if (!peerPart.startsWith('0')) {
      return null
    }

    const keyMultibase = peerPart.substring(1) // Remove the '0' numalgo prefix
    const key = Key.fromFingerprint(keyMultibase)

    const verificationMethodId = `${did}#${key.fingerprint}`

    // Build a minimal DID Document for did:peer:0
    const didDocument = {
      '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/ed25519-2018/v1'],
      id: did,
      verificationMethod: [
        {
          id: verificationMethodId,
          type: 'Ed25519VerificationKey2018',
          controller: did,
          publicKeyBase58: key.publicKeyBase58,
        },
      ],
      authentication: [verificationMethodId],
      assertionMethod: [verificationMethodId],
    }

    return didDocument as unknown as DidDocument
  } catch {
    // Error during did:peer:0 resolution
    return null
  }
}

/**
 * Resolve a DID without using tsyringe DI
 * This handles self-describing DIDs (did:key, did:peer:0) directly
 */
async function resolveDid(did: string): Promise<{ didDocument: DidDocument | null; error?: string }> {
  const normalizedDid = did.split('#')[0]

  // did:key - self-describing, key encoded in DID
  if (normalizedDid.startsWith('did:key:')) {
    const didDocument = resolveDidKey(normalizedDid)
    return { didDocument }
  }

  // did:peer:0 - inception key, self-describing
  if (normalizedDid.startsWith('did:peer:0')) {
    const didDocument = resolveDidPeer0(normalizedDid)
    return { didDocument }
  }

  // For other DID methods, we can't resolve without DI
  // In practice, VRC/VWC flows only use did:key and did:peer:0
  return { didDocument: null, error: `Unsupported DID method: ${normalizedDid}` }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const demoDocumentLoader = (_agentContext: AgentContext): DocumentLoader => {
  // NOTE: We do NOT use DidResolverService from DI because tsyringe fails to resolve it
  // in ts-node environments. Instead, we directly resolve self-describing DIDs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jsonld = vcLibraries.jsonld as any
  const nativeLoader = jsonld.documentLoaders.node()

  const verificationMethodContexts: Record<string, string[]> = {
    Ed25519VerificationKey2018: ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/ed25519-2018/v1'],
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enrichDidDocument = (documentJson: Record<string, any>) => {
    const assertionMethods = documentJson.assertionMethod as Array<string | Record<string, unknown>> | undefined
    const authenticationMethods = documentJson.authentication as Array<string | Record<string, unknown>> | undefined

    if (
      (!assertionMethods || assertionMethods.length === 0) &&
      authenticationMethods &&
      authenticationMethods.length > 0
    ) {
      documentJson.assertionMethod = authenticationMethods.map((method) =>
        typeof method === 'string' ? method : { ...method }
      )
    }

    return documentJson
  }

  return async function documentLoader(url: string) {
    const normalizedUrl = url.split('#')[0]

    if (isDid(normalizedUrl)) {
      // Use our DI-free DID resolution for self-describing DIDs
      const result = await resolveDid(normalizedUrl)

      if (result.error || !result.didDocument) {
        throw new Error(`Unable to resolve DID: ${normalizedUrl}. ${result.error || ''}`)
      }

      const { didDocument } = result
      // Handle both DidDocument class instances and plain objects
      const documentJson = enrichDidDocument(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        typeof (didDocument as any).toJSON === 'function'
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (didDocument as any).toJSON()
          : // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (didDocument as Record<string, any>)
      )

      if (url.includes('#')) {
        const fragment = url.split('#').pop() ?? ''
        const fullId = `${normalizedUrl}#${fragment}`

        // Manually dereference the verification method from the plain document
        const verificationMethods = documentJson.verificationMethod || []
        const key = verificationMethods.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (vm: any) => vm.id === fullId || vm.id === `#${fragment}` || vm.id.endsWith(`#${fragment}`)
        )

        if (!key) {
          throw new Error(`Verification method not found: ${fullId}`)
        }

        // Add @context to the verification method if it's an Ed25519 key
        // The Ed25519Signature2018 suite requires this context on the key itself
        const keyWithContext = { ...key }
        if (key.type === 'Ed25519VerificationKey2018' && !key['@context']) {
          keyWithContext['@context'] = verificationMethodContexts['Ed25519VerificationKey2018'] || [
            'https://www.w3.org/ns/did/v1',
            'https://w3id.org/security/suites/ed25519-2018/v1',
          ]
        }

        return {
          contextUrl: null,
          documentUrl: url,
          document: keyWithContext,
        }
      }

      return {
        contextUrl: null,
        documentUrl: url,
        document: documentJson,
      }
    }

    if (normalizedUrl === RELATIONSHIP_CONTEXT_URL) {
      return {
        contextUrl: null,
        documentUrl: url,
        document: RELATIONSHIP_CONTEXT_DOCUMENT,
      }
    }

    // Handle witnessed exchange context (ToIP DTGWG spec)
    if (normalizedUrl === WITNESSED_EXCHANGE_CONTEXT_URL) {
      return {
        contextUrl: null,
        documentUrl: url,
        document: WITNESSED_EXCHANGE_CONTEXT_DOCUMENT,
      }
    }

    // Handle DTG context (from @bifold/vrc-contexts)
    if (normalizedUrl === DTG_CONTEXT_URL) {
      return {
        contextUrl: null,
        documentUrl: url,
        document: DTG_CONTEXT_DOCUMENT,
      }
    }

    if (!/^https?:/i.test(normalizedUrl)) {
      return {
        contextUrl: null,
        documentUrl: url,
        document: {
          '@id': url,
        },
      }
    }

    return nativeLoader(url)
  }.bind(this)
}
