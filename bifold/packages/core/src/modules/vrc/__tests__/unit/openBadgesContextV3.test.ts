import { createHash } from 'crypto'

import {
  OPEN_BADGES_CONTEXT_V3_DOCUMENT,
  OPEN_BADGES_CONTEXT_V3_SHA256,
  OPEN_BADGES_CONTEXT_V3_TEXT,
  OPEN_BADGES_CONTEXT_V3_URL,
} from '@bifold/vrc-contexts'

import { badgeCredential } from '../../../trust-tasks/__tests__/fixtures/badgeCredential'
import { createVrcDocumentLoader } from '../../createVrcDocumentLoader'

jest.mock('@credo-ts/core', () => {
  const actual = jest.requireActual('@credo-ts/core')
  return { ...actual, DidResolverService: jest.fn(), isDid: actual.isDid }
})

const agentContext = {
  dependencyManager: { resolve: jest.fn().mockReturnValue({ resolve: jest.fn() }) },
} as any

const OB = 'https://purl.imsglobal.org/spec/vc/ob/vocab.html#'

// jsonld ships no type declarations; read it with the one call used here typed, so this file adds no
// line to the tsc-ratchet baseline (the other jsonld suites are listed there).
const jsonld: { expand(input: unknown, options: { documentLoader: unknown }): Promise<unknown> } =
  jest.requireActual('jsonld')

describe('the Open Badges 3.0.3 context (bundled, never fetched)', () => {
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    // Every test here runs offline: a fetch is a failure, not a fallback.
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('no network in this test'))
  })

  afterEach(() => fetchSpy.mockRestore())

  it('is the published bytes: sha256 3d34f4d4…ca84, 14565 bytes', () => {
    const digest = createHash('sha256').update(OPEN_BADGES_CONTEXT_V3_TEXT, 'utf8').digest('hex')
    expect(digest).toBe('3d34f4d4ef1bce691106e63798beb5e7b862ba841423f5ee1e53ab7ddf3bca84')
    expect(OPEN_BADGES_CONTEXT_V3_SHA256).toBe(digest)
    expect(Buffer.byteLength(OPEN_BADGES_CONTEXT_V3_TEXT, 'utf8')).toBe(14565)
  })

  it('serves the parsed bytes, protected and frozen', () => {
    expect(OPEN_BADGES_CONTEXT_V3_DOCUMENT).toEqual(JSON.parse(OPEN_BADGES_CONTEXT_V3_TEXT))
    const context = OPEN_BADGES_CONTEXT_V3_DOCUMENT['@context'] as Record<string, unknown>
    expect(context['@protected']).toBe(true)
    expect(Object.isFrozen(OPEN_BADGES_CONTEXT_V3_DOCUMENT)).toBe(true)
    expect(Object.isFrozen(context)).toBe(true)
  })

  it('is the URL a community badge names (VTI vtc-service badges/credential.rs OB_CONTEXT)', () => {
    expect(OPEN_BADGES_CONTEXT_V3_URL).toBe('https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json')
    expect(badgeCredential()['@context']).toEqual(['https://www.w3.org/ns/credentials/v2', OPEN_BADGES_CONTEXT_V3_URL])
  })

  it('is resolved from the bundle, never fetched', async () => {
    const loader = createVrcDocumentLoader(agentContext)
    const result = await loader(OPEN_BADGES_CONTEXT_V3_URL)
    expect(result).toEqual({
      contextUrl: null,
      documentUrl: OPEN_BADGES_CONTEXT_V3_URL,
      document: OPEN_BADGES_CONTEXT_V3_DOCUMENT,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // Only the exact versioned URL is the bundled document: another version is another context.
  it.each([
    'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.2.json',
    'https://purl.imsglobal.org/spec/ob/v3p0/context.json',
  ])('does not serve the bundle for another Open Badges context (%s)', async (iri) => {
    const loader = createVrcDocumentLoader(agentContext)
    await expect(loader(iri)).rejects.toThrow('no network in this test')
    expect(fetchSpy).toHaveBeenCalledWith(iri)
  })

  it('expands a community badge offline, as Credo does when it stores one for the Wallet', async () => {
    const loader = createVrcDocumentLoader(agentContext)
    const expanded = (await jsonld.expand(badgeCredential() as never, { documentLoader: loader as never })) as Array<
      Record<string, any>
    >
    expect(expanded).toHaveLength(1)
    const [vc] = expanded
    expect(vc['@type']).toEqual(
      expect.arrayContaining([`${OB}OpenBadgeCredential`, 'https://www.w3.org/2018/credentials#VerifiableCredential'])
    )
    const subject = vc['https://www.w3.org/2018/credentials#credentialSubject'][0]
    expect(subject['@type']).toEqual([`${OB}AchievementSubject`])
    expect(subject[`${OB}achievement`][0]['@type']).toEqual([`${OB}Achievement`])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
