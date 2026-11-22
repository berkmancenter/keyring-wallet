import { CONTACT_LINK, NO_CONTACT_LINKS, loadContactLinks } from '../../../src/modules/vrc/contacts/contactLinks'
import {
  findMergeCandidates,
  mergeAllContacts,
  mergeContacts,
  separateContact,
} from '../../../src/modules/vrc/contacts/mergeContacts'
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
        content: { issuerDid: ALICE_AGAIN.id, contactId: ALICE_FIRST.id, confirmation: 'user' },
        tags: { recordType: CONTACT_LINK, issuerDid: ALICE_AGAIN.id, contactId: ALICE_FIRST.id },
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

describe('merging every namesake at once', () => {
  const ALICE_THIRD = { id: generateTestDid('alice-third'), name: 'Alice Smith', email: 'alice@example.com' }
  const threeAlices = [
    ...SEVERAL_RELATIONSHIPS,
    createDTGCredential({ issuer: ALICE_THIRD, credentialSubject: { id: 'did:peer:holder' }, validFrom: '2026-06-01' }),
  ]

  test('every other contact with the name is offered, newest first', () => {
    expect(findMergeCandidates(threeAlices, NO_CONTACT_LINKS, ALICE_AGAIN.id).map((c) => c.issuerId)).toEqual([
      ALICE_THIRD.id,
      ALICE_FIRST.id,
    ])
  })

  test('three namesakes become one contact in one step, under the oldest, with no link pointing at a link', async () => {
    const { agent, store } = agentWith()
    await mergeAllContacts(agent, threeAlices, NO_CONTACT_LINKS, [ALICE_THIRD.id, ALICE_AGAIN.id, ALICE_FIRST.id])
    const links = await loadContactLinks(agent)
    expect(new Map(links)).toEqual(
      new Map([
        [ALICE_AGAIN.id, ALICE_FIRST.id],
        [ALICE_THIRD.id, ALICE_FIRST.id],
      ])
    )
    for (const contactId of links.values()) expect(links.has(contactId)).toBe(false)
    for (const record of store.records) expect(record.content.confirmation).toBe('user')
  })

  test('the oldest contact is kept wherever it comes in the list', async () => {
    const { agent } = agentWith()
    await mergeAllContacts(agent, threeAlices, NO_CONTACT_LINKS, [ALICE_FIRST.id, ALICE_THIRD.id, ALICE_AGAIN.id])
    expect(new Set((await loadContactLinks(agent)).values())).toEqual(new Set([ALICE_FIRST.id]))
  })

  test('a contact already merged is offered a namesake that came later, and takes it in without a chain', async () => {
    const { agent } = agentWith()
    await mergeContacts(agent, threeAlices, NO_CONTACT_LINKS, ALICE_AGAIN.id, ALICE_FIRST.id)
    const merged = await loadContactLinks(agent)
    expect(findMergeCandidates(threeAlices, merged, ALICE_AGAIN.id).map((c) => c.issuerId)).toEqual([ALICE_THIRD.id])
    await mergeAllContacts(agent, threeAlices, merged, [ALICE_AGAIN.id, ALICE_THIRD.id])
    const links = await loadContactLinks(agent)
    expect(new Map(links)).toEqual(
      new Map([
        [ALICE_AGAIN.id, ALICE_FIRST.id],
        [ALICE_THIRD.id, ALICE_FIRST.id],
      ])
    )
    expect(findMergeCandidates(threeAlices, links, ALICE_THIRD.id)).toEqual([])
  })

  test('relationships of one contact only, or one relationship, write nothing', async () => {
    const { agent, store } = agentWith()
    await mergeAllContacts(agent, threeAlices, NO_CONTACT_LINKS, [ALICE_FIRST.id])
    await mergeAllContacts(agent, threeAlices, new Map([[ALICE_AGAIN.id, ALICE_FIRST.id]]), [
      ALICE_AGAIN.id,
      ALICE_FIRST.id,
    ])
    expect(store.save).not.toHaveBeenCalled()
    expect(store.deleteById).not.toHaveBeenCalled()
  })

  test('separating after a merge of three makes every relationship its own contact again', async () => {
    const { agent } = agentWith()
    await mergeAllContacts(agent, threeAlices, NO_CONTACT_LINKS, [ALICE_THIRD.id, ALICE_AGAIN.id, ALICE_FIRST.id])
    await separateContact(agent, await loadContactLinks(agent), ALICE_THIRD.id)
    expect(await loadContactLinks(agent)).toBe(NO_CONTACT_LINKS)
  })
})
