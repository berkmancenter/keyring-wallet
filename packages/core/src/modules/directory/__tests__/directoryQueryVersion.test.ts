/**
 * A room author's card at the community's own version of `vtc/directory/query`. 0.2 asks the same as 0.1 and its
 * answer also names the member's directory entry (trust-tasks-tf `specs/vtc/directory/query/0.2`, #1383 at
 * ccb265eeb; VTI #2827 at 507cd6ff3 serves it beside 0.1), which the card's picture and badges are read by. A
 * community before 0.2 refuses it as an unsupported type, is asked 0.1, and its card has no entry.
 */
import { AgentDirectoryService, type DirectoryBackend } from '../directoryService'
import { DirectoryRefused } from '../types'
import { DIRECTORY_TASK, queryEntryId } from '../wire'

const COMMUNITY = 'did:webvh:community:a'
const ANA = 'did:key:ana'
const ENTRY = 'dir_3pQkV7wXyZ1aB2cD4eF6gH'

const refusal = (code: string) => Object.assign(new Error(`refused: ${code}`), { name: 'VtiRefusal', code })

const DEFS = {
  fields: [
    {
      key: 'displayName',
      label: 'Name',
      type: 'text',
      source: 'member',
      base: true,
      ceiling: 'public',
      defaultVisibility: 'members',
      required: false,
      searchable: true,
      facet: false,
      order: 1,
      state: 'active',
    },
  ],
}

/**
 * A community serving `query` at `serves` only, answering about Ana with `entryId` at 0.2 (`entryId: undefined` leaves
 * it out); `fail` makes its next query answer an error instead.
 */
function community(serves: string, over: { entryId?: string; subject?: string } = { entryId: ENTRY }) {
  let fail: Error | undefined
  const communityTask = jest.fn(
    async (_did: string, type: string, payload: Record<string, unknown>): Promise<unknown> => {
      if (type === DIRECTORY_TASK.fieldsList) return DEFS
      if (fail) {
        const e = fail
        fail = undefined
        throw e
      }
      if (type !== serves) throw refusal('unsupportedType')
      const subject = over.subject ?? payload.subject
      const fields = { displayName: 'Ana Lopez', did: subject }
      // Both answer an entry here when asked to: what the phone takes is only 0.2's.
      return over.entryId === undefined ? { subject, fields } : { subject, entryId: over.entryId, fields }
    }
  )
  const backend: DirectoryBackend = { communityTask }
  const sent = () => communityTask.mock.calls.map(([, type]) => type).filter((t) => t !== DIRECTORY_TASK.fieldsList)
  return { backend, sent, communityTask, failNext: (e: Error) => (fail = e) }
}

