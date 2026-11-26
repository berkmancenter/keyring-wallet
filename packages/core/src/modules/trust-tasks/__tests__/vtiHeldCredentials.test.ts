/**
 * A credential the phone holds is one credential, however many times it
 * arrives. Both the vetting screen and the persona inbox store what comes in,
 * so the same statement can be delivered twice; counting it twice read as
 * "2 of 1 statements" to an applicant (seen on the Farm run, 2026-09-23).
 */
import { GenericRecordsCommunityStore, heldCredentialKey, type VtiHeldCredential } from '../module/VtiCommunityStore'

const communityDid = 'did:webvh:QmCommunity:vtc.example'
const statement = (claim: string) => ({
  type: ['VerifiableCredential', 'EndorsementCredential'],
  credentialSubject: { id: 'did:webvh:QmPersona:p', claimsVerified: [claim] },
})

const held = (credential: Record<string, unknown>, receivedAt: string): VtiHeldCredential => ({
  kind: 'vetting-statement',
  communityDid,
  subjectDid: 'did:webvh:QmPersona:p',
  credential,
  receivedAt,
})

describe('naming a held credential', () => {
  it('uses the credential’s own id when it has one', () => {
    expect(heldCredentialKey(held({ id: 'urn:uuid:1', a: 1 }, '2026-09-23T00:00:00Z'))).toBe('urn:uuid:1')
  })

  it('without an id, the same credential gets the same name whenever it arrives', () => {
    const first = heldCredentialKey(held(statement('name.legal'), '2026-09-23T00:00:00Z'))
    const second = heldCredentialKey(held(statement('name.legal'), '2026-09-23T00:00:09Z'))
    expect(second).toBe(first)
  })

  it('a different credential gets a different name', () => {
    expect(heldCredentialKey(held(statement('name.legal'), '2026-09-23T00:00:00Z'))).not.toBe(
      heldCredentialKey(held(statement('address'), '2026-09-23T00:00:00Z'))
    )
  })
})

describe('listing what the phone holds', () => {
  /** A generic-records store that keeps whatever was put in it, duplicates and all. */
  function agentHolding(records: { tags: Record<string, string>; content: unknown }[]) {
    return {
      genericRecords: {
        findAllByQuery: async (query: Record<string, string>) =>
          records.filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v)).map((r, i) => ({ ...r, id: `r${i}` })),
        save: async () => undefined,
        update: async () => undefined,
        delete: async () => undefined,
      },
      config: { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
    } as never
  }

  it('counts one statement once, even when an older record holds it twice', async () => {
    const credential = statement('name.legal')
    const store = new GenericRecordsCommunityStore(
      agentHolding([
        // What the old key wrote: the same credential under two arrival times.
        { tags: { recordType: 'keyring/vti-community', kind: 'credential', key: 'vetting-statement:c:1' }, content: held(credential, '2026-09-23T10:00:00Z') },
        { tags: { recordType: 'keyring/vti-community', kind: 'credential', key: 'vetting-statement:c:2' }, content: held(credential, '2026-09-23T10:00:09Z') },
      ])
    )
    const list = await store.listHeldCredentials('vetting-statement', communityDid)
    expect(list).toHaveLength(1)
    // The first arrival is the one kept.
    expect(list[0].receivedAt).toBe('2026-09-23T10:00:00Z')
  })

  it('keeps two genuinely different statements', async () => {
    const store = new GenericRecordsCommunityStore(
      agentHolding([
        { tags: { recordType: 'keyring/vti-community', kind: 'credential', key: 'a' }, content: held(statement('name.legal'), '2026-09-23T10:00:00Z') },
        { tags: { recordType: 'keyring/vti-community', kind: 'credential', key: 'b' }, content: held(statement('address'), '2026-09-23T10:00:01Z') },
      ])
    )
    expect(await store.listHeldCredentials('vetting-statement', communityDid)).toHaveLength(2)
  })
})
