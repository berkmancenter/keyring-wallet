/**
 * Version-compatibility matrix for credential type detection and display.
 *
 * Runs the display pipeline (registry → handler → subject/fields) across the
 * credential shapes that coexist in real wallets after the RCE v1/v2/v3
 * rollout:
 *
 *   v1  — VCDM 1.1, Ed25519Signature2018 proof, embedded issuer object (PII in VRC)
 *   v2  — VCDM 2.0, Ed25519Signature2018 proof, bare-DID issuer + sibling RCard
 *   v3  — VCDM 2.0, DataIntegrityProof/eddsa-rdfc-2022, bare-DID issuer + sibling RCard
 *
 * Also pins the invariant that motivated the display refactor: the header
 * identity (subject) and the "Issuer …" field rows come from the same handler
 * path and can never disagree.
 */

import { ClaimFormat, JsonTransformer, W3cCredentialRecord } from '@credo-ts/core'

import {
  isDTGCredential,
  isRelationshipCredential,
  isRCard,
  isRCardTemplate,
  isWitnessCredential,
  isPeerVrcCredential,
  isVrcModuleCredential,
} from '../../../../src/modules/vrc/credentialTypes'
import { credentialDisplayRegistry } from '../../../../src/modules/vrc/display/displayRegistry'
import { relationshipCredentialHandler } from '../../../../src/modules/vrc/display/handlers/RelationshipCredentialHandler'
import { witnessCredentialHandler } from '../../../../src/modules/vrc/display/handlers/WitnessCredentialHandler'
import { W3cCredentialJson } from '../../../../src/modules/vrc/display/types'
import { buildJCardFromFormInput, RCardFormInput } from '../../../../src/modules/vrc/types/rcard'
import {
  DTG_CONTEXT_URL,
  RCARD_CONTEXT_URL,
  RELATIONSHIP_CONTEXT_URL,
} from '../../../../src/modules/vrc/types/relationshipContext'

const CONTACT_DID = 'did:peer:2.Ez6LScontact00000con'
const HOLDER_DID = 'did:peer:2.Ez6LSholder0000hol'

const EMBEDDED_ISSUER = {
  id: CONTACT_DID,
  name: 'Legacy Embedded Name',
  email: 'legacy@example.com',
  organization: 'Legacy Org',
}

const RCARD_FORM: RCardFormInput = {
  firstName: 'Rae',
  lastName: 'Card',
  email: 'rae@rcard.example.com',
  organization: 'RCard Org',
}
const RCARD_NAME = 'Rae Card'

const ED25519_PROOF = {
  type: 'Ed25519Signature2018',
  created: '2026-01-01T12:00:00Z',
  proofPurpose: 'assertionMethod',
  verificationMethod: `${CONTACT_DID}#key-1`,
  jws: 'mock-jws',
}

const DI_PROOF = {
  type: 'DataIntegrityProof',
  cryptosuite: 'eddsa-rdfc-2022',
  created: '2026-01-01T12:00:00Z',
  proofPurpose: 'assertionMethod',
  verificationMethod: `${CONTACT_DID}#key-1`,
  proofValue: 'zMockDiSig',
}

/** v1: VCDM 1.1, 2018 proof, PII embedded in the issuer object */
const v1Vrc: W3cCredentialJson = {
  '@context': ['https://www.w3.org/2018/credentials/v1', DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL],
  type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
  issuer: EMBEDDED_ISSUER,
  issuanceDate: '2026-01-01T12:00:00Z',
  credentialSubject: { id: HOLDER_DID },
  proof: ED25519_PROOF,
}

/** v2: VCDM 2.0, 2018 proof, pseudonymous bare-DID issuer (PII travels in the RCard) */
const v2Vrc: W3cCredentialJson = {
  '@context': ['https://www.w3.org/ns/credentials/v2', DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL],
  type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
  issuer: CONTACT_DID,
  validFrom: '2026-01-01T12:00:00Z',
  credentialSubject: { id: HOLDER_DID },
  proof: ED25519_PROOF,
}

/** v3: like v2 but signed with DataIntegrityProof/eddsa-rdfc-2022 */
const v3Vrc: W3cCredentialJson = { ...v2Vrc, proof: DI_PROOF }

/** VWC issued by a witness (types include DTGCredential AND WitnessCredential) */
const witnessVwc: W3cCredentialJson = {
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  type: ['VerifiableCredential', 'DTGCredential', 'WitnessCredential'],
  issuer: { id: 'did:peer:2.Ez6LSwitness000wit', name: 'Test Witness' },
  issuanceDate: '2026-01-01T12:00:00Z',
  credentialSubject: { id: CONTACT_DID, digest: 'sha256:abc' },
  proof: ED25519_PROOF,
}