describe("a room author's card at the community's version of query", () => {
  it('a community serving 0.2 is asked 0.2, its card carries the entry, and the next card goes straight to 0.2', async () => {
    const { backend, sent, communityTask } = community(DIRECTORY_TASK.query02)
    const service = new AgentDirectoryService(backend)
    const card = await service.memberCardByDid(COMMUNITY, ANA)
    expect(card?.name).toBe('Ana Lopez')
    expect(card?.entryId).toBe(ENTRY)
    expect(communityTask.mock.calls[0][2]).toEqual({ subject: ANA }) // the request is 0.1's
    await service.memberCardByDid(COMMUNITY, 'did:key:bo')
    expect(sent()).toEqual([DIRECTORY_TASK.query02, DIRECTORY_TASK.query02])
  })

  it.each(['unsupportedType', 'unsupportedVersion'])(
    'a community before 0.2 refuses it (%s), answers 0.1, its card has no entry, and the next starts at 0.1',
    async (code) => {
      const { backend, sent, communityTask } = community(DIRECTORY_TASK.query)
      communityTask.mockImplementationOnce(async () => {
        throw refusal(code)
      })
      const service = new AgentDirectoryService(backend)
      const card = await service.memberCardByDid(COMMUNITY, ANA)
      expect(card?.name).toBe('Ana Lopez')
      expect(card).not.toHaveProperty('entryId') // 0.1 answered one here: it is not taken
      await service.memberCardByDid(COMMUNITY, 'did:key:bo')
      expect(sent()).toEqual([DIRECTORY_TASK.query02, DIRECTORY_TASK.query, DIRECTORY_TASK.query])
    }
  )

  it.each([
    ['names none', undefined],
    ['names one that is not an entry id', 'entry-7'],
    ['names one too short to be an entry id', 'dir_short'],
    ['names a DID in its place', ANA],
  ])('a 0.2 answer that %s gives the card with no entry', async (_w, entryId) => {
    const { backend } = community(DIRECTORY_TASK.query02, { entryId })
    const card = await new AgentDirectoryService(backend).memberCardByDid(COMMUNITY, ANA)
    expect(card?.name).toBe('Ana Lopez') // the card itself still shows
    expect(card).not.toHaveProperty('entryId')
  })

  it('an answer about someone else gives no card and no entry', async () => {
    const { backend } = community(DIRECTORY_TASK.query02, { entryId: ENTRY, subject: 'did:key:bo' })
    expect(await new AgentDirectoryService(backend).memberCardByDid(COMMUNITY, ANA)).toBeUndefined()
    expect(queryEntryId({ subject: 'did:key:bo', entryId: ENTRY }, ANA)).toBeUndefined()
    expect(queryEntryId({ subject: ANA, entryId: ENTRY }, ANA)).toBe(ENTRY) // control
  })

  it('"not shown to you" at 0.2 is no card, and 0.1 is not asked: the community serves 0.2', async () => {
    const { backend, sent, failNext } = community(DIRECTORY_TASK.query02)
    const service = new AgentDirectoryService(backend)
    failNext(Object.assign(refusal('taskFailed'), { details: { code: 'vtc/directory/query:notFound' } }))
    expect(await service.memberCardByDid(COMMUNITY, ANA)).toBeUndefined()
    expect((await service.memberCardByDid(COMMUNITY, 'did:key:bo'))?.entryId).toBe(ENTRY)
    expect(sent()).toEqual([DIRECTORY_TASK.query02, DIRECTORY_TASK.query02])
  })

  it('a timeout is not taken for an unserved version: no other version is asked', async () => {
    const { backend, sent, failNext } = community(DIRECTORY_TASK.query02)
    const service = new AgentDirectoryService(backend)
    failNext(new Error('the community did not answer in time'))
    await expect(service.memberCardByDid(COMMUNITY, ANA)).rejects.toThrow('did not answer in time')
    expect(sent()).toEqual([DIRECTORY_TASK.query02])
  })

  it('a refusal for another reason is the answer, at the version asked', async () => {
    const { backend, sent, failNext } = community(DIRECTORY_TASK.query02)
    const service = new AgentDirectoryService(backend)
    failNext(refusal('rateLimited'))
    await expect(service.memberCardByDid(COMMUNITY, ANA)).rejects.toBeInstanceOf(DirectoryRefused)
    expect(sent()).toEqual([DIRECTORY_TASK.query02])
  })

  it('a room author’s name is still asked at 0.1, for the name only, after a card at 0.2', async () => {
    const { backend, communityTask } = community(DIRECTORY_TASK.query02)
    communityTask.mockImplementation(async (_did, type, payload) => {
      if (type === DIRECTORY_TASK.fieldsList) return DEFS
      return { subject: payload.subject, entryId: ENTRY, fields: { displayName: 'Ana Lopez' } }
    })
    const service = new AgentDirectoryService(backend)
    await service.memberCardByDid(COMMUNITY, ANA)
    expect(await service.lookupName(COMMUNITY, ANA)).toBe('Ana Lopez')
    expect(communityTask.mock.calls.at(-1)?.slice(1)).toEqual([
      DIRECTORY_TASK.query,
      { subject: ANA, fields: 'displayName' },
    ])
  })
})
