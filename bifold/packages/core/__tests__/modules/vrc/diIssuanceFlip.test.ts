/**
 * Task: Data Integrity issuance flip (RCE protocol v3, Decision 6 of
 * docs/CRYPTO_SUITE_FOLLOWUP.md).
 *
 * Covers the capability gate added for DataIntegrityProof/eddsa-rdfc-2022:
 * - getVrcJsonLdProofOptions returns DI options only for peers that announced
 *   RCE v3; v2/v1/unknown peers keep Ed25519Signature2018 exactly as before
 *   but are issued VCDM 1.1 documents, never VC 2.0 (G32)
 * - the VRC and RCard builders drop the Ed25519 suite context on the DI path
 *   (credentials/v2 already defines the DataIntegrityProof terms) and keep it
 *   on the 2018 path
 */
import { W3cCredentialRepository } from '@credo-ts/core'

import { buildRCardCredential } from '../../../src/modules/vrc/services/rCardCredential'
import {
  buildVrcCredential,
  getVrcJsonLdProofOptions,
  RCE_PROTOCOL_VERSION,
} from '../../../src/modules/vrc/vrc-manager'
import { RelationshipDidRepository } from '../../../src/modules/vrc/repositories/RelationshipDidRepository'
import { CREDENTIALS_V2_CONTEXT_URL, ED25519_2018_SUITE_CONTEXT_URL } from '@bifold/vrc-contexts'
import {
  DTG_CONTEXT_URL,
  HARDWARE_EVIDENCE_CONTEXT_URL,
  RCARD_CONTEXT_URL,
  RELATIONSHIP_CONTEXT_URL,
  REGISTRY_DTG_CONTEXT_URL,
} from '../../../src/modules/vrc/types/relationshipContext'

const MY_DID = 'did:peer:0z6MkIssuer000000000000000000000000000000000000'
const THEIR_DID = 'did:peer:0z6MkSubject00000000000000000000000000000000000'

const JCARD = [
  'vcard',
  [
    ['version', {}, 'text', '4.0'],
    ['fn', {}, 'text', 'Alice Example'],
  ],
]

/**
 * Minimal agent whose RelationshipDidRepository reports the given
 * counterparty RCE version (undefined = no record / pre-versioning peer) and
 * whose W3cCredentialRepository returns one R-Card template record.
 */
