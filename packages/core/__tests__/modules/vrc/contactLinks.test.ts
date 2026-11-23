import {
  CONTACT_LINK,
  NO_CONTACT_LINKS,
  contactIdOf,
  loadContactLinks,
  relationshipsOfContact,
  sameContactLinks,
} from '../../../src/modules/vrc/contacts/contactLinks'

const agentWith = (records: { content: unknown }[]) =>
  ({ genericRecords: { findAllByQuery: jest.fn(async () => records) } }) as any

describe('contact links', () => {
  test('a relationship with no link is its own contact, and a group of one', () => {
    expect(contactIdOf(NO_CONTACT_LINKS, 'did:peer:a')).toBe('did:peer:a')
    expect(relationshipsOfContact(NO_CONTACT_LINKS, 'did:peer:a')).toEqual(['did:peer:a'])
  })

  test('linked relationships share the first relationship as their contact, from either end', () => {
    const links = new Map([
      ['did:peer:again', 'did:peer:first'],
      ['did:peer:third', 'did:peer:first'],
    ])
    expect(contactIdOf(links, 'did:peer:again')).toBe('did:peer:first')
    expect(relationshipsOfContact(links, 'did:peer:again')).toEqual([
      'did:peer:again',
      'did:peer:first',
      'did:peer:third',
    ])
    expect(relationshipsOfContact(links, 'did:peer:first')).toEqual([
      'did:peer:first',
      'did:peer:again',
      'did:peer:third',
    ])
    // Positive control: someone else stays a group of one.
    expect(relationshipsOfContact(links, 'did:peer:other')).toEqual(['did:peer:other'])
  })

  test('loads the stored links by their record type', async () => {
    const agent = agentWith([{ content: { issuerDid: 'did:peer:again', contactId: 'did:peer:first' } }])
    const links = await loadContactLinks(agent)
    expect(agent.genericRecords.findAllByQuery).toHaveBeenCalledWith({ recordType: CONTACT_LINK })
    expect([...links]).toEqual([['did:peer:again', 'did:peer:first']])
  })

  test('no links, malformed records, self links, no store, no agent: the one shared empty map', async () => {
    expect(await loadContactLinks(agentWith([]))).toBe(NO_CONTACT_LINKS)
    expect(
      await loadContactLinks(
        agentWith([
          { content: { issuerDid: 'did:peer:a' } },
          { content: { issuerDid: 'did:peer:a', contactId: 'did:peer:a' } },
          { content: undefined },
        ])
      )
    ).toBe(NO_CONTACT_LINKS)
    expect(await loadContactLinks({} as any)).toBe(NO_CONTACT_LINKS)
    expect(await loadContactLinks(undefined)).toBe(NO_CONTACT_LINKS)
  })

  test('two sets of links are the same when every relationship links to the same contact', () => {
    const links = new Map([['did:peer:again', 'did:peer:first']])
    expect(sameContactLinks(links, new Map([['did:peer:again', 'did:peer:first']]))).toBe(true)
    expect(sameContactLinks(NO_CONTACT_LINKS, new Map())).toBe(true)
    // Same size, same relationship, another contact: not the same.
    expect(sameContactLinks(links, new Map([['did:peer:again', 'did:peer:other']]))).toBe(false)
    expect(sameContactLinks(links, new Map([['did:peer:third', 'did:peer:first']]))).toBe(false)
    expect(sameContactLinks(links, NO_CONTACT_LINKS)).toBe(false)
  })
})
