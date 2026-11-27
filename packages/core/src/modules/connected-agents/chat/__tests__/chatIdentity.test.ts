import type { Agent } from '@credo-ts/core'

import { memoryGenericRecords } from '../../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'
import { AgentConnectionStore } from '../../store'
import { agentRecord } from '../../testing/fixtures'
import {
  AgentChatRecordMissing,
  agentChatConnectionId,
  type ChatIdentityKms,
  ensureChatIdentity,
  recordIdOfChatConnection,
} from '../chatIdentity'

// fb-C1 (§3.5, §3.2 step 13): Keyring's pairwise chat key K_c, made once per agent and never moved.

function setup() {
  const genericRecords = memoryGenericRecords()
  const store = new AgentConnectionStore({ genericRecords } as unknown as Agent)
  let n = 0
  const kms: ChatIdentityKms & { createDidKey: jest.Mock } = {
    createDidKey: jest.fn(async () => `did:key:z6MkChat${++n}`),
  }
  return { store, kms }
}

describe('ensureChatIdentity', () => {
  it('makes a fresh did:key and agent-chat:<record id> the first time, and writes both to the record', async () => {
    const { store, kms } = setup()
    const record = agentRecord()
    await store.put(record)

    const identity = await ensureChatIdentity(store, record, kms)

    expect(identity).toEqual({ chatDid: 'did:key:z6MkChat1', chatConnectionId: `agent-chat:${record.id}` })
    expect(kms.createDidKey).toHaveBeenCalledTimes(1)
    const stored = await store.get(record.id)
    expect(stored).toMatchObject(identity)
    // Nothing else on the record moved.
    expect({ ...stored, chatDid: undefined, chatConnectionId: undefined }).toEqual({
      ...record,
      chatDid: undefined,
      chatConnectionId: undefined,
    })
  })

  it('is made once: a second call, even with the stale record handed in, reads it and mints nothing', async () => {
    const { store, kms } = setup()
    const record = agentRecord()
    await store.put(record)

    const first = await ensureChatIdentity(store, record, kms)
    const second = await ensureChatIdentity(store, record, kms)

    expect(second).toEqual(first)
    expect(kms.createDidKey).toHaveBeenCalledTimes(1)
  })

  it('two calls at once make one key, and both see it', async () => {
    const { store, kms } = setup()
    const record = agentRecord()
    await store.put(record)

    const [a, b] = await Promise.all([ensureChatIdentity(store, record, kms), ensureChatIdentity(store, record, kms)])

    expect(a).toEqual(b)
    expect(kms.createDidKey).toHaveBeenCalledTimes(1)
  })

  it('is never moved by a later writer that spreads the record (the reconcile, a rename)', async () => {
    const { store, kms } = setup()
    const record = agentRecord()
    await store.put(record)
    const identity = await ensureChatIdentity(store, record, kms)

    await store.update(record.id, (r) => ({ ...r, name: 'Renamed', agentDid: 'did:key:z6MkRotated' }))

    expect(await store.get(record.id)).toMatchObject({ ...identity, name: 'Renamed', agentDid: 'did:key:z6MkRotated' })
    // The chat connection id names the record, not the agent's current key.
    expect((await ensureChatIdentity(store, (await store.get(record.id))!, kms)).chatConnectionId).toBe(
      `agent-chat:${record.id}`
    )
  })

  it('a record that has a chatDid but no chatConnectionId gets only the connection id', async () => {
    const { store, kms } = setup()
    const record = agentRecord({ chatDid: 'did:key:z6MkKept' })
    await store.put(record)

    expect(await ensureChatIdentity(store, record, kms)).toEqual({
      chatDid: 'did:key:z6MkKept',
      chatConnectionId: `agent-chat:${record.id}`,
    })
    expect(kms.createDidKey).not.toHaveBeenCalled()
  })

  it('a record that is gone is refused, and no key is made', async () => {
    const { store, kms } = setup()
    await expect(ensureChatIdentity(store, agentRecord(), kms)).rejects.toBeInstanceOf(AgentChatRecordMissing)
    expect(kms.createDidKey).not.toHaveBeenCalled()
  })

  // control: an existing chatDid is kept, even when the record handed in (read before another writer set it) has none.
  it('control: an existing chatDid is kept', async () => {
    const { store, kms } = setup()
    const stale = agentRecord()
    await store.put({ ...stale, chatDid: 'did:key:z6MkAlreadyThere', chatConnectionId: `agent-chat:${stale.id}` })

    expect(await ensureChatIdentity(store, stale, kms)).toEqual({
      chatDid: 'did:key:z6MkAlreadyThere',
      chatConnectionId: `agent-chat:${stale.id}`,
    })
    expect(kms.createDidKey).not.toHaveBeenCalled()
    expect((await store.get(stale.id))?.chatDid).toBe('did:key:z6MkAlreadyThere')
  })
})

describe('the chat connection id', () => {
  it('is agent-chat:<record id>, and reads back to the record id', () => {
    expect(agentChatConnectionId('did:key:z6MkA')).toBe('agent-chat:did:key:z6MkA')
    expect(recordIdOfChatConnection('agent-chat:did:key:z6MkA')).toBe('did:key:z6MkA')
  })

  it('a Credo connection id, or the bare prefix, is not an agent chat', () => {
    expect(recordIdOfChatConnection('4f1c2a9e-credo-connection')).toBeUndefined()
    expect(recordIdOfChatConnection('agent-chat:')).toBeUndefined()
  })
})
