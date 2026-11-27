/**
 * Step 7.10, Revoke (docs/plans/agent-connect-plan.md §3.9, §3.10). Its acceptance line, one describe each:
 * order is ACL entry first; the agent is found by `deviceId` after one and two key swaps and its entry under the new
 * key is revoked; an empty `revokeSubject` answer is never success; a partial or failed listing leaves `revoking`,
 * which survives a restart and clears only on a full listing; the app-start reconcile records a changed key (the new
 * subject as `agentDid`, `keyChanged: true`) without moving the record's `id` or the chat; a failed ACL call leaves
 * `revoking` and retries. And Keyring's 7.10 contract for the record: exactly `state` (active or expired -> revoking
 * -> revoked), `lastReconciledAt`, `keyChanged` (only ever to `true`) and `agentDid` are written, each through get,
 * change, put.
 *
 * The VTA side is the real `VtaClient` (its `findAgentEntries` and `revokeSubject`, step 7.4) over a fake `task` that
 * keeps an access list and device bindings, and behaves as the lab measured (ref-25 `l-revoke-after-1-swap` and
 * `-2-swaps`): `acl/revoke` 0.3 on a subject with no entry is refused `subjectNotPresent`, a full removal answers
 * `{entry: null}`, and the device goes with its entry.
 */
import { VTA_TASK, VtaClient } from '../../trust-tasks/module/VtaClient'
import { VtiRefusal } from '../../trust-tasks/module/vtiAgent'
import {
  REVOKE_MAX_ROUNDS,
  RevokableConnection,
  RevokeConnectionStore,
  RevokeDeps,
  reconcileAgents,
  removeAgentEntries,
  revokeAgentConnection,
} from '../revoke'
import { shouldReissueVdc } from '../vdc'

jest.mock('react-native-keychain', () => ({ ACCESS_CONTROL: {}, ACCESSIBLE: {}, STORAGE_TYPE: {} }))

const K_A = 'did:key:z6MkAgentFirstKeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const K_B = 'did:key:z6MkAgentSecondKeyBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const K_C = 'did:key:z6MkAgentThirdKeyCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
const OTHER = 'did:key:z6MkSomeoneElseOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO'
const NOW = Date.parse('2026-11-26T12:00:00Z')

const wireEntry = (subject: string) => ({
  subject,
  role: 'application',
  act: { scope: 'contexts', contexts: ['keyring-memory-abcdefghij'] },
  keys: { scope: 'none' },
  capabilities: { scope: 'listed', grants: [{ capability: 'memory-read' }] },
  purposes: { scope: 'listed', purposes: ['personalisation'] },
  label: 'Notes helper',
})

const binding = (deviceId: string, consumerDid: string) => ({
  deviceId,
  consumerDid,
  consumerKind: { kind: 'service', serviceKind: 'aiAgent' },
  displayName: 'Notes helper',
  registeredAt: '2026-11-25T12:00:00Z',
})

