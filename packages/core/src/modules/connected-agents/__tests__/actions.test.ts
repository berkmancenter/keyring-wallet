import type { Agent } from '@credo-ts/core'

import { memoryGenericRecords } from '../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'
import { AgentActions, allowedBesideMemories, heldContexts } from '../actions'
import type { AccessEntry, AgentAccessPort } from '../carriage'
import { NOT_FINISHED_AFTER_MS, TEMPORARY_GRANT_MS } from '../pairing'
import { AgentConnectionStore } from '../store'
import { agentRecord, FIXTURE_NOW } from '../testing/fixtures'
import type { AgentConnection } from '../types'
import { KEYS_SIGN_DOCUMENT_TASK, type VdcSignPort } from '../vdc'

const EDU = 'keyring-memory-educat1on'
const HEALTH = 'keyring-memory-hea1thcar'
const OTHER = 'keyring-memory-0therpers'

/** The owner's VTA: one access list, the writes it was sent, and switches for the ways it can fail. */
class FakeVta implements AgentAccessPort {
  public entries = new Map<string, { entry: AccessEntry; deviceId?: string }>()
  public writes: Parameters<AgentAccessPort['narrowOrWidenCapabilities']>[0][] = []
  public mode: 'ok' | 'ignore' | 'refuse' | 'partial' = 'ok'
  public grantApplication = async () => undefined
  public put(subject: string, contexts: string[], extra: Partial<AccessEntry> = {}, deviceId?: string) {
    this.entries.set(subject, {
      entry: { subject, role: 'application', act: { stated: 'contexts', contexts }, ...extra },
      deviceId,
    })
  }
  public async findAgentEntries(query: { deviceId?: string; subject?: string }) {
    if (this.mode === 'refuse') throw new Error('unreachable')
    const matches = [...this.entries.values()].filter(
      (e) => (query.deviceId && e.deviceId === query.deviceId) || e.entry.subject === query.subject
    )
    return { complete: this.mode !== 'partial', matches: JSON.parse(JSON.stringify(matches)) }
  }
  public async narrowOrWidenCapabilities(change: Parameters<AgentAccessPort['narrowOrWidenCapabilities']>[0]) {
    if (this.mode === 'refuse') throw new Error('refused')
    this.writes.push(change)
    if (this.mode === 'ignore') return undefined
    const held = this.entries.get(change.subject)
    if (!held) throw new Error('notFound')
    if (change.act) held.entry.act = { stated: 'contexts', contexts: [...change.act.to] }
    if (change.expiresAt) held.entry.expiresAt = change.expiresAt
    return undefined
  }
}

