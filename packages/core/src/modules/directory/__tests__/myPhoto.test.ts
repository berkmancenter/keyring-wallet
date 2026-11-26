import type { Agent } from '@credo-ts/core'

import { keepSentPhoto, loadSentPhoto, photoDigest } from '../myPhoto'

const COMMUNITY = 'did:webvh:community:a'
const OTHER = 'did:webvh:community:b'
const SENT = { profile: photoDigest('data:image/jpeg;base64,AAAA'), card: 'c'.repeat(64) }
const AGAIN = { profile: photoDigest('data:image/jpeg;base64,BBBB'), card: 'd'.repeat(64) }

/** The agent's generic records, as far as this module uses them. It has no delete: forgetting never deletes. */
function fakeAgent() {
  const records = new Map<string, { id: string; content: Record<string, unknown>; tags: Record<string, unknown> }>()
  const genericRecords = {
    findById: jest.fn(async (id: string) => records.get(id) ?? null),
    save: jest.fn(async (r: { id: string; content: Record<string, unknown>; tags: Record<string, unknown> }) => {
      records.set(r.id, { ...r })
    }),
    update: jest.fn(async (r: { id: string; content: Record<string, unknown>; tags: Record<string, unknown> }) => {
      records.set(r.id, { ...r })
    }),
  }
  return { agent: { genericRecords } as unknown as Agent, records }
}

describe('the photo this phone put on a card', () => {
  it('keeps both digests per community and loads them back (control: another community has none)', async () => {
    const { agent } = fakeAgent()
    await keepSentPhoto(agent, COMMUNITY, SENT)
    expect(await loadSentPhoto(agent, COMMUNITY)).toEqual(SENT)
    expect(await loadSentPhoto(agent, OTHER)).toBeUndefined()
  })

  it('forgetting rewrites the record empty: it reads as no photo, and no digest is left behind', async () => {
    const { agent, records } = fakeAgent()
    await keepSentPhoto(agent, COMMUNITY, SENT)
    await keepSentPhoto(agent, COMMUNITY, undefined)
    expect(await loadSentPhoto(agent, COMMUNITY)).toBeUndefined()
    expect(records.get(`directory-my-photo:${COMMUNITY}`)?.content).toEqual({})
    expect(JSON.stringify([...records.values()])).not.toContain(SENT.card)
  })

  it('a photo sent after that is kept again, in the same record', async () => {
    const { agent, records } = fakeAgent()
    await keepSentPhoto(agent, COMMUNITY, SENT)
    await keepSentPhoto(agent, COMMUNITY, undefined)
    await keepSentPhoto(agent, COMMUNITY, AGAIN)
    expect(await loadSentPhoto(agent, COMMUNITY)).toEqual(AGAIN)
    expect(records.size).toBe(1)
  })

  it('forgetting where nothing was kept writes nothing', async () => {
    const { agent, records } = fakeAgent()
    await keepSentPhoto(agent, COMMUNITY, undefined)
    expect(records.size).toBe(0)
  })

  it('a leave racing a save leaves no digest behind', async () => {
    const { agent } = fakeAgent()
    await Promise.all([keepSentPhoto(agent, COMMUNITY, SENT), keepSentPhoto(agent, COMMUNITY, undefined)])
    expect(await loadSentPhoto(agent, COMMUNITY)).toBeUndefined()
  })
})
