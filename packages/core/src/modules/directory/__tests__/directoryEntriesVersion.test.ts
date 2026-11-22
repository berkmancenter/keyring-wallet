/**
 * The members list at the community's own version of `vtc/directory/entries/list`: vtc-service 0.16 serves it at 0.2
 * only (`trust_tasks/directory_tasks.rs`, `entries::{list::v0_2 …}`), 0.12 at 0.1 only. 0.2 asks the same and leaves
 * `nextCursor` out on the last page where 0.1 sent `null` (trust-tasks-tf `specs/vtc/directory/entries/list/0.2`).
 */
import { AgentDirectoryService, type DirectoryBackend } from '../directoryService'
import { DirectoryRefused } from '../types'
import { DIRECTORY_TASK } from '../wire'

const COMMUNITY = 'did:webvh:community:a'

const refusal = (code: string) => Object.assign(new Error(`refused: ${code}`), { name: 'VtiRefusal', code })

const entry = (n: number) => ({ entryId: `dir_member000000000${n}`, fields: { displayName: `Member ${n}` } })

/** A community serving the members list at `serves` only; `fail` makes its next answer an error instead. */
function community(serves: string) {
  let fail: Error | undefined
  const communityTask = jest.fn(async (_did: string, type: string, payload: Record<string, unknown>) => {
    if (fail) {
      const e = fail
      fail = undefined
      throw e
    }
    if (type !== serves) throw refusal(type === DIRECTORY_TASK.entriesList02 ? 'unsupportedVersion' : 'unsupportedType')
    const last = payload.cursor === 'p2'
    const items = last ? [entry(3)] : [entry(1), entry(2)]
    if (serves === DIRECTORY_TASK.entriesList02) return last ? { items } : { items, nextCursor: 'p2' }
    return { items, nextCursor: last ? null : 'p2' }
  })
  const backend: DirectoryBackend = { communityTask }
  const sent = () => communityTask.mock.calls.map(([, type]) => type)
  return { backend, sent, failNext: (e: Error) => (fail = e) }
}

describe("the members list at the community's version", () => {
  it('a 0.16 community is asked 0.2, and its next page goes straight to 0.2', async () => {
    const { backend, sent } = community(DIRECTORY_TASK.entriesList02)
    const service = new AgentDirectoryService(backend)
    const first = await service.listMembers(COMMUNITY)
    expect(first.nextCursor).toBe('p2')
    expect(first.rows.map((r) => r.name)).toEqual(['Member 1', 'Member 2'])
    const last = await service.listMembers(COMMUNITY, first.nextCursor)
    expect(last.nextCursor).toBeUndefined()
    expect(last.rows.map((r) => r.name)).toEqual(['Member 3'])
    expect(sent()).toEqual([DIRECTORY_TASK.entriesList02, DIRECTORY_TASK.entriesList02])
  })

  it('a 0.12 community refuses 0.2, answers 0.1, and its next page starts at 0.1', async () => {
    const { backend, sent } = community(DIRECTORY_TASK.entriesList)
    const service = new AgentDirectoryService(backend)
    const first = await service.listMembers(COMMUNITY)
    expect(first.nextCursor).toBe('p2')
    const last = await service.listMembers(COMMUNITY, first.nextCursor)
    expect(last.nextCursor).toBeUndefined() // 0.1's `null`
    expect(last.rows.map((r) => r.name)).toEqual(['Member 3'])
    expect(sent()).toEqual([DIRECTORY_TASK.entriesList02, DIRECTORY_TASK.entriesList, DIRECTORY_TASK.entriesList])
  })

  it('a timeout is not taken for an unserved version: no other version is asked', async () => {
    const { backend, sent, failNext } = community(DIRECTORY_TASK.entriesList02)
    const service = new AgentDirectoryService(backend)
    failNext(new Error('the community did not answer in time'))
    await expect(service.listMembers(COMMUNITY)).rejects.toThrow('did not answer in time')
    expect(sent()).toEqual([DIRECTORY_TASK.entriesList02])
  })

  it('a refusal for another reason is the answer, at the version asked', async () => {
    const { backend, sent, failNext } = community(DIRECTORY_TASK.entriesList02)
    const service = new AgentDirectoryService(backend)
    failNext(refusal('notMember'))
    await expect(service.listMembers(COMMUNITY)).rejects.toBeInstanceOf(DirectoryRefused)
    expect(sent()).toEqual([DIRECTORY_TASK.entriesList02])
  })

  it('a failure on both versions does not change the version a community is asked first', async () => {
    const { backend, sent, failNext } = community(DIRECTORY_TASK.entriesList)
    const service = new AgentDirectoryService(backend)
    await service.listMembers(COMMUNITY) // learns 0.1
    failNext(refusal('unsupportedType')) // 0.1 refused this once
    await expect(service.listMembers(COMMUNITY)).rejects.toBeInstanceOf(DirectoryRefused) // and 0.2 is not served
    await service.listMembers(COMMUNITY)
    expect(sent().slice(-3)).toEqual([
      DIRECTORY_TASK.entriesList,
      DIRECTORY_TASK.entriesList02,
      DIRECTORY_TASK.entriesList,
    ])
  })
})
