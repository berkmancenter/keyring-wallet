import { ClaimFormat, JsonTransformer, W3cCredentialRecord } from '@credo-ts/core'

import {
  isReceivedRCard,
  getReceivedRCardForIssuer,
  extractContactInfoFromRCard,
  resolveContactDisplayInfo,
} from '../../../../src/modules/vrc/utils/rcardDisplayUtils'
import { buildJCardFromFormInput, RCardFormInput } from '../../../../src/modules/vrc/types/rcard'
import { DTG_CONTEXT_URL, RCARD_CONTEXT_URL } from '../../../../src/modules/vrc/types/relationshipContext'
import { createDTGCredential, TEST_CONTACTS } from '../fixtures/dtg-credentials'

const ALICE_DID = TEST_CONTACTS.alice.issuer.id
const HOLDER_DID = 'did:peer:2.Ez6LSholder0000hol'

/**
 * Build a received RelationshipCard record as stored after auto-accepting the
 * counterparty's RCard offer (issuer = counterparty relationship DID,
 * credentialSubject.id = our relationship DID, card = counterparty's jCard).
 */
function createReceivedRCard(params: {
  issuerDid: string
  subjectDid?: string
  form: RCardFormInput
  issuanceDate?: string
}): W3cCredentialRecord {
  const issuanceDate = params.issuanceDate || new Date().toISOString()
  const jcard = buildJCardFromFormInput(params.form)

  return JsonTransformer.fromJSON(
    {
      _tags: {
        claimFormat: ClaimFormat.LdpVc,
        types: ['VerifiableCredential', 'RelationshipCard'],
        issuerId: params.issuerDid,
      },
      type: 'W3cCredentialRecord',
      id: `urn:uuid:rcard-${Math.random().toString(16).slice(2)}`,
      createdAt: issuanceDate,
      credential: {
        '@context': ['https://www.w3.org/2018/credentials/v1', DTG_CONTEXT_URL, RCARD_CONTEXT_URL],
        type: ['VerifiableCredential', 'RelationshipCard'],
        issuer: params.issuerDid,
        issuanceDate,
        credentialSubject: {
          id: params.subjectDid || HOLDER_DID,
          card: jcard,
        },
        proof: {
          type: 'Ed25519Signature2018',
          created: issuanceDate,
          proofPurpose: 'assertionMethod',
          verificationMethod: `${params.issuerDid}#key-1`,
          jws: 'mock-jws-signature',
        },
      },
    },
    W3cCredentialRecord
  )
}

/** Build a local self-issued RCardTemplate record (must never count as received) */
function createRCardTemplateRecord(form: RCardFormInput): W3cCredentialRecord {
  const now = new Date().toISOString()
  return JsonTransformer.fromJSON(
    {
      _tags: { types: ['VerifiableCredential', 'RCardTemplate'] },
      type: 'W3cCredentialRecord',
      id: `urn:uuid:template-${Math.random().toString(16).slice(2)}`,
      createdAt: now,
      credential: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential', 'RCardTemplate'],
        issuer: HOLDER_DID,
        issuanceDate: now,
        credentialSubject: {
          id: HOLDER_DID,
          card: buildJCardFromFormInput(form),
        },
        proof: {
          type: 'Ed25519Signature2018',
          created: now,
          proofPurpose: 'assertionMethod',
          verificationMethod: `${HOLDER_DID}#key-1`,
          jws: 'mock-jws-signature',
        },
      },
    },
    W3cCredentialRecord
  )
}

const aliceForm: RCardFormInput = {
  firstName: 'Alice',
  lastName: 'Smith',
  email: 'alice@rcard.example.com',
  organization: 'RCard Corp',
}