/** A VTA with an access list and device bindings, over the real client. */
function lab() {
  const entries = new Map<string, ReturnType<typeof wireEntry>>()
  const devices = new Map<string, string>() // deviceId -> consumerDid
  const sent: { type: string; payload: Record<string, unknown> }[] = []
  const vtaState = {
    /** Every listing says there is more and can never be continued: incomplete. */
    partial: false,
    /** `acl/revoke` answers `{entry: null}` and removes nothing (an empty answer that is not a removal). */
    revokeDoesNothing: false,
    /** `acl/revoke` is lost: no answer. */
    revokeThrows: false,
    /** Nothing answers at all. */
    down: false,
    /** Called after each `acl/revoke`, to let the agent swap meanwhile. */
    afterRevoke: undefined as undefined | (() => void),
  }
  const register = (deviceId: string, did: string) => {
    entries.set(did, wireEntry(did))
    devices.set(deviceId, did)
  }
  /** `acl/swap-key` by the agent itself: the whole entry, device binding included, moves to `next`. */
  const swap = (deviceId: string, next: string) => {
    const current = devices.get(deviceId) as string
    const entry = entries.get(current) as ReturnType<typeof wireEntry>
    entries.delete(current)
    entries.set(next, { ...entry, subject: next })
    devices.set(deviceId, next)
  }
  const vta = new VtaClient(
    { config: { logger: { info: jest.fn(), warn: jest.fn() } } } as never,
    'did:webvh:a',
    {} as never,
    {}
  )
  jest.spyOn(vta, 'task').mockImplementation(async (type: string, payload: Record<string, unknown>) => {
    sent.push({ type, payload })
    if (vtaState.down) throw new Error('the VTA did not answer')
    const more = vtaState.partial ? { nextCursor: 'again' } : {}
    if (type.includes('/device/list/'))
      return { devices: [...devices].map(([id, did]) => binding(id, did)), ...more } as never
    if (type.includes('/acl/list/')) return { entries: [...entries.values()], ...more } as never
    if (type === VTA_TASK.aclRevoke03) {
      if (vtaState.revokeThrows) throw new Error('lost')
      const subject = payload.subject as string
      if (!vtaState.revokeDoesNothing) {
        if (!entries.has(subject)) throw new VtiRefusal('acl/revoke:subjectNotPresent', 'no entry')
        entries.delete(subject)
        for (const [id, did] of devices) if (did === subject) devices.delete(id)
      }
      vtaState.afterRevoke?.()
      return { entry: null } as never
    }
    throw new Error(`unexpected ${type}`)
  })
  const revokes = () => sent.filter((s) => s.type === VTA_TASK.aclRevoke03).map((s) => s.payload.subject)
  return { vta, vtaState, entries, devices, register, swap, sent, revokes }
}

type Conn = RevokableConnection & {
  chatDid: string
  chatConnectionId: string
  handle: string
  /** Written by another step (the driver's VDC grant), never by 7.10. */
  vdcGrant?: Record<string, unknown>
}

type TestStore = RevokeConnectionStore<Conn> & {
  /** Every record written through this handle, by `put` or `update`, in order. */
  writes: Conn[]
  /** The store calls made through this handle, by name. */
  calls: string[]
}

/**
 * The app's storage: survives a "restart" (a new store over the same map), and returns copies. `update` behaves as
 * #1065's `AgentConnectionStore.update`: it reads the record inside the call, applies `change` to that read and writes
 * the result in the same step (no `await` between them, so nothing lands in between), writes nothing when `change`
 * returns the record it was given, and refuses a change to `id`.
 */
function storage() {
  const disk = new Map<string, string>()
  const read = (id: string) => (disk.has(id) ? (JSON.parse(disk.get(id) as string) as Conn) : undefined)
  const all = () => [...disk.values()].map((v) => JSON.parse(v) as Conn)
  const open = (): TestStore => {
    const writes: Conn[] = []
    const calls: string[] = []
    const write = (record: Conn) => {
      writes.push(record)
      disk.set(record.id, JSON.stringify(record))
    }
    return {
      writes,
      calls,
      list: async () => {
        calls.push('list')
        return all()
      },
      get: async (id) => {
        calls.push('get')
        return read(id)
      },
      put: async (record) => {
        calls.push('put')
        write(record)
      },
      update: async (id, change) => {
        calls.push('update')
        const current = read(id)
        if (!current) return undefined
        const next = change(current)
        if (next === current) return current
        if (next.id !== id) throw new Error('an update cannot change a record id')
        write(next)
        return next
      },
      findByKey: async (did) => {
        calls.push('findByKey')
        return all().find((r) => r.id === did || r.agentDid === did)
      },
      remove: async (id) => {
        calls.push('remove')
        disk.delete(id)
      },
    }
  }
  return { open, disk }
}

const connection = (over: Partial<Conn> = {}): Conn => ({
  id: K_A,
  name: 'Notes helper',
  handle: 'notes-helper',
  agentDid: K_A,
  chatDid: 'did:peer:2.chat',
  chatConnectionId: 'chat-conn-1',
  deviceId: 'dev-1',
  state: 'active',
  keyChanged: false,
  expiresAt: '2026-11-26T16:00:00Z',
  ...over,
})