function setup(record: AgentConnection = agentRecord(), now = FIXTURE_NOW) {
  const genericRecords = memoryGenericRecords()
  const connections = new AgentConnectionStore({ genericRecords } as unknown as Agent)
  const vta = new FakeVta()
  const signed: Record<string, unknown>[] = []
  const vdcSign: VdcSignPort = {
    async task(type, payload) {
      expect(type).toBe(KEYS_SIGN_DOCUMENT_TASK)
      if (vta.mode === 'refuse') throw new Error('unreachable')
      signed.push(payload)
      const document = payload.document as Record<string, unknown>
      const proof = { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', verificationMethod: payload.keyId }
      return { keyId: payload.keyId, signerDid: document.issuer, document: { ...document, proof }, proof }
    },
  }
  const clock = { now }
  const revoked: string[] = []
  let revokeAnswer: { gone: boolean } = { gone: true }
  const ports = {
    clock: () => clock.now,
    access: vta,
    connections,
    vdcSign,
    revokeEntry: async (r: AgentConnection) => {
      revoked.push(r.agentDid)
      if (revokeAnswer.gone) vta.entries.delete(r.agentDid)
      return revokeAnswer
    },
  }
  const actions = new AgentActions(ports)
  return {
    actions,
    vta,
    connections,
    signed,
    clock,
    revoked,
    ports,
    answerRevoke: (a: { gone: boolean }) => (revokeAnswer = a),
    ready: async () => {
      await connections.put(record)
      vta.put(record.agentDid, [...record.contexts], { expiresAt: record.expiresAt }, record.deviceId)
    },
  }
}

describe('Change memories (§3.15 item 4)', () => {
  it('widen: the entry is written from what it holds, read back, and the record follows', async () => {
    const t = setup()
    await t.ready()
    expect(await t.actions.widen(agentRecord().id, OTHER)).toEqual({ ok: true })
    expect(t.vta.writes).toEqual([
      { subject: agentRecord().agentDid, act: { from: [EDU, HEALTH], to: [EDU, HEALTH, OTHER] } },
    ])
    expect(await t.connections.get(agentRecord().id)).toMatchObject({
      memoryContexts: [EDU, HEALTH, OTHER],
      contexts: [EDU, HEALTH, OTHER],
    })
  })

  it('narrow: one memory leaves the entry and the record', async () => {
    const t = setup()
    await t.ready()
    expect(await t.actions.narrow(agentRecord().id, HEALTH)).toEqual({ ok: true })
    expect(t.vta.writes).toEqual([{ subject: agentRecord().agentDid, act: { from: [EDU, HEALTH], to: [EDU] } }])
    expect(await t.connections.get(agentRecord().id)).toMatchObject({ memoryContexts: [EDU], contexts: [EDU] })
  })

  it('computes from the entry as the VTA holds it now, not from the record', async () => {
    const t = setup()
    await t.ready()
    t.vta.put(agentRecord().agentDid, [EDU], {}, agentRecord().deviceId) // another administrator narrowed it
    expect(await t.actions.widen(agentRecord().id, OTHER)).toEqual({ ok: true })
    expect(t.vta.writes[0].act).toEqual({ from: [EDU], to: [EDU, OTHER] })
  })

  it('a write the entry read back does not show is notApplied, and the record is unchanged', async () => {
    const t = setup()
    await t.ready()
    t.vta.mode = 'ignore'
    expect(await t.actions.widen(agentRecord().id, OTHER)).toEqual({ ok: false, code: 'notApplied' })
    expect((await t.connections.get(agentRecord().id))?.memoryContexts).toEqual([EDU, HEALTH])
    // control: the same widening, applied, is ok
    t.vta.mode = 'ok'
    expect(await t.actions.widen(agentRecord().id, OTHER)).toEqual({ ok: true })
  })

  it('the last memory cannot be narrowed away: an entry names at least one context', async () => {
    const t = setup(agentRecord({ contexts: [EDU], memoryContexts: [EDU] }))
    await t.ready()
    expect(await t.actions.narrow(agentRecord().id, EDU)).toEqual({ ok: false, code: 'lastMemory' })
    expect(t.vta.writes).toEqual([])
  })

  it('unreachable, not listed, no record, and an ended agent are each said, and nothing is written', async () => {
    const t = setup()
    await t.ready()
    t.vta.mode = 'refuse'
    expect(await t.actions.widen(agentRecord().id, OTHER)).toEqual({ ok: false, code: 'unreachable' })
    t.vta.mode = 'ok'
    t.vta.entries.clear()
    expect(await t.actions.widen(agentRecord().id, OTHER)).toEqual({ ok: false, code: 'notListed' })
    expect(await t.actions.widen('did:key:z6MkNoSuchAgent', OTHER)).toEqual({ ok: false, code: 'noRecord' })
    t.clock.now = FIXTURE_NOW + 3 * 60 * 60 * 1000 // past the fixture's expiry
    expect(await t.actions.widen(agentRecord().id, OTHER)).toEqual({ ok: false, code: 'notOffered' })
    expect(t.vta.writes).toEqual([])
  })

  it('finds the entry by the current key after a rotation (§3.9): the record keeps its first key as id', async () => {
    const rotated = agentRecord({ agentDid: 'did:key:z6MkRotatedKey', keyChanged: true })
    const t = setup(rotated)
    await t.ready()
    expect(await t.actions.narrow(rotated.id, HEALTH)).toEqual({ ok: true })
    expect(t.vta.writes[0].subject).toBe('did:key:z6MkRotatedKey')
  })
})

describe('Restore (§3.15 item 5)', () => {
  it('narrows a drifted entry back to the bound set, and leaves a lost memory to a widening', async () => {
    const t = setup()
    await t.ready()
    t.vta.put(agentRecord().agentDid, [EDU, OTHER], {}, agentRecord().deviceId) // HEALTH lost, OTHER added
    expect(await t.actions.restore(agentRecord().id)).toEqual({ ok: true })
    expect(t.vta.writes).toEqual([{ subject: agentRecord().agentDid, act: { from: [EDU, OTHER], to: [EDU] } }])
  })

  it("keeps the agent's own context and its rooms' persona contexts, which are not drift", async () => {
    const memoryless = agentRecord({ contexts: ['keyring-agent-own'], memoryContexts: [] })
    const t = setup(memoryless)
    await t.ready()
    t.vta.put(memoryless.agentDid, ['keyring-agent-own', 'room-persona', OTHER], {}, memoryless.deviceId)
    const actions = new AgentActions({ ...t.ports, roomContextsOf: () => ['room-persona'] })
    expect(await actions.restore(memoryless.id)).toEqual({ ok: true })
    expect(t.vta.writes[0].act).toEqual({
      from: ['keyring-agent-own', 'room-persona', OTHER],
      to: ['keyring-agent-own', 'room-persona'],
    })
    expect(allowedBesideMemories(memoryless, ['room-persona'])).toEqual(['keyring-agent-own', 'room-persona'])
  })

  it('no drift writes nothing', async () => {
    const t = setup()
    await t.ready()
    expect(await t.actions.restore(agentRecord().id)).toEqual({ ok: true })
    expect(t.vta.writes).toEqual([])
  })
})

describe('Try again on a pending memory (§7.5)', () => {
  it('adds the pending memory still chosen, and never one the owner removed since', async () => {
    const record = agentRecord({ contexts: [EDU, HEALTH], memoryContexts: [EDU], pendingContexts: [HEALTH, OTHER] })
    const t = setup(record)
    await t.connections.put(record)
    t.vta.put(record.agentDid, [EDU], {}, record.deviceId)
    expect(await t.actions.retryPending(record.id)).toEqual({ ok: true })
    // HEALTH was removed from the choice (not in memoryContexts) and OTHER too: neither is added
    expect(t.vta.writes).toEqual([])
    expect((await t.connections.get(record.id))?.pendingContexts).toEqual([])
  })

  it('a pending memory still chosen is added', async () => {
    const record = agentRecord({ memoryContexts: [EDU, HEALTH], pendingContexts: [HEALTH] })
    const t = setup(record)
    await t.connections.put(record)
    t.vta.put(record.agentDid, [EDU], {}, record.deviceId)
    expect(await t.actions.retryPending(record.id)).toEqual({ ok: true })
    expect(t.vta.writes[0].act).toEqual({ from: [EDU], to: [EDU, HEALTH] })
    expect((await t.connections.get(record.id))?.pendingContexts).toEqual([])
  })
})

describe('Extend (§7.7)', () => {
  it('sets the entry 4 hours ahead, reads it back, then issues and stores a new VDC ending then', async () => {
    const t = setup()
    await t.ready()
    expect(await t.actions.extend(agentRecord().id)).toEqual({ ok: true })
    const at = new Date(FIXTURE_NOW + TEMPORARY_GRANT_MS).toISOString()
    expect(t.vta.writes).toEqual([{ subject: agentRecord().agentDid, expiresAt: at }])
    const record = await t.connections.get(agentRecord().id)
    expect(record?.expiresAt).toBe(at)
    // the credential writes its times without milliseconds: the same instant
    expect(Date.parse((record?.vdcGrant as { validUntil: string }).validUntil)).toBe(Date.parse(at))
    expect(t.signed).toHaveLength(1)
  })

  it('a persistent agent and an expired one are not offered Extend', async () => {
    const persistent = setup(agentRecord({ grantType: 'persistent', expiresAt: undefined }))
    await persistent.ready()
    expect(await persistent.actions.extend(agentRecord().id)).toEqual({ ok: false, code: 'notOffered' })
    const expired = setup(agentRecord(), FIXTURE_NOW + 3 * 60 * 60 * 1000)
    await expired.ready()
    expect(await expired.actions.extend(agentRecord().id)).toEqual({ ok: false, code: 'notOffered' })
    expect([...persistent.vta.writes, ...expired.vta.writes]).toEqual([])
  })

  it('an extension the VTA did not apply is notApplied, and the record keeps its old expiry', async () => {
    const t = setup()
    await t.ready()
    t.vta.mode = 'ignore'
    expect(await t.actions.extend(agentRecord().id)).toEqual({ ok: false, code: 'notApplied' })
    expect((await t.connections.get(agentRecord().id))?.expiresAt).toBe(agentRecord().expiresAt)
    expect(t.signed).toEqual([])
  })

  it('the entry extended but the VDC not issued: the record has the new expiry and its old grant, and says vdc', async () => {
    const t = setup(agentRecord({ vdcGrant: { old: true } }))
    await t.ready()
    t.ports.vdcSign.task = async () => {
      throw new Error('unreachable')
    }
    expect(await t.actions.extend(agentRecord().id)).toEqual({ ok: false, code: 'vdc' })
    const record = await t.connections.get(agentRecord().id)
    expect(record?.expiresAt).toBe(new Date(FIXTURE_NOW + TEMPORARY_GRANT_MS).toISOString())
    expect(record?.vdcGrant).toEqual({ old: true })
  })
})

describe('Remove (§3.10, §7.7)', () => {
  const ENDED = FIXTURE_NOW + 3 * 60 * 60 * 1000

  it('an expired agent still listed: the entry is revoked through step 7.10, then the record is dropped', async () => {
    const t = setup(agentRecord(), ENDED)
    await t.ready()
    expect(await t.actions.remove(agentRecord().id)).toEqual({ ok: true })
    expect(t.revoked).toEqual([agentRecord().agentDid])
    expect(await t.connections.get(agentRecord().id)).toBeUndefined()
  })

  it('no longer listed (the VTA swept it): the record is dropped, and nothing is revoked', async () => {
    const t = setup(agentRecord(), ENDED)
    await t.connections.put(agentRecord())
    expect(await t.actions.remove(agentRecord().id)).toEqual({ ok: true })
    expect(t.revoked).toEqual([])
    expect(await t.connections.get(agentRecord().id)).toBeUndefined()
  })

  it('until step 7.10 is here, a listed entry is not removed: revokeUnavailable, and the record stays', async () => {
    const t = setup(agentRecord(), ENDED)
    await t.ready()
    const { revokeEntry: _none, ...withoutRevoke } = t.ports
    expect(await new AgentActions(withoutRevoke).remove(agentRecord().id)).toEqual({
      ok: false,
      code: 'revokeUnavailable',
    })
    expect(await t.connections.get(agentRecord().id)).toBeDefined()
  })

  it('a revoke not confirmed, or a partial listing, keeps the record', async () => {
    const t = setup(agentRecord(), ENDED)
    await t.ready()
    t.answerRevoke({ gone: false })
    expect(await t.actions.remove(agentRecord().id)).toEqual({ ok: false, code: 'revokeNotConfirmed' })
    expect(await t.connections.get(agentRecord().id)).toBeDefined()
    // a partial listing that shows nothing is not "gone": it is treated as listed, so it goes through the revoke
    t.vta.entries.clear()
    t.vta.mode = 'partial'
    expect(await t.actions.remove(agentRecord().id)).toEqual({ ok: false, code: 'revokeNotConfirmed' })
    expect(await t.connections.get(agentRecord().id)).toBeDefined()
  })

  it('a connected agent is not removed here: that is Revoke', async () => {
    const t = setup()
    await t.ready()
    expect(await t.actions.remove(agentRecord().id)).toEqual({ ok: false, code: 'notOffered' })
    expect(t.revoked).toEqual([])
  })

  it('no deviceId and nothing listed by its key: it may have rotated, so the record is kept (goneUnproven)', async () => {
    const leftover = agentRecord({
      id: 'did:key:z6MkLeftover',
      agentDid: 'did:key:z6MkLeftover',
      deviceId: '',
      state: 'notFinished',
    })
    const t = setup(leftover)
    await t.connections.put(leftover)
    // the entry registered and rotated to another key: listed by key alone, it is not found
    t.vta.put('did:key:z6MkRotatedAway', ['keyring-agent-own'], {}, 'device-registered-later')
    expect(await t.actions.remove(leftover.id)).toEqual({ ok: false, code: 'goneUnproven' })
    expect(await t.connections.get(leftover.id)).toBeDefined()
    // control: with its deviceId known, the same empty listing by key, and nothing on the device, does prove it gone
    const known = agentRecord({ ...leftover, deviceId: 'device-never-registered' })
    await t.connections.put(known)
    expect(await t.actions.remove(known.id)).toEqual({ ok: true })
  })

  it('a leftover with no deviceId is found by its subject', async () => {
    const leftover = agentRecord({
      id: 'did:key:z6MkLeftover',
      agentDid: 'did:key:z6MkLeftover',
      deviceId: '',
      state: 'notFinished',
    })
    const t = setup(leftover)
    await t.ready()
    expect(await t.actions.remove(leftover.id)).toEqual({ ok: true })
    expect(t.revoked).toEqual(['did:key:z6MkLeftover'])
  })
})

describe('the sweep of unfinished pairings (§3.10)', () => {
  it('removes those at least 10 minutes old, keeps younger ones and every other status', async () => {
    const created = (msAgo: number) => new Date(FIXTURE_NOW - msAgo).toISOString()
    const old = agentRecord({
      id: 'did:key:z6MkOld',
      agentDid: 'did:key:z6MkOld',
      state: 'notFinished',
      createdAt: created(NOT_FINISHED_AFTER_MS),
    })
    const young = agentRecord({
      id: 'did:key:z6MkYoung',
      agentDid: 'did:key:z6MkYoung',
      state: 'notFinished',
      createdAt: created(NOT_FINISHED_AFTER_MS - 1),
    })
    const active = agentRecord({
      id: 'did:key:z6MkActive',
      agentDid: 'did:key:z6MkActive',
      createdAt: created(NOT_FINISHED_AFTER_MS * 6),
    })
    const t = setup()
    for (const r of [old, young, active]) await t.connections.put(r)
    expect(await t.actions.sweepNotFinished()).toEqual(['did:key:z6MkOld'])
    expect((await t.connections.list()).map((r) => r.id).sort()).toEqual(['did:key:z6MkActive', 'did:key:z6MkYoung'])
  })
})

describe('helpers', () => {
  it('heldContexts reads only a context list', () => {
    expect(heldContexts({ subject: 's', role: 'application', act: { stated: 'contexts', contexts: ['a'] } })).toEqual([
      'a',
    ])
    expect(heldContexts({ subject: 's', role: 'application', act: { stated: 'none' } })).toEqual([])
  })
})