function buildAgent(counterpartyRceVersion?: number) {
  const relationshipRepository = {
    findByCounterpartyRelationshipDid: jest
      .fn()
      .mockResolvedValue(counterpartyRceVersion === undefined ? null : { counterpartyRceVersion }),
  }
  const templateRecord = {
    id: 'rcard-template-record',
    encoded: {
      id: 'urn:uuid:template',
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', 'RCardTemplate'],
      credentialSubject: { id: 'urn:uuid:template', templateId: 'rcard-basic-1', jcard: JCARD },
    },
  }
  const w3cRepository = { findByQuery: jest.fn().mockResolvedValue([templateRecord]) }
  return {
    context: {},
    config: { logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } },
    dependencyManager: {
      resolve: jest.fn((token: unknown) => {
        if (token === RelationshipDidRepository) return relationshipRepository
        if (token === W3cCredentialRepository) return w3cRepository
        throw new Error('Unexpected token')
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('getVrcJsonLdProofOptions capability gate', () => {
  test('RCE v3 peer gets DataIntegrityProof + eddsa-rdfc-2022', async () => {
    const options = await getVrcJsonLdProofOptions(buildAgent(3), THEIR_DID)
    expect(options).toEqual({
      proofType: 'DataIntegrityProof',
      cryptosuite: 'eddsa-rdfc-2022',
      proofPurpose: 'assertionMethod',
    })
  })

  test('RCE v2-only peer keeps Ed25519Signature2018 (no cryptosuite field) — paired with a VCDM 1.1 VRC, see below', async () => {
    const options = await getVrcJsonLdProofOptions(buildAgent(2), THEIR_DID)
    expect(options).toEqual({ proofType: 'Ed25519Signature2018', proofPurpose: 'assertionMethod' })
  })

  test('unknown peer (no record) keeps Ed25519Signature2018', async () => {
    const options = await getVrcJsonLdProofOptions(buildAgent(undefined), THEIR_DID)
    expect(options).toEqual({ proofType: 'Ed25519Signature2018', proofPurpose: 'assertionMethod' })
  })

  test('repository failure fails safe to Ed25519Signature2018', async () => {
    const agent = buildAgent(3)
    agent.dependencyManager.resolve = jest.fn(() => {
      throw new Error('container unavailable')
    })
    const options = await getVrcJsonLdProofOptions(agent, THEIR_DID)
    expect(options.proofType).toBe('Ed25519Signature2018')
  })
})

describe('VRC credential @context on the DI path', () => {
  test('v3 peer: VCDM 2.0 shape without the Ed25519 suite context', async () => {
    const { credential } = await buildVrcCredential(buildAgent(3), MY_DID, THEIR_DID)
    // A v3 peer predates the hardware-evidence context (RCE v5), so it keeps
    // getting the legacy DTG_CONTEXT_URL third, whose @vocab covers the
    // hardware-attestation `evidence` block's terms (see buildVrcCredential).
    // Real DTG registry context (cred-spec's own IRI) second. The legacy
    // RELATIONSHIP_CONTEXT_URL is no longer emitted for new VC 2.0 issuance.
    expect(credential['@context']).toEqual([CREDENTIALS_V2_CONTEXT_URL, REGISTRY_DTG_CONTEXT_URL, DTG_CONTEXT_URL])
    expect(credential.validFrom).toBeDefined()
    expect(credential.issuer).toBe(MY_DID)
  })

  test('v4 peer (pre-hardware-evidence-context): legacy DTG_CONTEXT_URL third, no new IRI', async () => {
    const { credential } = await buildVrcCredential(buildAgent(4), MY_DID, THEIR_DID)
    expect(credential['@context']).toEqual([CREDENTIALS_V2_CONTEXT_URL, REGISTRY_DTG_CONTEXT_URL, DTG_CONTEXT_URL])
    expect(credential['@context']).not.toContain(HARDWARE_EVIDENCE_CONTEXT_URL)
  })

  test('unknown peer (no record): VCDM 1.1 legacy shape, never the evidence context', async () => {
    const { credential } = await buildVrcCredential(buildAgent(undefined), MY_DID, THEIR_DID)
    expect(credential['@context']).not.toContain(HARDWARE_EVIDENCE_CONTEXT_URL)
  })

  test('v5 peer: dedicated hardware-evidence context replaces the legacy @vocab context', async () => {
    const { credential } = await buildVrcCredential(buildAgent(5), MY_DID, THEIR_DID)
    expect(credential['@context']).toEqual([
      CREDENTIALS_V2_CONTEXT_URL,
      REGISTRY_DTG_CONTEXT_URL,
      HARDWARE_EVIDENCE_CONTEXT_URL,
    ])
    expect(credential['@context']).not.toContain(DTG_CONTEXT_URL)
  })

  test('this app announces RCE v5 (the version that carries the gate)', () => {
    expect(RCE_PROTOCOL_VERSION).toBeGreaterThanOrEqual(5)
  })

  test('v2-only peer: no VC 2.0 document at all (cred-spec requires DI on VC 2.0) — legacy VCDM 1.1 shape, 2018 proof', async () => {
    const agent = buildAgent(2)
    const { credential } = await buildVrcCredential(agent, MY_DID, THEIR_DID)
    expect(credential['@context']).not.toContain(CREDENTIALS_V2_CONTEXT_URL)
    expect(credential['@context']).not.toContain(ED25519_2018_SUITE_CONTEXT_URL)
    expect(credential.issuerScope).toBeUndefined()
    expect(credential.issuanceDate).toBeDefined()
    expect((await getVrcJsonLdProofOptions(agent, THEIR_DID)).proofType).toBe('Ed25519Signature2018')
  })
})

describe('RCard credential @context on the DI path', () => {
  test('useDi drops the Ed25519 suite context', async () => {
    const credential = await buildRCardCredential(buildAgent(3), MY_DID, THEIR_DID, { useVc20: true, useDi: true })
    expect(credential['@context']).toEqual([CREDENTIALS_V2_CONTEXT_URL, DTG_CONTEXT_URL, RCARD_CONTEXT_URL])
  })

  test('without useDi the 2018 suite context stays (v2 peers unchanged)', async () => {
    const credential = await buildRCardCredential(buildAgent(2), MY_DID, THEIR_DID, { useVc20: true })
    expect(credential['@context']).toEqual([
      CREDENTIALS_V2_CONTEXT_URL,
      DTG_CONTEXT_URL,
      RCARD_CONTEXT_URL,
      ED25519_2018_SUITE_CONTEXT_URL,
    ])
  })
})