async function setup(over: Partial<Conn> = {}) {
  const l = lab()
  l.register('dev-1', K_A)
  l.register('dev-9', OTHER)
  const disk = storage()
  const store = disk.open()
  await store.put(connection(over))
  // From here on, `store.calls` are 7.10's (and any a test makes itself).
  store.calls.length = 0
  const order: string[] = []
  const tellAgent = jest.fn(async () => {
    order.push('tell')
  })
  const deps: RevokeDeps<Conn> = { store, vta: l.vta, tellAgent, now: () => NOW }
  return { ...l, disk, store, deps, tellAgent, order }
}

describe('order: the ACL entry first', () => {
  it('writes revoking before any VTA call, revokes the entry, tells the agent, and only then writes revoked', async () => {
    const s = await setup()
    const events: string[] = []
    const update = s.store.update
    s.store.update = (id, change) =>
      update(id, (r) => {
        const next = change(r)
        if (next !== r) events.push(`write:${next.state}`)
        return next
      })
    const task = s.vta.task as jest.Mock
    const real = task.getMockImplementation() as (...args: unknown[]) => Promise<unknown>
    task.mockImplementation(async (...args: unknown[]) => {
      events.push(`vta:${String(args[0]).includes('acl/revoke') ? 'revoke' : 'list'}`)
      return real(...args)
    })
    s.tellAgent.mockImplementation(async () => {
      events.push('tell')
    })
    const out = await revokeAgentConnection(s.deps, K_A)
    expect(out).toEqual({ kind: 'revoked' })
    expect(events[0]).toBe('write:revoking')
    expect(events.indexOf('vta:revoke')).toBeGreaterThan(0)
    expect(events.slice(-2)).toEqual(['tell', 'write:revoked'])
    expect(s.store.writes.map((w) => w.state)).toEqual(['active', 'revoking', 'revoked'])
    expect(s.revokes()).toEqual([K_A])
    expect(s.tellAgent).toHaveBeenCalledTimes(1)
    expect(s.entries.has(K_A)).toBe(false)
    expect(s.entries.has(OTHER)).toBe(true)
  })

  it('no VDC is re-issued once revoke starts, whatever it came to', async () => {
    const s = await setup()
    s.vtaState.down = true
    await revokeAgentConnection(s.deps, K_A)
    const after = (await s.store.get(K_A)) as Conn
    expect(after.state).toBe('revoking')
    const reissue = (state: Conn['state']) =>
      shouldReissueVdc({ state, entryConfirmedPresent: true, grantValidUntil: '2026-11-26T13:00:00Z', now: NOW })
    expect([reissue(after.state), reissue('revoked'), reissue('active')]).toEqual([false, false, true])
  })
})

describe('found by deviceId after the agent swapped its key', () => {
  it.each([
    [1, [K_B]],
    [2, [K_B, K_C]],
  ])('after %i swap(s), the entry under the newest key is revoked', async (_n, keys) => {
    const s = await setup()
    for (const key of keys) s.swap('dev-1', key)
    const newest = keys[keys.length - 1]
    expect(await revokeAgentConnection(s.deps, K_A)).toEqual({ kind: 'revoked' })
    // The stored agentDid (K_A) has no entry any more and is never sent: the device's key is.
    expect(s.revokes()).toEqual([newest])
    expect([...s.entries.keys()]).toEqual([OTHER])
    expect(s.devices.has('dev-1')).toBe(false)
    expect((await s.store.get(K_A))?.state).toBe('revoked')
  })

  it('control: revoking the stored DID alone, as a key-based revoke would, leaves the swapped agent its entry', async () => {
    const s = await setup()
    s.swap('dev-1', K_B)
    await expect(s.vta.revokeSubject(K_A)).rejects.toThrow('no entry')
    expect(s.entries.has(K_B)).toBe(true)
  })

  it('an agent that swaps again mid-revoke is caught on the next round', async () => {
    const s = await setup()
    let swapped = false
    // Revoking K_A races a swap: this VTA moves the entry to K_B before the revoke lands.
    s.vtaState.revokeDoesNothing = true
    s.vtaState.afterRevoke = () => {
      if (swapped) return
      swapped = true
      s.swap('dev-1', K_B)
      s.vtaState.revokeDoesNothing = false
    }
    expect(await revokeAgentConnection(s.deps, K_A)).toEqual({ kind: 'revoked' })
    expect(s.revokes()).toEqual([K_A, K_B])
  })
})

