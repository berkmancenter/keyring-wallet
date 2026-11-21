/**
 * The witness server's loader (@bifold/vrc-shared) serves the DTG Credentials
 * v1 context from the bundle, so the server can verify and sign statements
 * under it (witnessed/1 from VTI 0.47.0 on) without reaching the registry.
 */
import { createHash } from 'crypto'
import { vcLibraries } from '@credo-ts/core'

import {
  CREDENTIALS_V2_CONTEXT_DOCUMENT,
  CREDENTIALS_V2_CONTEXT_URL,
  DTG_REGISTRY_CONTEXT_V1_DOCUMENT,
  DTG_REGISTRY_CONTEXT_V1_TEXT,
  DTG_REGISTRY_CONTEXT_V1_URL,
} from '@bifold/vrc-contexts'
import { demoDocumentLoader } from '@bifold/vrc-shared'

const DTG = 'https://registry.trustoverip.org/dtg/credentials#'

// The essentials of the registry's witnessed/1 example (trustoverip/
// dtgwg-vsc-registry 0d309410, predicates/witnessed/1/examples/witnessed-vrc.json).
const witnessedStatement = {
  '@context': ['https://www.w3.org/ns/credentials/v2', 'https://registry.trustoverip.org/dtg/context/v1'],
  type: ['VerifiableCredential', 'DTGCredential', 'StatementCredential'],
  issuer: 'did:webvh:QmVzTd9hRkPqLu4WgXyN3c8pT2rJ6mK9sB1dF4gH7jL0n:witness-service.example',
  issuerScope: 'public',
  validFrom: '2026-01-06T10:00:00Z',
  taskContext: 'urn:uuid:2c7f5d19-6e0b-4c3d-8a41-9b2e6f0d4c88',
  taskDigestMultibase: 'zQmWhCFfStzUE4HGseiQ1XWi2eEp1GTQEKnt2jyBe7uqzXD',
  credentialSubject: {
    id: 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH',
    predicate: 'https://registry.trustoverip.org/dtg/vsc/witnessed/1',
    object: { digestMultibase: 'zQmYtUc4iTCbbfVSDNKvtQqrfyezPPnFvE33wFmutw9PBBk' },
  },
}

describe('DTG Credentials v1 context in the witness server loader', () => {
  it('is the published v1 bytes (sha256 3e1376ac…b448)', () => {
    const digest = createHash('sha256').update(DTG_REGISTRY_CONTEXT_V1_TEXT, 'utf8').digest('hex')
    expect(digest).toBe('3e1376acf401016a0162c1cdb31e44a85a7dd56749caed94a1dc0a0be6cbb448')
  })

  it('serves it from the bundle for the exact IRI', async () => {
    const loader = demoDocumentLoader({} as never)
    const result = await loader(DTG_REGISTRY_CONTEXT_V1_URL)
    expect(result.document).toBe(DTG_REGISTRY_CONTEXT_V1_DOCUMENT)
  })

  it('expands a witnessed/1 statement with only bundled contexts', async () => {
    const loader = demoDocumentLoader({} as never)
    // Every document the expansion asks for must come from the bundle: the two
    // contexts, each answered with the bundled object itself. Anything else
    // would go to the node loader, i.e. the network.
    const bundled = new Map<string, unknown>([
      [CREDENTIALS_V2_CONTEXT_URL, CREDENTIALS_V2_CONTEXT_DOCUMENT],
      [DTG_REGISTRY_CONTEXT_V1_URL, DTG_REGISTRY_CONTEXT_V1_DOCUMENT],
    ])
    const notBundled: string[] = []
    const offline = async (url: string) => {
      if (!bundled.has(url)) {
        notBundled.push(url)
        throw new Error(`not bundled: ${url}`)
      }
      const result = await loader(url)
      expect(result.document).toBe(bundled.get(url))
      return result
    }
    // The jsonld Credo itself expands with when it stores or verifies a card.
    const jsonld = vcLibraries.jsonld as unknown as {
      expand: (doc: unknown, opts: unknown) => Promise<Array<Record<string, any>>>
    }
    const [vc] = await jsonld.expand(witnessedStatement, { documentLoader: offline })
    expect(notBundled).toEqual([])
    expect(vc['@type']).toEqual(expect.arrayContaining([`${DTG}StatementCredential`]))
    expect(vc[`${DTG}issuerScope`]).toBeDefined()
    const subject = vc['https://www.w3.org/2018/credentials#credentialSubject'][0]
    expect(subject[`${DTG}predicate`]).toEqual([{ '@id': 'https://registry.trustoverip.org/dtg/vsc/witnessed/1' }])
  })
})
