/**
 * A community's directory statement, as join manifest/0.4 carries it
 * (tf#823): read strictly, because the person is shown it before applying,
 * and a statement that cannot be shown as it stands stops the join. Absent is
 * not "no directory".
 */
import { readManifest } from '../module/joinManifest'
import { MalformedDisclosure, readDirectoryDisclosure } from '../module/directoryDisclosure'
import { disclosedUnder } from '../module/joinSubmission'

import { statement, statementBody } from './fixtures/directoryStatement'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const without = (member: string) => {
  const s = statement() as Record<string, unknown>
  delete s[member]
  return s
}

describe('reading the statement', () => {
  it('reads every member, the community’s own text kept as given', () => {
    const read = readDirectoryDisclosure(statement())
    expect(read.fields).toHaveLength(2)
    expect(read.fields[1]).toMatchObject({
      key: 'org.example.roleNote',
      source: 'admin',
      ceiling: 'members',
      defaultVisibility: 'admins',
      description: 'What the <b>admins</b> say you do',
    })
    expect(read.newCard).toEqual({ listing: 'findable', search: 'byName', introductions: 'connections' })
    expect(read.membershipIdentifiers).toBe('admins')
    expect(read.adminNotes).toBe(true)
    expect(read.groups).toEqual({ credentialValidity: 'P30D' })
    expect(read.externalCards).toBe(false)
    expect(read.statementDigest).toMatch(/^zQm/)
  })

  it('ignores members it does not need, as a draft may add them', () => {
    expect(() =>
      readDirectoryDisclosure({ ...statementBody(), later: 1, ext: {}, statementDigest: 'uAnother' })
    ).not.toThrow()
  })

  it.each(['fields', 'newCard', 'membershipIdentifiers', 'adminNotes', 'externalCards', 'statementDigest'])(
    'stops when the required member %s is missing',
    (member) => {
      expect(() => readDirectoryDisclosure(without(member))).toThrow(MalformedDisclosure)
    }
  )

  it.each([
    ['an unknown audience on a field', { fields: [{ ...statementBody().fields[0], ceiling: 'everyone' }] }],
    ['an unknown default audience', { fields: [{ ...statementBody().fields[0], defaultVisibility: 'friends' }] }],
    ['an unknown source', { fields: [{ ...statementBody().fields[0], source: 'someone' }] }],
    ['a field with no label', { fields: [{ ...statementBody().fields[0], label: '' }] }],
    ['an unknown listing', { newCard: { listing: 'everywhere', search: 'byName' } }],
    ['an unknown search', { newCard: { listing: 'listed', search: 'all' } }],
    ['an unknown audience for the DID', { membershipIdentifiers: 'world' }],
    ['adminNotes that is not true or false', { adminNotes: 'yes' }],
  ])('stops on %s', (_, change) => {
    expect(() => readDirectoryDisclosure({ ...statement(), ...change })).toThrow(MalformedDisclosure)
  })

  it('stops when a digest in the recommended form does not name this statement', () => {
    expect(() => readDirectoryDisclosure({ ...statement(), adminNotes: false })).toThrow(/does not name this statement/)
  })

  it('keeps a digest in another form as given: it computes only the recommended one', () => {
    expect(readDirectoryDisclosure({ ...statementBody(), statementDigest: 'mEiB…' }).statementDigest).toBe('mEiB…')
  })
})

describe('the manifest', () => {
  it('at 0.4 carries the statement, read; at 0.3 carries none, even if a member says otherwise', () => {
    const at04 = readManifest({ criteria: [], directoryDisclosure: statement() }, '0.4')
    expect(at04.directoryDisclosure?.statementDigest).toBe(statement().statementDigest)
    const at03 = readManifest({ criteria: [], directoryDisclosure: statement() }, '0.3')
    expect(at03).not.toHaveProperty('directoryDisclosure')
  })

  it('at 0.4 with no statement says nothing about a directory', () => {
    expect(readManifest({ criteria: [] }, '0.4')).not.toHaveProperty('directoryDisclosure')
  })

  it('at 0.4 with a statement that cannot be shown fails to read', () => {
    expect(() => readManifest({ criteria: [], directoryDisclosure: without('newCard') }, '0.4')).toThrow(
      MalformedDisclosure
    )
  })
})

describe('the join record', () => {
  it('keeps the statement’s digest when one was shown, and nothing when none was', () => {
    const shown = readManifest({ criteria: [], directoryDisclosure: statement() }, '0.4')
    expect(disclosedUnder(shown)).toEqual({ directoryStatementDigest: statement().statementDigest })
    expect(disclosedUnder(readManifest({ criteria: [] }, '0.3'))).toEqual({})
  })
})
