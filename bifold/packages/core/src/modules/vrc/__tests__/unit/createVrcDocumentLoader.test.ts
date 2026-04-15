import { DidResolverService, isDid } from '@credo-ts/core'

import { createVrcDocumentLoader } from '../../createVrcDocumentLoader'
import { DTG_CONTEXT_URL, DTG_CONTEXT_DOCUMENT } from '../../types/relationshipContext'
import {
  WITNESSED_EXCHANGE_CONTEXT_URL,
  WITNESSED_EXCHANGE_CONTEXT_DOCUMENT,
} from '../../types/witnessedExchangeContext'
import { CACHED_SECURITY_CONTEXTS } from '../../types/cachedSecurityContexts'

const mockResolve = jest.fn()
jest.mock('@credo-ts/core', () => {
  const actual = jest.requireActual('@credo-ts/core')
  return {
    ...actual,
    DidResolverService: jest.fn(),
    isDid: actual.isDid,
  }
})

const mockAgentContext = {
  dependencyManager: {
    resolve: jest.fn().mockReturnValue({ resolve: mockResolve }),
  },
} as any

describe('createVrcDocumentLoader', () => {
  let documentLoader: (url: string) => Promise<{ contextUrl: null; documentUrl: string; document: any }>

  beforeEach(() => {
    jest.clearAllMocks()
    documentLoader = createVrcDocumentLoader(mockAgentContext)
  })

  describe('cached security contexts', () => {
    const cachedUrls = Object.keys(CACHED_SECURITY_CONTEXTS)

    it.each(cachedUrls)('should resolve %s from local cache without network', async (url) => {
      const result = await documentLoader(url)

      expect(result).toEqual({
        contextUrl: null,
        documentUrl: url,
        document: CACHED_SECURITY_CONTEXTS[url],
      })
    })

    it('should not call fetch for cached URLs', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')

      for (const url of cachedUrls) {
        await documentLoader(url)
      }

      expect(fetchSpy).not.toHaveBeenCalled()
      fetchSpy.mockRestore()
    })

    it('should not call DID resolver for cached URLs', async () => {
      for (const url of cachedUrls) {
        await documentLoader(url)
      }

      expect(mockResolve).not.toHaveBeenCalled()
    })
  })

  describe('custom VRC contexts', () => {
    it('should resolve DTG context URL locally', async () => {
      const result = await documentLoader(DTG_CONTEXT_URL)

      expect(result).toEqual({
        contextUrl: null,
        documentUrl: DTG_CONTEXT_URL,
        document: DTG_CONTEXT_DOCUMENT,
      })
    })

    it('should resolve witnessed exchange context URL locally', async () => {
      const result = await documentLoader(WITNESSED_EXCHANGE_CONTEXT_URL)

      expect(result).toEqual({
        contextUrl: null,
        documentUrl: WITNESSED_EXCHANGE_CONTEXT_URL,
        document: WITNESSED_EXCHANGE_CONTEXT_DOCUMENT,
      })
    })
  })

  describe('HTTP fallback', () => {
    it('should fetch non-cached HTTPS URLs via network', async () => {
      const fakeDocument = { '@context': { 'id': '@id' } }
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        json: () => Promise.resolve(fakeDocument),
      } as Response)

      const url = 'https://example.com/contexts/v1'
      const result = await documentLoader(url)

      expect(fetchSpy).toHaveBeenCalledWith(url)
      expect(result).toEqual({
        contextUrl: null,
        documentUrl: url,
        document: fakeDocument,
      })
      fetchSpy.mockRestore()
    })

    it('should propagate fetch errors for unreachable URLs', async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockRejectedValueOnce(new Error('Network request failed'))

      await expect(documentLoader('https://dead-host.example/v1')).rejects.toThrow('Network request failed')
      fetchSpy.mockRestore()
    })
  })

  describe('non-HTTP URLs', () => {
    it('should return a minimal document for non-HTTP, non-DID URLs', async () => {
      const url = 'urn:example:custom'
      const result = await documentLoader(url)

      expect(result).toEqual({
        contextUrl: null,
        documentUrl: url,
        document: { '@id': url },
      })
    })
  })

  describe('DID resolution', () => {
    it('should resolve a DID through the agent DID resolver', async () => {
      const did = 'did:peer:0z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
      const mockDidDocument = {
        toJSON: () => ({
          id: did,
          authentication: [{ id: `${did}#key-1`, type: 'Ed25519VerificationKey2018', controller: did }],
        }),
      }

      mockResolve.mockResolvedValueOnce({
        didResolutionMetadata: {},
        didDocument: mockDidDocument,
      })

      const result = await documentLoader(did)

      expect(mockResolve).toHaveBeenCalledWith(mockAgentContext, did)
      expect(result.documentUrl).toBe(did)
      expect(result.document.id).toBe(did)
      // enrichDidDocument should copy authentication → assertionMethod
      expect(result.document.assertionMethod).toBeDefined()
      expect(result.document.assertionMethod).toHaveLength(1)
    })

    it('should throw when DID resolution fails', async () => {
      const did = 'did:peer:0z6MknGc3ocHs3zdPiJbnaaqDi58NGb4pk1Sp9WNhJhvaFed'

      mockResolve.mockResolvedValueOnce({
        didResolutionMetadata: { error: 'notFound' },
        didDocument: null,
      })

      await expect(documentLoader(did)).rejects.toThrow(`Unable to resolve DID: ${did}`)
    })

    it('should dereference a DID fragment to a verification method', async () => {
      const did = 'did:peer:0z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
      const fragmentUrl = `${did}#key-1`
      const mockKey = {
        id: `${did}#key-1`,
        type: 'Ed25519VerificationKey2018',
        controller: did,
        publicKeyBase58: 'abc123',
      }
      const mockDidDocument = {
        toJSON: () => ({ id: did }),
        dereferenceKey: jest.fn().mockReturnValue(mockKey),
      }

      mockResolve.mockResolvedValueOnce({
        didResolutionMetadata: {},
        didDocument: mockDidDocument,
      })

      const result = await documentLoader(fragmentUrl)

      expect(mockDidDocument.dereferenceKey).toHaveBeenCalledWith('#key-1')
      expect(result.documentUrl).toBe(fragmentUrl)
      expect(result.document.id).toBe(mockKey.id)
      expect(result.document.type).toBe('Ed25519VerificationKey2018')
      expect(result.document.publicKeyBase58).toBe('abc123')
      expect(result.document['@context']).toBeDefined()
    })
  })

  describe('resolution priority', () => {
    it('should prefer cached contexts over HTTP fetch', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
      const url = 'https://w3id.org/security/suites/ed25519-2018/v1'

      const result = await documentLoader(url)

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(result.document).toBe(CACHED_SECURITY_CONTEXTS[url])
      fetchSpy.mockRestore()
    })

    it('should prefer custom VRC contexts over cached security contexts', async () => {
      const result = await documentLoader(DTG_CONTEXT_URL)
      expect(result.document).toBe(DTG_CONTEXT_DOCUMENT)
    })

    it('should prefer DID resolution over everything for did: URLs', async () => {
      const did = 'did:example:123'
      const mockDidDocument = {
        toJSON: () => ({ id: did, authentication: [] }),
      }
      mockResolve.mockResolvedValueOnce({
        didResolutionMetadata: {},
        didDocument: mockDidDocument,
      })

      const result = await documentLoader(did)
      expect(result.document.id).toBe(did)
    })
  })
})