describe('an empty revokeSubject answer is never success', () => {
  it('an answer of {entry: null} with the entry still listed leaves revoking after the rounds', async () => {
    const s = await setup()
    s.vtaState.revokeDoesNothing = true
    // The answer the client gets is empty (undefined), as for a real removal.
    expect(await s.vta.revokeSubject(K_A)).toBeUndefined()
    s.sent.length = 0
    const out = await revokeAgentConnection(s.deps, K_A)
    expect(out).toEqual({ kind: 'notConfirmed', reason: 'entryRemains' })
    expect(s.revokes()).toHaveLength(REVOKE_MAX_ROUNDS)
    expect((await s.store.get(K_A))?.state).toBe('revoking')
  })
})

describe('Revoke not confirmed: partial or failed listings, a restart, and clearing', () => {
  it('a partial listing is never proof: revoking, after a restart too, until a full listing clears it', async () => {
    const s = await setup()
    s.vtaState.partial = true
    expect(await revokeAgentConnection(s.deps, K_A)).toEqual({ kind: 'notConfirmed', reason: 'partialListing' })
    // The entry did go, but no listing ever reached its end: still not confirmed.
    expect(s.entries.has(K_A)).toBe(false)
    expect((await s.store.get(K_A))?.state).toBe('revoking')

    // Restart: a new store over the same storage, the listing still partial.
    const restarted = s.disk.open()
    const again: RevokeDeps<Conn> = { ...s.deps, store: restarted }
    expect(await reconcileAgents(again)).toEqual([
      { id: K_A, kind: 'revoke', outcome: { kind: 'notConfirmed', reason: 'partialListing' } },
    ])
    expect((await restarted.get(K_A))?.state).toBe('revoking')

    // The VTA lists to its end: the next app start clears it.
    s.vtaState.partial = false
    const third: RevokeDeps<Conn> = { ...s.deps, store: s.disk.open() }
    expect(await reconcileAgents(third)).toEqual([{ id: K_A, kind: 'revoke', outcome: { kind: 'revoked' } }])
    expect((await third.store.get(K_A))?.state).toBe('revoked')
    // Told once across all three runs.
    expect(s.tellAgent).toHaveBeenCalledTimes(1)
  })

  it('a refused listing is not confirmed; no answer at all is "couldn\'t reach"', async () => {
    const s = await setup()
    jest.spyOn(s.vta, 'findAgentEntries').mockRejectedValueOnce(new VtiRefusal('forbidden', 'no'))
    expect(await revokeAgentConnection(s.deps, K_A)).toEqual({ kind: 'notConfirmed', reason: 'listingFailed' })
    s.vtaState.down = true
    expect(await revokeAgentConnection(s.deps, K_A)).toEqual({ kind: 'unreachable' })
    expect((await s.store.get(K_A))?.state).toBe('revoking')
  })

  it('a failed ACL call leaves revoking, and the retry finishes it', async () => {
    const s = await setup()
    s.vtaState.revokeThrows = true
    expect(await revokeAgentConnection(s.deps, K_A)).toEqual({ kind: 'notConfirmed', reason: 'entryRemains' })
    expect((await s.store.get(K_A))?.state).toBe('revoking')
    s.vtaState.revokeThrows = false
    // "Try again"
    expect(await revokeAgentConnection(s.deps, K_A)).toEqual({ kind: 'revoked' })
    expect((await s.store.get(K_A))?.state).toBe('revoked')
  })

  it('a second caller joins the revoke in flight', async () => {
    const s = await setup()
    const [a, b] = await Promise.all([revokeAgentConnection(s.deps, K_A), revokeAgentConnection(s.deps, K_A)])
    expect([a, b]).toEqual([{ kind: 'revoked' }, { kind: 'revoked' }])
    expect(s.revokes()).toEqual([K_A])
    expect(s.tellAgent).toHaveBeenCalledTimes(1)
  })

  it('a revoked record answers revoked without a VTA call', async () => {
    const s = await setup({ state: 'revoked' })
    expect(await revokeAgentConnection(s.deps, K_A)).toEqual({ kind: 'revoked' })
    expect(s.sent).toEqual([])
  })

  it('the notice failing changes nothing: it is not relied on', async () => {
    const s = await setup()
    s.tellAgent.mockRejectedValueOnce(new Error('chat down'))
    expect(await revokeAgentConnection(s.deps, K_A)).toEqual({ kind: 'revoked' })
    expect((await s.store.get(K_A))?.state).toBe('revoked')
  })

  it('the agent is not told before the entry is confirmed gone', async () => {
    const s = await setup()
    s.vtaState.partial = true
    await revokeAgentConnection(s.deps, K_A)
    expect(s.tellAgent).not.toHaveBeenCalled()
  })
})

