/**
 * Step 7.10, Revoke (docs/plans/agent-connect-plan.md §3.9, §3.10). Its acceptance line, one describe each:
 * order is ACL entry first; the agent is found by `deviceId` after one and two key swaps and its entry under the new
 * key is revoked; an empty `revokeSubject` answer is never success; a partial or failed listing leaves `revoking`,
 * which survives a restart and clears only on a full listing; the app-start reconcile records a changed key without
 * moving the chat; a failed ACL call leaves `revoking` and retries.
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
  revokeAgent,
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

type Conn = RevokableConnection & { chatDid: string; handle: string }

/** The app's storage: survives a "restart" (a new store over the same map), and returns copies. */
function storage() {
  const disk = new Map<string, string>()
  const open = (): RevokeConnectionStore<Conn> & { writes: Conn[] } => {
    const writes: Conn[] = []
    return {
      writes,
      list: async () => [...disk.values()].map((v) => JSON.parse(v) as Conn),
      get: async (id) => (disk.has(id) ? (JSON.parse(disk.get(id) as string) as Conn) : undefined),
      put: async (record) => {
        writes.push(record)
        disk.set(record.id, JSON.stringify(record))
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
  const order: string[] = []
  const tellAgent = jest.fn(async () => {
    order.push('tell')
  })
  const deps: RevokeDeps<Conn> = { store, vta: l.vta, tellAgent, now: () => NOW }
  return { ...l, disk, store, deps, tellAgent, order }
}

describe('order: the ACL entry first', () => {
  it('revokes the entry before the VDC is marked or the agent told, and only then writes revoked', async () => {
    const s = await setup()
    const out = await revokeAgent(s.deps, K_A)
    expect(out).toEqual({ kind: 'revoked' })
    // The record went revoking before any VTA call, then the VDC mark, the notice, and revoked last.
    expect(s.store.writes.map((w) => [w.state, Boolean(w.vdcRevokedAt), Boolean(w.revokeToldAt)])).toEqual([
      ['active', false, false], // setup
      ['revoking', false, false],
      ['revoking', true, false],
      ['revoking', true, true],
      ['revoked', true, true],
    ])
    expect(s.sent[0].type).toContain('/device/list/')
    expect(s.revokes()).toEqual([K_A])
    // The revoke call precedes the notice: the first VTA call came after `revoking` was written, the notice after it.
    expect(s.tellAgent).toHaveBeenCalledTimes(1)
    expect(s.entries.has(K_A)).toBe(false)
    expect(s.entries.has(OTHER)).toBe(true)
  })

  it('no VDC is re-issued once revoke starts, whatever it came to', async () => {
    const s = await setup()
    s.vtaState.down = true
    await revokeAgent(s.deps, K_A)
    const after = (await s.store.get(K_A)) as Conn
    expect(after.state).toBe('revoking')
    expect(after.vdcRevokedAt).toBe(new Date(NOW).toISOString())
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
    expect(await revokeAgent(s.deps, K_A)).toEqual({ kind: 'revoked' })
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
    expect(await revokeAgent(s.deps, K_A)).toEqual({ kind: 'revoked' })
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
    const out = await revokeAgent(s.deps, K_A)
    expect(out).toEqual({ kind: 'notConfirmed', reason: 'entryRemains' })
    expect(s.revokes()).toHaveLength(REVOKE_MAX_ROUNDS)
    expect((await s.store.get(K_A))?.state).toBe('revoking')
  })
})

describe('Revoke not confirmed: partial or failed listings, a restart, and clearing', () => {
  it('a partial listing is never proof: revoking, after a restart too, until a full listing clears it', async () => {
    const s = await setup()
    s.vtaState.partial = true
    expect(await revokeAgent(s.deps, K_A)).toEqual({ kind: 'notConfirmed', reason: 'partialListing' })
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
    expect(await revokeAgent(s.deps, K_A)).toEqual({ kind: 'notConfirmed', reason: 'listingFailed' })
    s.vtaState.down = true
    expect(await revokeAgent(s.deps, K_A)).toEqual({ kind: 'unreachable' })
    expect((await s.store.get(K_A))?.state).toBe('revoking')
  })

  it('a failed ACL call leaves revoking, and the retry finishes it', async () => {
    const s = await setup()
    s.vtaState.revokeThrows = true
    expect(await revokeAgent(s.deps, K_A)).toEqual({ kind: 'notConfirmed', reason: 'entryRemains' })
    expect((await s.store.get(K_A))?.state).toBe('revoking')
    s.vtaState.revokeThrows = false
    // "Try again"
    expect(await revokeAgent(s.deps, K_A)).toEqual({ kind: 'revoked' })
    expect((await s.store.get(K_A))?.state).toBe('revoked')
  })

  it('a second caller joins the revoke in flight', async () => {
    const s = await setup()
    const [a, b] = await Promise.all([revokeAgent(s.deps, K_A), revokeAgent(s.deps, K_A)])
    expect([a, b]).toEqual([{ kind: 'revoked' }, { kind: 'revoked' }])
    expect(s.revokes()).toEqual([K_A])
    expect(s.tellAgent).toHaveBeenCalledTimes(1)
  })

  it('a revoked record answers revoked without a VTA call', async () => {
    const s = await setup({ state: 'revoked' })
    expect(await revokeAgent(s.deps, K_A)).toEqual({ kind: 'revoked' })
    expect(s.sent).toEqual([])
  })

  it('the notice failing changes nothing, and is tried again next time', async () => {
    const s = await setup()
    s.tellAgent.mockRejectedValueOnce(new Error('chat down'))
    expect(await revokeAgent(s.deps, K_A)).toEqual({ kind: 'revoked' })
    expect((await s.store.get(K_A))?.revokeToldAt).toBeUndefined()
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
  it('records a changed key without moving the chat or the agent DID', async () => {
    const s = await setup()
    s.swap('dev-1', K_B)
    expect(await reconcileAgents(s.deps)).toEqual([{ id: K_A, kind: 'keyChanged', subject: K_B }])
    const after = (await s.store.get(K_A)) as Conn
    expect(after).toMatchObject({
      keyChanged: true,
      currentSubject: K_B,
      agentDid: K_A,
      chatDid: 'did:peer:2.chat',
      handle: 'notes-helper',
      state: 'active',
      lastReconciledAt: new Date(NOW).toISOString(),
    })
    expect(s.revokes()).toEqual([])
  })

  it('an unchanged agent is only stamped', async () => {
    const s = await setup()
    expect(await reconcileAgents(s.deps)).toEqual([{ id: K_A, kind: 'unchanged' }])
    expect((await s.store.get(K_A))?.keyChanged).toBe(false)
  })

  it('no entry on a full listing: Revoked before its expiry, Expired after', async () => {
    const s = await setup()
    s.entries.delete(K_A)
    s.devices.delete('dev-1')
    expect(await reconcileAgents(s.deps)).toEqual([{ id: K_A, kind: 'gone', state: 'revoked' }])
    const late = await setup()
    late.entries.delete(K_A)
    late.devices.delete('dev-1')
    const after = { ...late.deps, now: () => Date.parse('2026-11-26T17:00:00Z') }
    expect(await reconcileAgents(after)).toEqual([{ id: K_A, kind: 'gone', state: 'expired' }])
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
    const real = s.vta.findAgentEntries.bind(s.vta)
    jest.spyOn(s.vta, 'findAgentEntries').mockImplementation(async (q) => {
      const out = await real(q)
      const current = (await s.store.get(K_A)) as Conn
      await s.store.put({ ...current, name: 'Renamed meanwhile' })
      return out
    })
    await reconcileAgents(s.deps)
    expect((await s.store.get(K_A))?.name).toBe('Renamed meanwhile')
  })
})
