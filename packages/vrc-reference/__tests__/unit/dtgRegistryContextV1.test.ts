/**
 * The reference loader serves the DTG Credentials v1 context (the registry's
 * frozen bytes) from the bundle, so reference runs can store and verify cards
 * from VTI 0.47.0 on without reaching the registry.
 */
import { createHash } from 'crypto'

import {
  DTG_REGISTRY_CONTEXT_V1_DOCUMENT,
  DTG_REGISTRY_CONTEXT_V1_TEXT,
  DTG_REGISTRY_CONTEXT_V1_URL,
} from '@bifold/vrc-contexts'

import { demoDocumentLoader } from '../../src/documentLoader'

describe('DTG Credentials v1 context in the reference loader', () => {
  it('is the published v1 bytes (sha256 3e1376ac…b448)', () => {
    const digest = createHash('sha256').update(DTG_REGISTRY_CONTEXT_V1_TEXT, 'utf8').digest('hex')
    expect(digest).toBe('3e1376acf401016a0162c1cdb31e44a85a7dd56749caed94a1dc0a0be6cbb448')
  })

  it('serves it from the bundle for the exact IRI', async () => {
    const loader = demoDocumentLoader({} as never)
    const result = await loader(DTG_REGISTRY_CONTEXT_V1_URL)
    expect(result.document).toBe(DTG_REGISTRY_CONTEXT_V1_DOCUMENT)
    expect(result.documentUrl).toBe(DTG_REGISTRY_CONTEXT_V1_URL)
  })
})