describe("Keyring's 7.10 contract for the record", () => {
  const NEVER = ['currentSubject', 'vdcRevokedAt', 'revokeToldAt']

  /** Every member that differs between two consecutive writes of one record. */
  const changed = (writes: Conn[]) =>
    writes.slice(1).flatMap((w, i) => {
      const before = writes[i] as Record<string, unknown>
      const after = w as Record<string, unknown>
      return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
        (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])
      )
    })

  /** Never written by 7.10: the record's key and the chat. */
  const KEPT = { id: K_A, chatDid: 'did:peer:2.chat', chatConnectionId: 'chat-conn-1', handle: 'notes-helper' }

  it('a changed key, a revoke, its retries and the reconcile write exactly the four members', async () => {
    const s = await setup()
    // The agent swaps its key; the app-start reconcile records it.
    s.swap('dev-1', K_B)
    await reconcileAgents(s.deps)
    expect(await s.store.get(K_A)).toMatchObject({ keyChanged: true, agentDid: K_B })
    s.vtaState.partial = true
    await revokeAgentConnection(s.deps, K_A)
    await reconcileAgents(s.deps)
    s.vtaState.partial = false
    await reconcileAgents(s.deps)
    expect((await s.store.get(K_A))?.state).toBe('revoked')
    expect([...new Set(changed(s.store.writes))].sort()).toEqual([
      'agentDid',
      'keyChanged',
      'lastReconciledAt',
      'state',
    ])
    for (const w of s.store.writes) {
      expect(w).toMatchObject(KEPT)
      for (const k of NEVER) expect(w).not.toHaveProperty(k)
    }
    // Every one of those writes went through `update`; 7.10 never called `put` or `remove`.
    expect(s.store.calls).toContain('update')
    expect(s.store.calls).not.toContain('put')
    expect(s.store.calls).not.toContain('remove')
  })

  it('control: without a changed key, neither keyChanged nor agentDid is written', async () => {
    const s = await setup()
    await reconcileAgents(s.deps)
    await revokeAgentConnection(s.deps, K_A)
    expect([...new Set(changed(s.store.writes))].sort()).toEqual(['lastReconciledAt', 'state'])
    expect(s.store.writes.every((w) => w.keyChanged === false && w.agentDid === K_A)).toBe(true)
  })

  it('after a recorded key change, Revoke uses the stored agentDid as the current key', async () => {
    const s = await setup()
    s.swap('dev-1', K_B)
    await reconcileAgents(s.deps)
    const find = jest.spyOn(s.vta, 'findAgentEntries')
    expect(await revokeAgentConnection(s.deps, K_A)).toEqual({ kind: 'revoked' })
    expect(find).toHaveBeenCalledWith({ deviceId: 'dev-1', subject: K_B })
    expect(s.revokes()).toEqual([K_B])
    expect(await s.store.get(K_A)).toMatchObject({ ...KEPT, agentDid: K_B, state: 'revoked' })
  })

  it('state goes active -> revoking -> revoked, and expired -> revoking -> revoked', async () => {
    for (const from of ['active', 'expired'] as const) {
      const s = await setup({ state: from })
      expect(await revokeAgentConnection(s.deps, K_A)).toEqual({ kind: 'revoked' })
      expect(s.store.writes.map((w) => w.state)).toEqual([from, 'revoking', 'revoked'])
    }
  })

  it('a pairing or not finished record is not revoked, and nothing is sent', async () => {
    for (const from of ['pairing', 'notFinished'] as const) {
      const s = await setup({ state: from })
      await expect(revokeAgentConnection(s.deps, K_A)).rejects.toThrow('cannot be revoked')
      expect(s.sent).toEqual([])
      expect(s.store.writes.map((w) => w.state)).toEqual([from])
    }
  })

  it('a changed key is recorded as the new agentDid and keyChanged: true in one update', async () => {
    for (const keyChanged of [false, true]) {
      const s = await setup({ keyChanged })
      const original = (await s.store.get(K_A)) as Conn
      s.swap('dev-1', K_B)
      const before = s.store.writes.length
      await reconcileAgents(s.deps)
      // One update for the stamp, the new subject and the flag together.
      expect(s.store.writes.length - before).toBe(1)
      expect(s.store.calls.filter((c) => c === 'update')).toHaveLength(1)
      const written = s.store.writes[before] as Conn
      expect(written).toEqual({
        ...original,
        agentDid: K_B,
        keyChanged: true,
        lastReconciledAt: new Date(NOW).toISOString(),
      })
      expect(written).toMatchObject(KEPT)
    }
    // An agent whose key did not change writes neither: a true is not cleared, a false is not set, agentDid stays.
    for (const keyChanged of [false, true]) {
      const s = await setup({ keyChanged })
      await reconcileAgents(s.deps)
      expect(await s.store.get(K_A)).toMatchObject({ ...KEPT, agentDid: K_A, keyChanged })
    }
  })
})

