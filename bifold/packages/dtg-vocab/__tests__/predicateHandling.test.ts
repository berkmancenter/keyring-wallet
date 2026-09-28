import { readFileSync } from 'fs'
import { join } from 'path'
import { loadAcceptList } from '../src/acceptList'
import { configure, verify } from '../src/predicateHandling'
import { DTG_PREDICATE_WITNESSED, DTG_PREDICATE_ENDORSES } from '../src/namespace'

const schemaStore = {
  'witness-context.schema.json': JSON.parse(
    readFileSync(join(__dirname, '..', 'vocab', 'schemas', 'witness-context.schema.json'), 'utf8')
  ),
}

describe('dtg-vocab: accept-list and namespace', () => {
  it('loads the built accept-list with both mirrored predicates', () => {
    const acceptList = loadAcceptList()
    expect(Object.keys(acceptList).sort()).toEqual([DTG_PREDICATE_ENDORSES, DTG_PREDICATE_WITNESSED].sort())
  })

  it('carries both predicates as status "draft" — the real registry has not activated a version yet', () => {
    const acceptList = loadAcceptList()
    expect(acceptList[DTG_PREDICATE_WITNESSED].status).toBe('draft')
    expect(acceptList[DTG_PREDICATE_ENDORSES].status).toBe('draft')
  })
})

describe('dtg-vocab: Predicate Handling (cred-spec C4, steps 1-3)', () => {
  const config = configure(loadAcceptList(), schemaStore)

  it('step 1 rejects a non-absolute-IRI predicate as malformed', () => {
    const result = verify(config, { credentialSubject: { predicate: 'not-an-iri', object: { digestMultibase: 'zQm...' } } })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/^step 1/)
  })

  it('step 2 rejects an absolute IRI that is not in the accept-list', () => {
    const result = verify(config, {
      credentialSubject: { predicate: 'https://example.com/not-registered', object: { digestMultibase: 'zQm...' } },
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/^step 2/)
  })

  it('accepts a well-formed dtg:witnessed credential', () => {
    const result = verify(
      config,
      {
        credentialSubject: {
          id: 'did:key:zWitness',
          predicate: DTG_PREDICATE_WITNESSED,
          object: { digestMultibase: 'zQmTargetDigest' },
          witnessContext: { event: 'session:complete', sessionId: 'abc-123', method: 'didcomm-v1' },
        },
        taskContext: 'urn:uuid:session-abc',
      },
      {
        relations: { [DTG_PREDICATE_WITNESSED]: 'subjectIsReferencedIssuer' },
        referenced: [{ digestMultibase: 'zQmTargetDigest', credential: { issuer: 'did:key:zWitness' } }],
      }
    )
    expect(result.ok).toBe(true)
    expect(result.checked).toEqual(
      expect.arrayContaining(['absolute IRI', 'in accept-list', 'objectKind', 'taskContextRequired', 'additional member witnessContext'])
    )
  })

  it('rejects dtg:witnessed when taskContext is required but absent', () => {
    const result = verify(config, {
      credentialSubject: { id: 'did:key:zWitness', predicate: DTG_PREDICATE_WITNESSED, object: { digestMultibase: 'zQmTargetDigest' } },
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/taskContext required but absent/)
  })

  it('rejects dtg:witnessed when object carries the wrong kind', () => {
    const result = verify(config, {
      credentialSubject: { predicate: DTG_PREDICATE_WITNESSED, object: { value: 'wrong-kind' } },
      taskContext: 'urn:uuid:session-abc',
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/object kind value not permitted/)
  })

  it("rejects dtg:witnessed's subjectObjectRelationship: subject must equal the referenced credential's issuer", () => {
    const result = verify(
      config,
      {
        credentialSubject: {
          id: 'did:key:zNotTheIssuer',
          predicate: DTG_PREDICATE_WITNESSED,
          object: { digestMultibase: 'zQmTargetDigest' },
        },
        taskContext: 'urn:uuid:session-abc',
      },
      {
        relations: { [DTG_PREDICATE_WITNESSED]: 'subjectIsReferencedIssuer' },
        referenced: [{ digestMultibase: 'zQmTargetDigest', credential: { issuer: 'did:key:zWitness' } }],
      }
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/subjectIsReferencedIssuer/)
  })

  it('flags subjectObjectRelationship as unchecked when the caller supplies no relation to check', () => {
    const result = verify(config, {
      credentialSubject: { id: 'did:key:zWitness', predicate: DTG_PREDICATE_WITNESSED, object: { digestMultibase: 'zQmTargetDigest' } },
      taskContext: 'urn:uuid:session-abc',
    })
    expect(result.ok).toBe(true)
    expect(result.unchecked).toContain('subjectObjectRelationship (free text)')
  })

  it('accepts a well-formed dtg:endorses credential with no taskContext', () => {
    const result = verify(config, {
      credentialSubject: { id: 'did:key:zSubject', predicate: DTG_PREDICATE_ENDORSES, object: { value: { skill: 'welding', level: 3 } } },
    })
    expect(result.ok).toBe(true)
    expect(result.unchecked).toContain('minimumIssuerScope (no credential property carries a declared scope — cred-spec #46)')
  })

  it('ignores undefined credentialSubject members rather than rejecting them (PR #47 profile item 5)', () => {
    const result = verify(config, {
      credentialSubject: {
        id: 'did:key:zSubject',
        predicate: DTG_PREDICATE_ENDORSES,
        object: { value: { skill: 'welding' } },
        someFutureExtensionMember: 'anything',
      },
    })
    expect(result.ok).toBe(true)
    expect(result.ignored).toContain('someFutureExtensionMember')
  })
})