describe('rcardDisplayUtils', () => {
  describe('isReceivedRCard', () => {
    test('returns true for a received RelationshipCard', () => {
      expect(isReceivedRCard(createReceivedRCard({ issuerDid: ALICE_DID, form: aliceForm }))).toBe(true)
    })

    test('returns false for the local RCardTemplate', () => {
      expect(isReceivedRCard(createRCardTemplateRecord(aliceForm))).toBe(false)
    })

    test('returns false for a VRC (RelationshipCredential)', () => {
      const vrc = createDTGCredential({
        issuer: TEST_CONTACTS.alice.issuer,
        credentialSubject: { id: HOLDER_DID },
      })
      expect(isReceivedRCard(vrc)).toBe(false)
    })
  })

  describe('getReceivedRCardForIssuer', () => {
    test('finds the RCard issued by the given DID', () => {
      const rcard = createReceivedRCard({ issuerDid: ALICE_DID, form: aliceForm })
      const other = createReceivedRCard({
        issuerDid: TEST_CONTACTS.bob.issuer.id,
        form: { firstName: 'Bob', lastName: 'Jones', email: 'bob@x.io', organization: '' },
      })

      expect(getReceivedRCardForIssuer([other, rcard], ALICE_DID)?.id).toBe(rcard.id)
    })

    test('returns the most recently issued RCard when several exist', () => {
      const older = createReceivedRCard({
        issuerDid: ALICE_DID,
        form: { ...aliceForm, firstName: 'Old' },
        issuanceDate: '2024-01-01T00:00:00Z',
      })
      const newer = createReceivedRCard({
        issuerDid: ALICE_DID,
        form: aliceForm,
        issuanceDate: '2024-06-01T00:00:00Z',
      })

      expect(getReceivedRCardForIssuer([older, newer], ALICE_DID)?.id).toBe(newer.id)
      expect(getReceivedRCardForIssuer([newer, older], ALICE_DID)?.id).toBe(newer.id)
    })

    test('returns undefined when no RCard matches', () => {
      expect(getReceivedRCardForIssuer([], ALICE_DID)).toBeUndefined()
    })
  })

  describe('extractContactInfoFromRCard', () => {
    test('extracts name, email and organization from the jCard', () => {
      const info = extractContactInfoFromRCard(createReceivedRCard({ issuerDid: ALICE_DID, form: aliceForm }))

      expect(info.name).toBe('Alice Smith')
      expect(info.email).toBe('alice@rcard.example.com')
      expect(info.organization).toBe('RCard Corp')
    })

    test('returns empty object when the card is missing', () => {
      const rcard = createReceivedRCard({ issuerDid: ALICE_DID, form: aliceForm })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete ((rcard.encoded as any).credentialSubject as any).card

      expect(extractContactInfoFromRCard(rcard)).toEqual({})
    })
  })

  describe('resolveContactDisplayInfo', () => {
    test('prefers the received RCard over the legacy VRC issuer object', () => {
      const legacyVrc = createDTGCredential({
        issuer: { ...TEST_CONTACTS.alice.issuer, name: 'Legacy Name' },
        credentialSubject: { id: HOLDER_DID },
      })
      const rcard = createReceivedRCard({ issuerDid: ALICE_DID, form: aliceForm })

      const info = resolveContactDisplayInfo([legacyVrc, rcard], ALICE_DID)

      expect(info.name).toBe('Alice Smith')
      expect(info.email).toBe('alice@rcard.example.com')
    })

    test('falls back to the legacy VRC issuer object when no RCard exists', () => {
      const legacyVrc = createDTGCredential({
        issuer: TEST_CONTACTS.alice.issuer,
        credentialSubject: { id: HOLDER_DID },
      })

      const info = resolveContactDisplayInfo([legacyVrc], ALICE_DID)

      expect(info.name).toBe('Alice Smith')
      expect(info.email).toBe('alice@example.com')
      expect(info.organization).toBe('Tech Corp')
    })

    test('uses the most recent legacy VRC when several exist', () => {
      const older = createDTGCredential({
        issuer: { id: ALICE_DID, name: 'Old Name' },
        credentialSubject: { id: HOLDER_DID },
        validFrom: '2024-01-01T00:00:00Z',
      })
      const newer = createDTGCredential({
        issuer: { id: ALICE_DID, name: 'New Name' },
        credentialSubject: { id: HOLDER_DID },
        validFrom: '2024-06-01T00:00:00Z',
      })

      expect(resolveContactDisplayInfo([older, newer], ALICE_DID).name).toBe('New Name')
      expect(resolveContactDisplayInfo([newer, older], ALICE_DID).name).toBe('New Name')
    })

    test('ignores the local RCardTemplate and returns empty when nothing matches', () => {
      const template = createRCardTemplateRecord(aliceForm)

      expect(resolveContactDisplayInfo([template], ALICE_DID)).toEqual({})
    })

    test('does not leak info across different issuer DIDs (bare-string VRC issuer)', () => {
      // Post-separation VRC: bare string issuer, no embedded contact info
      const bareVrc = JsonTransformer.fromJSON(
        {
          _tags: { types: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'] },
          type: 'W3cCredentialRecord',
          id: 'urn:uuid:bare-vrc',
          createdAt: new Date().toISOString(),
          credential: {
            '@context': ['https://www.w3.org/2018/credentials/v1', DTG_CONTEXT_URL],
            type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
            issuer: ALICE_DID,
            issuanceDate: new Date().toISOString(),
            credentialSubject: { id: HOLDER_DID },
            proof: {
              type: 'Ed25519Signature2018',
              created: new Date().toISOString(),
              proofPurpose: 'assertionMethod',
              verificationMethod: `${ALICE_DID}#key-1`,
              jws: 'mock-jws-signature',
            },
          },
        },
        W3cCredentialRecord
      )

      expect(resolveContactDisplayInfo([bareVrc], ALICE_DID)).toEqual({})
    })
  })
})