describe('removeAgentEntries: rounds', () => {
  it('stops after the rounds with the entry still there, and a full empty listing first time is confirmation', async () => {
    const s = await setup()
    s.vtaState.revokeDoesNothing = true
    expect(await removeAgentEntries(s.vta, { agentDid: K_A, deviceId: 'dev-1' }, 1)).toEqual({
      kind: 'notConfirmed',
      reason: 'entryRemains',
    })
    expect(s.revokes()).toEqual([K_A])
    expect(await removeAgentEntries(s.vta, { agentDid: 'did:key:z6MkNobody', deviceId: 'dev-none' })).toEqual({
      kind: 'revoked',
    })
  })
})

describe('the app-start reconcile', () => {
  it('records the new subject and keyChanged, and reports it, without moving the record id or the chat', async () => {
    const s = await setup()
    s.swap('dev-1', K_B)
    expect(await reconcileAgents(s.deps)).toEqual([{ id: K_A, kind: 'keyChanged', subject: K_B }])
    // Still found under its first key: the id is the store's key and does not move.
    const after = (await s.store.get(K_A)) as Conn
    expect(await s.store.get(K_B)).toBeUndefined()
    // The new key is the record's `agentDid`, not its `id`: only `findByKey` finds the record by either.
    expect(await s.store.findByKey(K_B)).toEqual(after)
    expect(await s.store.findByKey(K_A)).toEqual(after)
    expect(after).not.toHaveProperty('currentSubject')
    expect(after).toMatchObject({
      id: K_A,
      keyChanged: true,
      agentDid: K_B,
      chatDid: 'did:peer:2.chat',
      chatConnectionId: 'chat-conn-1',
      handle: 'notes-helper',
      state: 'active',
      lastReconciledAt: new Date(NOW).toISOString(),
    })
    expect(s.revokes()).toEqual([])
  })

  it('an unchanged agent is only stamped', async () => {
    const s = await setup()
    expect(await reconcileAgents(s.deps)).toEqual([{ id: K_A, kind: 'unchanged' }])
    expect(await s.store.get(K_A)).toMatchObject({ keyChanged: false, agentDid: K_A })
  })

  it('no entry on a full listing is reported as gone; the state is not changed outside a revoke', async () => {
    for (const from of ['active', 'expired'] as const) {
      const s = await setup({ state: from })
      s.entries.delete(K_A)
      s.devices.delete('dev-1')
      expect(await reconcileAgents(s.deps)).toEqual([{ id: K_A, kind: 'gone' }])
      expect(await s.store.get(K_A)).toMatchObject({ state: from, lastReconciledAt: new Date(NOW).toISOString() })
    }
  })

  it('a partial listing concludes nothing; pairing, not finished and revoked records are left alone', async () => {
    const s = await setup()
    await s.store.put(connection({ id: 'p', state: 'pairing' }))
    await s.store.put(connection({ id: 'n', state: 'notFinished' }))
    await s.store.put(connection({ id: 'r', state: 'revoked' }))
    s.vtaState.partial = true
    s.entries.delete(K_A)
    expect(await reconcileAgents(s.deps)).toEqual([{ id: K_A, kind: 'unknown' }])
    expect((await s.store.get(K_A))?.state).toBe('active')
    s.vtaState.down = true
    expect(await reconcileAgents(s.deps)).toEqual([{ id: K_A, kind: 'unknown' }])
  })

  it('keeps members another step wrote while it ran', async () => {
    const s = await setup()
    s.swap('dev-1', K_B)
    const other = s.disk.open()
    const real = s.vta.findAgentEntries.bind(s.vta)
    jest.spyOn(s.vta, 'findAgentEntries').mockImplementation(async (q) => {
      const out = await real(q)
      await other.update(K_A, (r) => ({ ...r, name: 'Renamed meanwhile' }))
      return out
    })
    await reconcileAgents(s.deps)
    // The rename survives, and the changed key is recorded on top of it.
    expect(await s.store.get(K_A)).toMatchObject({ name: 'Renamed meanwhile', keyChanged: true, agentDid: K_B })
  })
})