const rcardTemplateJson: W3cCredentialJson = {
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  type: ['VerifiableCredential', 'RCardTemplate'],
  issuer: HOLDER_DID,
  issuanceDate: '2026-01-01T12:00:00Z',
  credentialSubject: { id: HOLDER_DID, card: buildJCardFromFormInput(RCARD_FORM) },
  proof: ED25519_PROOF,
}

/** A received RelationshipCard record from the contact, as stored in the wallet */
function createReceivedRCardRecord(): W3cCredentialRecord {
  const issuanceDate = '2026-01-02T12:00:00Z'
  return JsonTransformer.fromJSON(
    {
      _tags: {
        claimFormat: ClaimFormat.LdpVc,
        types: ['VerifiableCredential', 'RelationshipCard'],
        issuerId: CONTACT_DID,
      },
      type: 'W3cCredentialRecord',
      id: 'urn:uuid:matrix-rcard-1',
      createdAt: issuanceDate,
      credential: {
        '@context': ['https://www.w3.org/2018/credentials/v1', DTG_CONTEXT_URL, RCARD_CONTEXT_URL],
        type: ['VerifiableCredential', 'RelationshipCard'],
        issuer: CONTACT_DID,
        issuanceDate,
        credentialSubject: { id: HOLDER_DID, card: buildJCardFromFormInput(RCARD_FORM) },
        proof: ED25519_PROOF,
      },
    },
    W3cCredentialRecord
  )
}

/** Plain-JSON view of a received RelationshipCard (as the predicates see it) */
const rcardJson: W3cCredentialJson = {
  '@context': ['https://www.w3.org/2018/credentials/v1', DTG_CONTEXT_URL, RCARD_CONTEXT_URL],
  type: ['VerifiableCredential', 'RelationshipCard'],
  issuer: CONTACT_DID,
  issuanceDate: '2026-01-02T12:00:00Z',
  credentialSubject: { id: HOLDER_DID, card: buildJCardFromFormInput(RCARD_FORM) },
  proof: ED25519_PROOF,
}

interface MatrixCase {
  label: string
  vrc: W3cCredentialJson
  /** Expected identity with NO sibling records in the wallet */
  bareSubject: { name?: string; email?: string; organization?: string }
}

const MATRIX: MatrixCase[] = [
  {
    label: 'v1 (VCDM 1.1, Ed25519Signature2018, embedded issuer)',
    vrc: v1Vrc,
    bareSubject: { name: EMBEDDED_ISSUER.name, email: EMBEDDED_ISSUER.email, organization: EMBEDDED_ISSUER.organization },
  },
  {
    label: 'v2 (VCDM 2.0, Ed25519Signature2018, bare-DID issuer)',
    vrc: v2Vrc,
    bareSubject: { name: undefined, email: undefined, organization: undefined },
  },
  {
    label: 'v3 (VCDM 2.0, DataIntegrityProof/eddsa-rdfc-2022, bare-DID issuer)',
    vrc: v3Vrc,
    bareSubject: { name: undefined, email: undefined, organization: undefined },
  },
]

describe('Credential display version-compatibility matrix', () => {
  beforeEach(() => {
    credentialDisplayRegistry.clear()
    credentialDisplayRegistry.register(relationshipCredentialHandler)
    credentialDisplayRegistry.register(witnessCredentialHandler)
  })

  afterEach(() => {
    credentialDisplayRegistry.clear()
  })

  describe.each(MATRIX)('$label', ({ vrc, bareSubject }) => {
    it('matches the RelationshipCredential handler', () => {
      const result = credentialDisplayRegistry.getDisplayInfo(vrc)
      expect(result.matched).toBe(true)
      expect(result.credentialTypeName).toBe('Relationship Credential')
    })

    it('resolves identity from the credential itself when no siblings exist', () => {
      const result = credentialDisplayRegistry.getDisplayInfo(vrc, { relatedRecords: [] })
      expect(result.subject?.id).toBe(CONTACT_DID)
      expect(result.subject?.name).toBe(bareSubject.name)
      expect(result.subject?.email).toBe(bareSubject.email)
      expect(result.subject?.organization).toBe(bareSubject.organization)
    })

    it('resolves identity from the sibling RCard when one exists', () => {
      const result = credentialDisplayRegistry.getDisplayInfo(vrc, {
        relatedRecords: [createReceivedRCardRecord()],
      })
      expect(result.subject?.name).toBe(RCARD_NAME)
      expect(result.subject?.email).toBe(RCARD_FORM.email)
      expect(result.subject?.organization).toBe(RCARD_FORM.organization)
    })

    it.each([
      ['without siblings', [] as W3cCredentialRecord[]],
      ['with a sibling RCard', [createReceivedRCardRecord()]],
    ])('header subject and Issuer field rows agree %s', (_label, relatedRecords) => {
      // The invariant that motivated the refactor: CredentialOffer's header
      // (subject) and its field list are sourced from the same handler path,
      // so a name shown in one and missing in the other is impossible.
      const result = credentialDisplayRegistry.getDisplayInfo(vrc, { relatedRecords })
      const issuerNameField = result.fields.find((f) => f.name === 'issuerName') as { value?: unknown } | undefined
      const issuerEmailField = result.fields.find((f) => f.name === 'issuerEmail') as { value?: unknown } | undefined

      if (result.subject?.name) {
        expect(issuerNameField?.value).toBe(result.subject.name)
      } else {
        expect(issuerNameField).toBeUndefined()
      }
      if (result.subject?.email) {
        expect(issuerEmailField?.value).toBe(result.subject.email)
      } else {
        expect(issuerEmailField).toBeUndefined()
      }
    })
  })

  it('proof family does not change display output (v2 vs v3 identical)', () => {
    const context = { relatedRecords: [createReceivedRCardRecord()] }
    const v2Result = credentialDisplayRegistry.getDisplayInfo(v2Vrc, context)
    const v3Result = credentialDisplayRegistry.getDisplayInfo(v3Vrc, context)
    expect(v3Result.subject).toEqual(v2Result.subject)
    expect(v3Result.fields.map((f) => f.name)).toEqual(v2Result.fields.map((f) => f.name))
  })

  it('a VWC matches the Witness handler and exposes no subject', () => {
    const result = credentialDisplayRegistry.getDisplayInfo(witnessVwc, { relatedRecords: [] })
    expect(result.matched).toBe(true)
    // Witness handler outranks the Relationship handler and has no notion of
    // a contact subject — headers must not show witness identity as a contact.
    expect(result.subject).toBeUndefined()
  })
})

