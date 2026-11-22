import { createHash } from 'crypto'
import jsonld from 'jsonld'

import {
  DTG_REGISTRY_CONTEXT_V1_DOCUMENT,
  DTG_REGISTRY_CONTEXT_V1_SHA256,
  DTG_REGISTRY_CONTEXT_V1_TEXT,
  DTG_REGISTRY_CONTEXT_V1_URL,
} from '@bifold/vrc-contexts'

import { createVrcDocumentLoader } from '../../createVrcDocumentLoader'

// The registry's own worked examples (trustoverip/dtgwg-vsc-registry 0d309410,
// predicates/vetted/1/examples/video-vetting.json and
// predicates/witnessed/1/examples/witnessed-vrc.json), unchanged. Their proofs
// are illustrative; these tests are about the context, not the signatures.
import vettedExample from '../fixtures/dtg-registry-v1/vetted-1-video-vetting.json'
import witnessedExample from '../fixtures/dtg-registry-v1/witnessed-1-vrc.json'

jest.mock('@credo-ts/core', () => {
  const actual = jest.requireActual('@credo-ts/core')
  return { ...actual, DidResolverService: jest.fn(), isDid: actual.isDid }
})

const agentContext = {
  dependencyManager: { resolve: jest.fn().mockReturnValue({ resolve: jest.fn() }) },
} as any

const DTG = 'https://registry.trustoverip.org/dtg/credentials#'

describe('the DTG Credentials v1 context (registry, frozen)', () => {
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    // Every test here runs offline: a fetch is a failure, not a fallback.
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('no network in this test'))
  })

  afterEach(() => fetchSpy.mockRestore())

  it('is the published v1 bytes: sha256 3e1376ac…b448, as the cred-spec states', () => {
    const digest = createHash('sha256').update(DTG_REGISTRY_CONTEXT_V1_TEXT, 'utf8').digest('hex')
    expect(digest).toBe('3e1376acf401016a0162c1cdb31e44a85a7dd56749caed94a1dc0a0be6cbb448')
    expect(DTG_REGISTRY_CONTEXT_V1_SHA256).toBe(digest)
  })

  it('serves the parsed bytes, protected and frozen', () => {
    expect(DTG_REGISTRY_CONTEXT_V1_DOCUMENT).toEqual(JSON.parse(DTG_REGISTRY_CONTEXT_V1_TEXT))
    const context = DTG_REGISTRY_CONTEXT_V1_DOCUMENT['@context'] as Record<string, unknown>
    expect(context['@protected']).toBe(true)
    expect(Object.isFrozen(DTG_REGISTRY_CONTEXT_V1_DOCUMENT)).toBe(true)
    expect(Object.isFrozen(context)).toBe(true)
  })

  it('is resolved from the bundle, never fetched', async () => {
    const loader = createVrcDocumentLoader(agentContext)
    const result = await loader(DTG_REGISTRY_CONTEXT_V1_URL)
    expect(result).toEqual({
      contextUrl: null,
      documentUrl: DTG_REGISTRY_CONTEXT_V1_URL,
      document: DTG_REGISTRY_CONTEXT_V1_DOCUMENT,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // The spec compares the IRI byte-exact (dtg-credentials 0.12.0 rejects the
  // `www.` and trailing-slash spellings): only the exact URL is the bundled one.
  it.each(['https://www.registry.trustoverip.org/dtg/context/v1', 'https://registry.trustoverip.org/dtg/context/v1/'])(
    'does not serve the bundle for a near-miss IRI (%s)',
    async (iri) => {
      const loader = createVrcDocumentLoader(agentContext)
      await expect(loader(iri)).rejects.toThrow('no network in this test')
      expect(fetchSpy).toHaveBeenCalledWith(iri)
    }
  )

  it.each([
    ['a vetted/1 statement', vettedExample, 'https://registry.trustoverip.org/dtg/vsc/vetted/1'],
    ['a witnessed/1 statement', witnessedExample, 'https://registry.trustoverip.org/dtg/vsc/witnessed/1'],
  ])('expands %s offline, as Credo does when it stores a card', async (_name, example, predicate) => {
    const loader = createVrcDocumentLoader(agentContext)
    const expanded = (await jsonld.expand(example as never, { documentLoader: loader as never })) as Array<
      Record<string, any>
    >
    expect(expanded).toHaveLength(1)
    const [vc] = expanded
    expect(vc['@type']).toEqual(
      expect.arrayContaining([
        `${DTG}DTGCredential`,
        `${DTG}StatementCredential`,
        'https://www.w3.org/2018/credentials#VerifiableCredential',
      ])
    )
    expect(vc[`${DTG}issuerScope`]).toBeDefined()
    expect(vc[`${DTG}taskContext`]).toBeDefined()
    const subject = vc['https://www.w3.org/2018/credentials#credentialSubject'][0]
    expect(subject[`${DTG}predicate`]).toEqual([{ '@id': predicate }])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
