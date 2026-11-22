import { DTG_PREDICATE_ENDORSES, DTG_PREDICATE_WITNESSED } from '@bifold/dtg-vocab'

import {
  isPeerVrcCredential,
  isStatementCredential,
  isWitnessCredential,
  isWitnessStatement,
} from '../../credentialTypes'

const legacyVwc = {
  type: ['VerifiableCredential', 'DTGCredential', 'WitnessCredential'],
  credentialSubject: { id: 'did:example:subject' },
}

const vscWitnessed = {
  type: ['VerifiableCredential', 'DTGCredential', 'StatementCredential'],
  credentialSubject: { id: 'did:example:subject', predicate: DTG_PREDICATE_WITNESSED },
}

const vscEndorsement = {
  type: ['VerifiableCredential', 'DTGCredential', 'StatementCredential'],
  credentialSubject: { id: 'did:example:subject', predicate: DTG_PREDICATE_ENDORSES },
}

const vscUnrecognizedPredicate = {
  type: ['VerifiableCredential', 'DTGCredential', 'StatementCredential'],
  credentialSubject: { id: 'did:example:subject', predicate: 'https://example.com/not-in-accept-list' },
}

const peerVrc = {
  type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
  credentialSubject: { id: 'did:example:subject' },
}

describe('credentialTypes — VSC dual-read (plan §6 V3)', () => {
  describe('isWitnessStatement', () => {
    it('recognizes the new dtg:witnessed VSC shape', () => {
      expect(isWitnessStatement(vscWitnessed)).toBe(true)
    })

    it('does not recognize the legacy WD02 shape (no predicate at all)', () => {
      expect(isWitnessStatement(legacyVwc)).toBe(false)
    })

    it('does not recognize an endorsement statement', () => {
      expect(isWitnessStatement(vscEndorsement)).toBe(false)
    })

    it('does not recognize a predicate absent from the accept-list', () => {
      expect(isWitnessStatement(vscUnrecognizedPredicate)).toBe(false)
    })

    it('requires a full credential object, not a bare type array', () => {
      expect(isWitnessStatement(['VerifiableCredential', 'DTGCredential', 'StatementCredential'])).toBe(false)
    })
  })

  describe('isWitnessCredential — dual-read', () => {
    it('recognizes the legacy WD02 type-string form', () => {
      expect(isWitnessCredential(legacyVwc)).toBe(true)
    })

    it('recognizes the new VSC predicate form', () => {
      expect(isWitnessCredential(vscWitnessed)).toBe(true)
    })

    it('does not recognize an endorsement statement as a witness credential', () => {
      expect(isWitnessCredential(vscEndorsement)).toBe(false)
    })
  })

  describe('isStatementCredential — the allowlist isPeerVrcCredential dispatches on', () => {
    it('recognizes dtg:witnessed', () => {
      expect(isStatementCredential(vscWitnessed)).toBe(true)
    })

    it('recognizes dtg:endorses', () => {
      expect(isStatementCredential(vscEndorsement)).toBe(true)
    })

    it('does not recognize an unaccepted predicate', () => {
      expect(isStatementCredential(vscUnrecognizedPredicate)).toBe(false)
    })

    it('does not recognize a non-statement credential', () => {
      expect(isStatementCredential(peerVrc)).toBe(false)
    })
  })

  describe('isPeerVrcCredential — the A11 bug fix', () => {
    it('recognizes an actual peer VRC', () => {
      expect(isPeerVrcCredential(peerVrc)).toBe(true)
    })

    it('excludes a legacy-shaped WitnessCredential (already worked before the fix)', () => {
      expect(isPeerVrcCredential(legacyVwc)).toBe(false)
    })

    it('excludes a VSC-shaped dtg:witnessed statement (the bug: used to be mis-filed as a peer VRC)', () => {
      expect(isPeerVrcCredential(vscWitnessed)).toBe(false)
    })

    it('excludes a VSC-shaped dtg:endorses statement (never had a legacy type alias at all)', () => {
      expect(isPeerVrcCredential(vscEndorsement)).toBe(false)
    })

    it('excludes an unrecognized-predicate statement too — fail-closed via isRelationshipCredential, not just the accept-list', () => {
      // A StatementCredential with a predicate outside the accept-list is not
      // a witness or endorsement statement, so isWitnessCredential and
      // isStatementCredential both stay false for it — but it is still not a
      // peer VRC, because it carries StatementCredential in its type array,
      // never RelationshipCredential (D1 forbids a StatementCredential from
      // carrying any other concrete DTGCredential subtype). Reconciled
      // 2026-09-28 against an independent upstream fix (community cards,
      // 2026-09-26) that changed isPeerVrcCredential's base from
      // isDTGCredential to isRelationshipCredential: that base is a stronger,
      // fail-closed guarantee than the original A11 fix made on its own —
      // this case used to document a known fail-open gap (isDTGCredential
      // still matched), and the gap is closed as a side effect of the merge,
      // not by a change to the VSC dual-read logic itself.
      expect(isPeerVrcCredential(vscUnrecognizedPredicate)).toBe(false)
    })
  })
})
