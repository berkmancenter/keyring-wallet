import { CONTACT_LINK, NO_CONTACT_LINKS, loadContactLinks } from '../../../src/modules/vrc/contacts/contactLinks'
import { findMergeCandidates, mergeContacts, separateContact } from '../../../src/modules/vrc/contacts/mergeContacts'
import { createDTGCredential, generateTestDid } from './fixtures/dtg-credentials'
import { memoryGenericRecords } from './fixtures/memoryGenericRecords'
import { ALICE_AGAIN, ALICE_FIRST, BOB, SEVERAL_RELATIONSHIPS } from './fixtures/severalRelationships'

const agentWith = (store = memoryGenericRecords()) => ({ agent: { genericRecords: store } as any, store })

describe('merge candidates', () => {
  test('a contact whose cards give the same name is offered; someone else is not', () => {
    expect(findMergeCandidates(SEVERAL_RELATIONSHIPS, NO_CONTACT_LINKS, ALICE_AGAIN.id)).toEqual([
      { issuerId: ALICE_FIRST.id, name: 'Alice Smith' },
    ])
    expect(findMergeCandidates(SEVERAL_RELATIONSHIPS, NO_CONTACT_LINKS, ALICE_FIRST.id)).toEqual([
      { issuerId: ALICE_AGAIN.id, name: 'Alice Smith' },
    ])
    expect(findMergeCandidates(SEVERAL_RELATIONSHIPS, NO_CONTACT_LINKS, BOB.id)).toEqual([])
  })

  test('the same name with a different email is not offered', () => {
    const otherAlice = { id: generateTestDid('alice-other'), name: 'Alice Smith', email: 'alice@elsewhere.org' }
    const records = [
      ...SEVERAL_RELATIONSHIPS,
      createDTGCredential({
        issuer: otherAlice,
        credentialSubject: { id: 'did:peer:holder' },
        validFrom: '2026-04-01',
      }),
    ]
    const offered = findMergeCandidates(records, NO_CONTACT_LINKS, ALICE_AGAIN.id).map((c) => c.issuerId)
    expect(offered).toEqual([ALICE_FIRST.id])
  })

  test('relationships already merged are not offered again', () => {
    const links = new Map([[ALICE_AGAIN.id, ALICE_FIRST.id]])
    expect(findMergeCandidates(SEVERAL_RELATIONSHIPS, links, ALICE_AGAIN.id)).toEqual([])
  })
})

describe('merge and separate', () => {
  test('a merge links the newer relationship to the older contact, marked as the person’s own word', async () => {
    const { agent, store } = agentWith()
    await mergeContacts(agent, SEVERAL_RELATIONSHIPS, NO_CONTACT_LINKS, ALICE_AGAIN.id, ALICE_FIRST.id)
    expect(store.records).toEqual([
      expect.objectContaining({
        content: { issuerDid: ALICE_AGAIN.id, contactId: ALICE_FIRST.id },
        tags: { recordType: CONTACT_LINK, issuerDid: ALICE_AGAIN.id, contactId: ALICE_FIRST.id, confirmation: 'user' },
      }),
    ])
    expect([...(await loadContactLinks(agent))]).toEqual([[ALICE_AGAIN.id, ALICE_FIRST.id]])
  })

  test('the older contact is kept whichever side starts the merge', async () => {
    const { agent } = agentWith()
    await mergeContacts(agent, SEVERAL_RELATIONSHIPS, NO_CONTACT_LINKS, ALICE_FIRST.id, ALICE_AGAIN.id)
    expect([...(await loadContactLinks(agent))]).toEqual([[ALICE_AGAIN.id, ALICE_FIRST.id]])
  })

  test('separating undoes the merge, and only contact links were ever written or removed', async () => {
    const { agent, store } = agentWith()
    await mergeContacts(agent, SEVERAL_RELATIONSHIPS, NO_CONTACT_LINKS, ALICE_AGAIN.id, ALICE_FIRST.id)
    await separateContact(agent, await loadContactLinks(agent), ALICE_AGAIN.id)
    expect(await loadContactLinks(agent)).toBe(NO_CONTACT_LINKS)
    for (const call of store.save.mock.calls) expect(call[0].tags.recordType).toBe(CONTACT_LINK)
    for (const call of store.findAllByQuery.mock.calls) expect(call[0].recordType).toBe(CONTACT_LINK)
  })

  test('separating one contact leaves another merged contact as it was', async () => {
    const { agent, store } = agentWith()
    store.records.push({
      id: 'other-merge',
      content: { issuerDid: 'did:peer:carol-again', contactId: 'did:peer:carol' },
      tags: { recordType: CONTACT_LINK, issuerDid: 'did:peer:carol-again', contactId: 'did:peer:carol' },
    })
    await mergeContacts(agent, SEVERAL_RELATIONSHIPS, await loadContactLinks(agent), ALICE_AGAIN.id, ALICE_FIRST.id)
    await separateContact(agent, await loadContactLinks(agent), ALICE_FIRST.id)
    expect([...(await loadContactLinks(agent))]).toEqual([['did:peer:carol-again', 'did:peer:carol']])
  })

  test('merging into an older contact moves every relationship to it: no link points at another link', async () => {
    const aliceOldest = { id: generateTestDid('alice-oldest'), name: 'Alice Smith', email: 'alice@example.com' }
    const records = [
      ...SEVERAL_RELATIONSHIPS,
      createDTGCredential({
        issuer: aliceOldest,
        credentialSubject: { id: 'did:peer:holder' },
        validFrom: '2025-12-01',
      }),
    ]
    const { agent } = agentWith()
    await mergeContacts(agent, records, NO_CONTACT_LINKS, ALICE_AGAIN.id, ALICE_FIRST.id)
    await mergeContacts(agent, records, await loadContactLinks(agent), ALICE_AGAIN.id, aliceOldest.id)
    const links = await loadContactLinks(agent)
    expect(new Map(links)).toEqual(
      new Map([
        [ALICE_AGAIN.id, aliceOldest.id],
        [ALICE_FIRST.id, aliceOldest.id],
      ])
    )
    for (const contactId of links.values()) expect(links.has(contactId)).toBe(false)
  })
})