describe('Canonical type-detection matrix', () => {
  const shapes: Array<[string, W3cCredentialJson]> = [
    ['v1 VRC', v1Vrc],
    ['v2 VRC', v2Vrc],
    ['v3 VRC', v3Vrc],
    ['received RCard', rcardJson],
    ['RCardTemplate', rcardTemplateJson],
    ['Witness VWC', witnessVwc],
  ]

  const expectations: Record<string, (c: W3cCredentialJson) => boolean> = {
    isDTGCredential,
    isRelationshipCredential,
    isRCard,
    isRCardTemplate,
    isWitnessCredential,
    isPeerVrcCredential,
    isVrcModuleCredential,
  }

  const expected: Record<string, Record<string, boolean>> = {
    'v1 VRC': {
      isDTGCredential: true,
      isRelationshipCredential: true,
      isRCard: false,
      isRCardTemplate: false,
      isWitnessCredential: false,
      isPeerVrcCredential: true,
      isVrcModuleCredential: true,
    },
    'v2 VRC': {
      isDTGCredential: true,
      isRelationshipCredential: true,
      isRCard: false,
      isRCardTemplate: false,
      isWitnessCredential: false,
      isPeerVrcCredential: true,
      isVrcModuleCredential: true,
    },
    'v3 VRC': {
      isDTGCredential: true,
      isRelationshipCredential: true,
      isRCard: false,
      isRCardTemplate: false,
      isWitnessCredential: false,
      isPeerVrcCredential: true,
      isVrcModuleCredential: true,
    },
    'received RCard': {
      isDTGCredential: false,
      isRelationshipCredential: false,
      isRCard: true,
      isRCardTemplate: false,
      isWitnessCredential: false,
      isPeerVrcCredential: false,
      isVrcModuleCredential: true,
    },
    RCardTemplate: {
      isDTGCredential: false,
      isRelationshipCredential: false,
      isRCard: false,
      isRCardTemplate: true,
      isWitnessCredential: false,
      isPeerVrcCredential: false,
      isVrcModuleCredential: true,
    },
    'Witness VWC': {
      isDTGCredential: true,
      isRelationshipCredential: false,
      isRCard: false,
      isRCardTemplate: false,
      isWitnessCredential: true,
      isPeerVrcCredential: false,
      isVrcModuleCredential: true,
    },
  }

  it.each(shapes)('%s classifies correctly under every predicate', (label, credential) => {
    for (const [predicateName, predicate] of Object.entries(expectations)) {
      expect({ [predicateName]: predicate(credential) }).toEqual({ [predicateName]: expected[label][predicateName] })
    }
  })

  it('predicates accept type arrays and single strings, not just credential JSON', () => {
    expect(isWitnessCredential(['VerifiableCredential', 'WitnessCredential'])).toBe(true)
    expect(isWitnessCredential('WitnessCredential')).toBe(true)
    expect(isVrcModuleCredential('["VerifiableCredential","DTGCredential"]')).toBe(true)
    expect(isDTGCredential(undefined)).toBe(false)
    expect(isDTGCredential({})).toBe(false)
  })
})