describe("7.10 writes through the store's update", () => {
  const GRANT = { validUntil: '2026-11-26T16:00:00Z', proof: 'grant-proof' }

  it('the test store refuses an id change and writes nothing for an unchanged record, as #1065 does', async () => {
    const s = await setup()
    await expect(s.store.update(K_A, (r) => ({ ...r, id: K_B }))).rejects.toThrow('cannot change a record id')
    await s.store.update(K_A, (r) => r)
    expect(s.store.writes).toHaveLength(1)
    expect(await s.store.update('did:key:z6MkNobody', (r) => r)).toBeUndefined()
  })

  it('a revoke, its retry and the reconciles call update and never put or remove', async () => {
    const s = await setup()
    s.swap('dev-1', K_B)
    await reconcileAgents(s.deps)
    s.vtaState.revokeThrows = true
    await revokeAgentConnection(s.deps, K_A)
    s.vtaState.revokeThrows = false
    await reconcileAgents(s.deps)
    expect((await s.store.get(K_A))?.state).toBe('revoked')
    // One update each: the reconcile's key change, -> revoking, -> revoked. A `revoking` retry writes nothing itself.
    expect(s.store.calls.filter((c) => c === 'update')).toHaveLength(4)
    expect(s.store.writes.slice(1).map((w) => w.state)).toEqual(['active', 'revoking', 'revoked'])
    expect(s.store.calls.filter((c) => c === 'put' || c === 'remove')).toEqual([])
  })

  it('a grant another writer adds between the reconcile reading the record and writing it is kept', async () => {
    for (const swapped of [false, true]) {
      const s = await setup()
      if (swapped) s.swap('dev-1', K_B)
      const other = s.disk.open()
      // The reconcile reads the record (list), then asks the VTA; the driver writes its grant while it waits.
      const real = s.vta.findAgentEntries.bind(s.vta)
      jest.spyOn(s.vta, 'findAgentEntries').mockImplementation(async (q) => {
        const out = await real(q)
        await other.update(K_A, (r) => ({ ...r, vdcGrant: GRANT }))
        return out
      })
      const read = (await s.store.get(K_A)) as Conn
      await reconcileAgents(s.deps)
      const after = (await s.store.get(K_A)) as Conn
      const changes = { lastReconciledAt: new Date(NOW).toISOString() }
      expect(after).toEqual({
        ...read,
        vdcGrant: GRANT,
        ...changes,
        ...(swapped ? { agentDid: K_B, keyChanged: true } : {}),
      })
    }
  })

  it('a write landing right after any read 7.10 makes is kept (the lost update a get, then put allowed)', async () => {
    const s = await setup()
    s.swap('dev-1', K_B)
    const other = s.disk.open()
    let n = 0
    // Another writer (the driver) changes the grant right after every `get` or `list` through 7.10's store: with a
    // get, then put, the put would write the record as read and lose the grant.
    const land = async () => {
      n += 1
      const grant = { ...GRANT, n }
      await other.update(K_A, (r) => ({ ...r, vdcGrant: grant }))
    }
    const get = s.store.get
    s.store.get = async (id) => {
      const out = await get(id)
      await land()
      return out
    }
    const list = s.store.list
    s.store.list = async () => {
      const out = await list()
      await land()
      return out
    }
    await reconcileAgents(s.deps)
    expect(await revokeAgentConnection(s.deps, K_A)).toEqual({ kind: 'revoked' })
    expect(n).toBeGreaterThanOrEqual(2)
    expect(await other.get(K_A)).toEqual({
      ...connection(),
      vdcGrant: { ...GRANT, n },
      agentDid: K_B,
      keyChanged: true,
      state: 'revoked',
      lastReconciledAt: new Date(NOW).toISOString(),
    })
  })

  it('a grant another writer adds while the revoke is at the VTA is kept through revoking -> revoked', async () => {
    const s = await setup()
    const other = s.disk.open()
    const real = s.vta.revokeSubject.bind(s.vta)
    jest.spyOn(s.vta, 'revokeSubject').mockImplementation(async (subject) => {
      await other.update(K_A, (r) => ({ ...r, vdcGrant: GRANT }))
      return real(subject)
    })
    expect(await revokeAgentConnection(s.deps, K_A)).toEqual({ kind: 'revoked' })
    expect(await s.store.get(K_A)).toEqual({
      ...connection(),
      vdcGrant: GRANT,
      state: 'revoked',
      lastReconciledAt: new Date(NOW).toISOString(),
    })
  })

  it('the reconcile decides on the record under the lock: one whose agentDid moved meanwhile is not written', async () => {
    const s = await setup()
    s.swap('dev-1', K_B)
    const other = s.disk.open()
    const real = s.vta.findAgentEntries.bind(s.vta)
    jest.spyOn(s.vta, 'findAgentEntries').mockImplementation(async (q) => {
      const out = await real(q)
      // Another reconcile recorded the change first.
      await other.update(K_A, (r) => ({ ...r, agentDid: K_B, keyChanged: true }))
      return out
    })
    expect(await reconcileAgents(s.deps)).toEqual([{ id: K_A, kind: 'unknown' }])
    expect(s.store.writes).toHaveLength(1)
    expect(await s.store.get(K_A)).toMatchObject({ agentDid: K_B, keyChanged: true })
    expect(await s.store.get(K_A)).not.toHaveProperty('lastReconciledAt')
  })

  it('a record revoked meanwhile is not moved back: the reconcile writes nothing on it', async () => {
    const s = await setup()
    const other = s.disk.open()
    const real = s.vta.findAgentEntries.bind(s.vta)
    jest.spyOn(s.vta, 'findAgentEntries').mockImplementation(async (q) => {
      const out = await real(q)
      await other.update(K_A, (r) => ({ ...r, state: 'revoking' }))
      return out
    })
    expect(await reconcileAgents(s.deps)).toEqual([{ id: K_A, kind: 'unknown' }])
    expect(await s.store.get(K_A)).toMatchObject({ state: 'revoking' })
    expect(await s.store.get(K_A)).not.toHaveProperty('lastReconciledAt')
  })
})
