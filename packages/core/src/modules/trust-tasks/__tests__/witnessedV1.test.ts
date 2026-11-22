/**
 * 228: a witness credential is read in both shapes — the `WitnessCredential`
 * Keyring's witness has always issued, and DTG Credentials v1's witnessed/1
 * statement (VTI 0.47.0, #1859; tf witness/session/submit as recast by #691),
 * which carries its task citation at the top level and no `parties`.
 *
 * `dtg-v1-minted-witness.json` is minted with VTI's own code at 439a0333
 * (vta-service-v0.47.0): dtg-credentials 0.12.0 `new_witnessed_vsc` over its
 * `witnessSession` and `witnessedRelationship`, signed eddsa-jcs-2022 by a
 * did:key witness. Crate-minted, not from a deployed witness.
 */
import {
  WITNESSED_V1_PREDICATE,
  isPeerVrcCredential,
  isWitnessCredential,
  isWitnessedStatement,
} from '../../vrc/credentialTypes'
import { digestBytesEqual, taskDigestMultibase } from '../documentProof'
import { taskCitationOf } from '../taskCitation'

import minted from './fixtures/dtg-v1-minted-witness.json'

type Json = Record<string, unknown>

const vwc = minted.witnessStatement as Json
const oldVwc: Json = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: ['VerifiableCredential', 'DTGCredential', 'WitnessCredential'],
  issuer: 'did:example:witness',
  credentialSubject: {
    id: 'did:peer:0zA',
    parties: ['did:peer:0zA', 'did:peer:0zB'],
    taskContext: 'urn:uuid:old-session',
    taskDigestMultibase: 'zQmOld',
  },
}

describe('a witness credential, in either shape', () => {
  it('is recognised: the WitnessCredential type, or a witnessed/1 statement', () => {
    expect(isWitnessCredential(oldVwc)).toBe(true)
    expect(isWitnessCredential(vwc)).toBe(true)
    expect(isWitnessedStatement(vwc)).toBe(true)
    expect((vwc.credentialSubject as Json).predicate).toBe(WITNESSED_V1_PREDICATE)
  })

  it('is told from a vetting statement, which is a StatementCredential too', () => {
    expect(isWitnessCredential(minted.vettingStatement)).toBe(false)
  })

  it('is recognised in a Credo credential instance, whose subject keeps its members in claims', () => {
    const instance = {
      type: vwc.type,
      credentialSubject: { id: (vwc.credentialSubject as Json).id, claims: { predicate: WITNESSED_V1_PREDICATE } },
    }
    expect(isWitnessCredential(instance)).toBe(true)
  })

  it('needs the credential, not just its types, for the v1 shape', () => {
    // A bare type list cannot name the predicate: callers pass the credential.
    expect(isWitnessCredential(vwc.type)).toBe(false)
    expect(isWitnessCredential(oldVwc.type)).toBe(true)
  })

  it('is no peer VRC in either shape', () => {
    expect(isPeerVrcCredential(vwc)).toBe(false)
    expect(isPeerVrcCredential(oldVwc)).toBe(false)
  })

  it('names a substring-free type: StatementCredential is matched exactly', () => {
    const lookalike = { ...vwc, type: ['VerifiableCredential', 'NotAStatementCredentialReally'] }
    expect(isWitnessedStatement(lookalike)).toBe(false)
  })
})

describe('the task citation, in either place', () => {
  it('is read at the top level for witnessed/1 and from the subject before it', () => {
    expect(taskCitationOf(vwc)).toEqual({
      taskContext: minted.witnessSession.id,
      taskDigestMultibase: vwc.taskDigestMultibase,
    })
    expect(taskCitationOf(oldVwc)).toEqual({ taskContext: 'urn:uuid:old-session', taskDigestMultibase: 'zQmOld' })
    expect(taskCitationOf(undefined)).toEqual({})
  })

  it("reproduces with Keyring's own digest over the session document the crate cited", () => {
    // The binder the ceremony and the outcome-evidence check rely on: the
    // digest dtg-credentials 0.12.0 wrote must be the one Keyring computes.
    const cited = taskCitationOf(vwc).taskDigestMultibase as string
    expect(digestBytesEqual(cited, taskDigestMultibase(minted.witnessSession as Json))).toBe(true)
  })
})
