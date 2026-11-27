/**
 * "Keep it connected" (backlog fb-4, plan §7.28): built to the source reading of VTI `97fda9813` and shipped unoffered.
 * The act reads the entry, sends `acl/update/0.3` with exactly `{ subject, expiresAt: null }`, reads it back, makes the
 * record persistent and re-issues its grant for 7 days. `keepConnectedOffered` stays false until the lab measures it.
 * An intent is written before the send and settled after it; `settleKeepConnected` finishes one left behind.
 */
import type { Agent } from '@credo-ts/core'

import { memoryGenericRecords } from '../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'
import type { AccessEntry, AgentAccessPort } from '../carriage'
import {
  ACL_UPDATE_03,
  KEEP_CONNECTED_MEASURED,
  KeepConnectedIntentStore,
  keepConnected,
  keepConnectedOffered,
  settleKeepConnected,
} from '../keepConnected'
import type { KeepConnectedIntent, KeepConnectedPorts } from '../keepConnected'
import { statusOf } from '../status'
import { agentRecord, FIXTURE_NOW } from '../testing/fixtures'
import type { AgentConnection } from '../types'
import { KEYS_SIGN_DOCUMENT_TASK, VDC_MAX_VALIDITY_MS, type VdcSignPort } from '../vdc'

const HOUR = 60 * 60 * 1000
const NOW = FIXTURE_NOW
const PERSONA = 'did:webvh:persona.example:ada'
const DEVICE = 'device-notes-helper'

/** An active temporary agent with 2.5 hours left (the fixture). */
const temporary = (overrides: Partial<AgentConnection> = {}) => agentRecord(overrides)

type Found = Awaited<ReturnType<AgentAccessPort['findAgentEntries']>>

const entryOf = (subject: string, expiresAt?: string): AccessEntry => ({
  subject,
  role: 'application',
  act: { stated: 'contexts', contexts: ['keyring-memory-educat1on'] },
  ...(expiresAt !== undefined ? { expiresAt } : {}),
})

/** A port answering each listing in turn from `answers` (the last repeats); an Error is thrown. */
function access(answers: (Found | Error)[]) {
  let call = 0
  const port: Pick<AgentAccessPort, 'findAgentEntries'> = {
    async findAgentEntries() {
      const answer = answers[Math.min(call++, answers.length - 1)]
      if (answer instanceof Error) throw answer
      return answer
    },
  }
  return port
}

const listedWith = (subject: string, expiresAt?: string): Found => ({
  complete: true,
  matches: [{ entry: entryOf(subject, expiresAt), deviceId: DEVICE }],
})

/** The usual VTA: listed with an expiry before the update, without one after. */
const clearsExpiry = (record: AgentConnection) =>
  access([listedWith(record.agentDid, record.expiresAt), listedWith(record.agentDid)])

function signer(fail = false) {
  const sent: { type: string; payload: Record<string, unknown> }[] = []
  const vdcSign: VdcSignPort = {
    async task(type, payload) {
      sent.push({ type, payload })
      if (fail) throw new Error('keys:notFound')
      const document = payload.document as Record<string, unknown>
      return { keyId: payload.keyId, signerDid: document.issuer, document: { ...document, proof: { sig: 'z' } } }
    },
  }
  return { vdcSign, sent }
}

function store(records: AgentConnection[]) {
  const byId = new Map(records.map((r) => [r.id, r]))
  const updated: string[] = []
  const connections: KeepConnectedPorts['connections'] = {
    async get(id) {
      return byId.get(id)
    },
    async update(id, change) {
      updated.push(id)
      const current = byId.get(id)
      if (!current) return undefined
      const next = change(current)
      byId.set(id, next)
      return next
    },
  }
  return { connections, byId, updated }
}

/** An in-memory intent store, logging each call to `events`; `fails` names the calls that throw. */
function intentStore(events: string[], fails: { put?: boolean; remove?: boolean } = {}) {
  const byId = new Map<string, KeepConnectedIntent>()
  const intents: Pick<KeepConnectedIntentStore, 'list' | 'put' | 'remove'> = {
    async list() {
      return [...byId.values()]
    },
    async put(intent) {
      events.push(`intent.put ${intent.id}`)
      if (fails.put) throw new Error('store not writable')
      byId.set(intent.id, intent)
    },
    async remove(id) {
      events.push(`intent.remove ${id}`)
      if (fails.remove) throw new Error('store not writable')
      byId.delete(id)
    },
  }
  return { intents, byId }
}

function setup(
  record: AgentConnection,
  options: {
    port?: Pick<AgentAccessPort, 'findAgentEntries'>
    taskFails?: boolean
    signFails?: boolean
    intentFails?: { put?: boolean; remove?: boolean }
  } = {}
) {
  const events: string[] = []
  const tasks: { type: string; payload: Record<string, unknown> }[] = []
  const sign = signer(options.signFails)
  const db = store([record])
  const saved = intentStore(events, options.intentFails)
  const ports: KeepConnectedPorts = {
    clock: () => NOW,
    access: options.port ?? clearsExpiry(record),
    async task(type, payload) {
      events.push(`task ${type}`)
      tasks.push({ type, payload })
      if (options.taskFails) throw new Error('vta unreachable')
      return {}
    },
    vdcSign: sign.vdcSign,
    connections: db.connections,
    intents: saved.intents,
  }
  return { ports, tasks, sign, db, events, saved }
}

const grantOf = (record: AgentConnection | undefined) =>
  record?.vdcGrant as { validUntil: string; issuer: string; credentialSubject: { id: string } } | undefined

describe('keepConnected', () => {
  it('sends acl/update/0.3 with exactly the subject and an explicit null expiry', async () => {
    const record = temporary()
    const { ports, tasks } = setup(record)
    expect(await keepConnected(ports, record.id)).toEqual({ ok: true })
    expect(ACL_UPDATE_03).toBe('https://trusttasks.org/spec/acl/update/0.3')
    expect(tasks).toEqual([{ type: ACL_UPDATE_03, payload: { subject: record.agentDid, expiresAt: null } }])
    expect(Object.keys(tasks[0].payload)).toEqual(['subject', 'expiresAt'])
  })

  it("names the entry's own subject, for an agent whose key rotated", async () => {
    const record = temporary()
    const rotated = 'did:key:z6MkRotatedKey'
    const port = access([listedWith(rotated, record.expiresAt), listedWith(rotated)])
    const { ports, tasks } = setup(record, { port })
    expect(await keepConnected(ports, record.id)).toEqual({ ok: true })
    expect(tasks[0].payload).toEqual({ subject: rotated, expiresAt: null })
  })

  it('after success the record is persistent, elected now, has no expiresAt, and a 7-day grant', async () => {
    const record = temporary({ vdcGrant: { validUntil: new Date(NOW + HOUR).toISOString() } })
    const { ports, db, sign } = setup(record)
    expect(await keepConnected(ports, record.id)).toEqual({ ok: true })
    const after = db.byId.get(record.id) as AgentConnection
    expect(after.grantType).toBe('persistent')
    expect(after.persistentElectedAt).toBe(new Date(NOW).toISOString())
    expect('expiresAt' in after).toBe(false)
    expect(after.state).toBe('active')
    const grant = grantOf(after)
    expect(Date.parse(grant?.validUntil as string)).toBe(NOW + VDC_MAX_VALIDITY_MS)
    expect(grant?.issuer).toBe(PERSONA)
    expect(grant?.credentialSubject.id).toBe(record.agentDid)
    expect(sign.sent.map((s) => s.type)).toEqual([KEYS_SIGN_DOCUMENT_TASK])
    expect(sign.sent[0].payload.keyId).toBe(`${PERSONA}#key-0`)
  })

  it('a read-back still showing an expiry is notApplied, the record is untouched and the intent removed', async () => {
    const record = temporary()
    const port = access([listedWith(record.agentDid, record.expiresAt)])
    const { ports, db, sign, saved } = setup(record, { port })
    expect(await keepConnected(ports, record.id)).toEqual({ ok: false, code: 'notApplied' })
    expect(db.byId.get(record.id)).toBe(record)
    expect(db.updated).toEqual([])
    expect(sign.sent).toEqual([])
    expect(saved.byId.size).toBe(0)
  })

  it('a read-back that fails is notApplied too, the record is untouched, and the intent stays', async () => {
    const record = temporary()
    const port = access([listedWith(record.agentDid, record.expiresAt), new Error('vta unreachable')])
    const { ports, db, saved } = setup(record, { port })
    expect(await keepConnected(ports, record.id)).toEqual({ ok: false, code: 'notApplied' })
    expect(db.updated).toEqual([])
    expect(saved.byId.has(record.id)).toBe(true)
  })

  it('a VDC failure is vdc, and the record stays persistent', async () => {
    const record = temporary()
    const { ports, db } = setup(record, { signFails: true })
    expect(await keepConnected(ports, record.id)).toEqual({ ok: false, code: 'vdc' })
    const after = db.byId.get(record.id) as AgentConnection
    expect(after.grantType).toBe('persistent')
    expect(after.expiresAt).toBeUndefined()
  })

  it('an entry not listed is notListed, and an unknown read is unreachable; neither sends the update', async () => {
    const record = temporary()
    const gone = setup(record, { port: access([{ complete: true, matches: [] }]) })
    expect(await keepConnected(gone.ports, record.id)).toEqual({ ok: false, code: 'notListed' })
    expect(gone.tasks).toEqual([])
    const down = setup(record, { port: access([new Error('vta unreachable')]) })
    expect(await keepConnected(down.ports, record.id)).toEqual({ ok: false, code: 'unreachable' })
    expect(down.tasks).toEqual([])
  })

  it('an update that throws is unreachable, the record is untouched, and the intent stays', async () => {
    const record = temporary()
    const { ports, db, saved } = setup(record, { taskFails: true })
    expect(await keepConnected(ports, record.id)).toEqual({ ok: false, code: 'unreachable' })
    expect(db.updated).toEqual([])
    // the expiry may have been cleared before the answer was lost
    expect(saved.byId.has(record.id)).toBe(true)
  })

  it('writes the intent before the update is sent, and removes it once the record is persistent', async () => {
    // control: writing the intent after the send (the order the review found) fails this test
    const record = temporary()
    const { ports, events, saved, db } = setup(record)
    const update = ports.connections.update
    ports.connections.update = async (id, change) => {
      events.push(`record.update ${id}`)
      return update(id, change)
    }
    expect(await keepConnected(ports, record.id)).toEqual({ ok: true })
    expect(events.slice(0, 4)).toEqual([
      `intent.put ${record.id}`,
      `task ${ACL_UPDATE_03}`,
      `record.update ${record.id}`,
      `intent.remove ${record.id}`,
    ])
    expect(saved.byId.size).toBe(0)
    expect(db.byId.get(record.id)?.grantType).toBe('persistent')
  })

  it('the intent names the record, the subject sent and the time, which becomes persistentElectedAt', async () => {
    const record = temporary()
    const rotated = 'did:key:z6MkRotatedKey'
    const port = access([listedWith(rotated, record.expiresAt), listedWith(rotated)])
    const { ports, saved } = setup(record, { port, taskFails: true })
    await keepConnected(ports, record.id)
    expect(saved.byId.get(record.id)).toEqual({
      id: record.id,
      subject: rotated,
      startedAt: new Date(NOW).toISOString(),
    })
  })

  it('an intent that cannot be written is notSaved, and nothing is sent', async () => {
    const record = temporary()
    const { ports, tasks, db } = setup(record, { intentFails: { put: true } })
    expect(await keepConnected(ports, record.id)).toEqual({ ok: false, code: 'notSaved' })
    expect(tasks).toEqual([])
    expect(db.updated).toEqual([])
  })

  it('a cleared expiry whose record write rejects is notRecorded, and the settle makes the record persistent', async () => {
    const record = temporary()
    const run = setup(record)
    const update = run.ports.connections.update
    run.ports.connections.update = async () => {
      throw new Error('store not writable')
    }
    expect(await keepConnected(run.ports, record.id)).toEqual({ ok: false, code: 'notRecorded' })
    expect(run.tasks).toHaveLength(1)
    expect(run.saved.byId.has(record.id)).toBe(true)

    // Later, past the record's old expiry: without the intent this record would read Expired for good.
    run.ports.connections.update = update
    const later = Date.parse(record.expiresAt as string) + HOUR
    expect(statusOf(run.db.byId.get(record.id) as AgentConnection, later)).toBe('expired')
    const settled = await settleKeepConnected({
      access: access([listedWith(record.agentDid)]),
      connections: run.db.connections,
      intents: run.saved.intents,
    })
    expect(settled).toEqual({ completed: [record.id], dropped: [], kept: [] })
    const after = run.db.byId.get(record.id) as AgentConnection
    expect(after.grantType).toBe('persistent')
    expect(after.persistentElectedAt).toBe(new Date(NOW).toISOString())
    expect('expiresAt' in after).toBe(false)
    expect(statusOf(after, later)).not.toBe('expired')
    expect(run.saved.byId.size).toBe(0)
  })

  it('an intent that cannot be removed after success still answers ok', async () => {
    const record = temporary()
    const { ports, db } = setup(record, { intentFails: { remove: true } })
    expect(await keepConnected(ports, record.id)).toEqual({ ok: true })
    expect(db.byId.get(record.id)?.grantType).toBe('persistent')
  })

  it("checks the record's own conditions: no record, persistent, expired or not active is refused", async () => {
    const { ports } = setup(temporary())
    expect(await keepConnected(ports, 'did:key:z6MkNobody')).toEqual({ ok: false, code: 'noRecord' })
    for (const record of [
      temporary({ grantType: 'persistent', expiresAt: undefined }),
      temporary({ expiresAt: new Date(NOW - HOUR).toISOString() }),
      temporary({ state: 'revoking' }),
    ]) {
      const run = setup(record)
      expect(await keepConnected(run.ports, record.id)).toEqual({ ok: false, code: 'notOffered' })
      expect(run.tasks).toEqual([])
    }
  })

  it('a record that left active while the entry was changed is not made persistent', async () => {
    const record = temporary()
    const run = setup(record)
    const update = run.ports.connections.update
    let first = true
    run.ports.connections.update = async (id, change) => {
      if (first) {
        first = false
        run.db.byId.set(id, { ...record, state: 'revoking' })
      }
      return update(id, change)
    }
    expect(await keepConnected(run.ports, record.id)).toEqual({ ok: false, code: 'notOffered' })
    expect(run.db.byId.get(record.id)?.grantType).toBe('temporary')
    expect(run.sign.sent).toEqual([])
    expect(run.saved.byId.size).toBe(0)
  })
})

describe('settleKeepConnected', () => {
  const STARTED = new Date(NOW - HOUR).toISOString()
  const intentFor = (record: AgentConnection): KeepConnectedIntent => ({
    id: record.id,
    subject: record.agentDid,
    startedAt: STARTED,
  })

  function settleSetup(
    records: AgentConnection[],
    port: Pick<AgentAccessPort, 'findAgentEntries'>,
    fails: { remove?: boolean } = {}
  ) {
    const db = store(records)
    const saved = intentStore([], fails)
    for (const record of records) saved.byId.set(record.id, intentFor(record))
    const ports = { access: port, connections: db.connections, intents: saved.intents }
    return { ports, db, saved }
  }

  it('an entry listed with no expiry makes the record persistent, elected when the intent was written', async () => {
    const record = temporary()
    const { ports, db, saved } = settleSetup([record], access([listedWith(record.agentDid)]))
    expect(await settleKeepConnected(ports)).toEqual({ completed: [record.id], dropped: [], kept: [] })
    const after = db.byId.get(record.id) as AgentConnection
    expect(after.grantType).toBe('persistent')
    expect(after.persistentElectedAt).toBe(STARTED)
    expect('expiresAt' in after).toBe(false)
    expect(saved.byId.size).toBe(0)
  })

  it('an entry still expiring, or proved not listed, drops the intent and leaves the record', async () => {
    for (const found of [listedWith(temporary().agentDid, temporary().expiresAt), { complete: true, matches: [] }]) {
      const record = temporary()
      const { ports, db, saved } = settleSetup([record], access([found]))
      expect(await settleKeepConnected(ports)).toEqual({ completed: [], dropped: [record.id], kept: [] })
      expect(db.byId.get(record.id)).toBe(record)
      expect(saved.byId.size).toBe(0)
    }
  })

  it('an entry that cannot be read, or a record write that throws, keeps the intent', async () => {
    const record = temporary()
    const unread = settleSetup([record], access([new Error('vta unreachable')]))
    expect(await settleKeepConnected(unread.ports)).toEqual({ completed: [], dropped: [], kept: [record.id] })
    expect(unread.saved.byId.has(record.id)).toBe(true)

    const unwritten = settleSetup([record], access([listedWith(record.agentDid)]))
    unwritten.ports.connections.update = async () => {
      throw new Error('store not writable')
    }
    expect(await settleKeepConnected(unwritten.ports)).toEqual({ completed: [], dropped: [], kept: [record.id] })
    expect(unwritten.saved.byId.has(record.id)).toBe(true)
  })

  it('a record that cannot be read keeps its intent, and the next intent is still settled', async () => {
    const broken = temporary({ id: 'did:key:z6MkBroken' })
    const record = temporary()
    const { ports, db, saved } = settleSetup([broken, record], access([listedWith(record.agentDid)]))
    const get = ports.connections.get
    ports.connections.get = async (id) => {
      if (id === broken.id) throw new Error('store not readable')
      return get(id)
    }
    expect(await settleKeepConnected(ports)).toEqual({ completed: [record.id], dropped: [], kept: [broken.id] })
    expect(db.byId.get(record.id)?.grantType).toBe('persistent')
    expect([...saved.byId.keys()]).toEqual([broken.id])
  })

  it('no record, a record not active, or one already persistent: the intent is dropped and nothing read', async () => {
    const revoking = temporary({ id: 'did:key:z6MkRevoking', state: 'revoking' })
    const persistent = temporary({ id: 'did:key:z6MkPersistent', grantType: 'persistent', expiresAt: undefined })
    let reads = 0
    const port: Pick<AgentAccessPort, 'findAgentEntries'> = {
      async findAgentEntries() {
        reads += 1
        return listedWith(revoking.agentDid)
      },
    }
    const { ports, db, saved } = settleSetup([revoking, persistent], port)
    saved.byId.set('did:key:z6MkGone', { id: 'did:key:z6MkGone', subject: 'did:key:z6MkGone', startedAt: STARTED })
    const result = await settleKeepConnected(ports)
    expect(result.dropped.sort()).toEqual([revoking.id, persistent.id, 'did:key:z6MkGone'].sort())
    expect(result.completed).toEqual([])
    expect(reads).toBe(0)
    expect(db.updated).toEqual([])
    expect(saved.byId.size).toBe(0)
  })
})

describe('KeepConnectedIntentStore', () => {
  it('keeps one intent per record under its own record type; remove takes it away', async () => {
    const genericRecords = memoryGenericRecords()
    const intents = new KeepConnectedIntentStore({ genericRecords } as unknown as Agent)
    const first: KeepConnectedIntent = {
      id: 'did:key:z6MkA',
      subject: 'did:key:z6MkA',
      startedAt: '2026-11-27T12:00:00.000Z',
    }
    await intents.put(first)
    await intents.put({ ...first, startedAt: '2026-11-27T13:00:00.000Z' })
    expect(genericRecords.records).toHaveLength(1)
    expect(genericRecords.records[0].tags).toEqual({
      recordType: 'keyring/keep-connected',
      kind: 'intent',
      key: first.id,
    })
    expect(await intents.list()).toEqual([{ ...first, startedAt: '2026-11-27T13:00:00.000Z' }])
    await intents.remove(first.id)
    expect(await intents.list()).toEqual([])
    await expect(intents.remove(first.id)).resolves.toBeUndefined()
  })
})

describe('keepConnectedOffered', () => {
  it('is false while the act is not measured', () => {
    expect(KEEP_CONNECTED_MEASURED).toBe(false)
    expect(keepConnectedOffered(temporary(), NOW)).toBe(false)
  })

  it('is false for a persistent, an expired or a not active record', () => {
    expect(keepConnectedOffered(temporary({ grantType: 'persistent', expiresAt: undefined }), NOW)).toBe(false)
    expect(keepConnectedOffered(temporary({ expiresAt: new Date(NOW - HOUR).toISOString() }), NOW)).toBe(false)
    expect(keepConnectedOffered(temporary({ state: 'expired' }), NOW)).toBe(false)
    expect(keepConnectedOffered(temporary({ state: 'notFinished' }), NOW)).toBe(false)
  })

  it('control: with every condition met and the constant false, still not offered', () => {
    // control: an active temporary agent 2.5 hours from expiry meets every record condition; only the constant holds it
    const record = temporary()
    expect(record.state).toBe('active')
    expect(record.grantType).toBe('temporary')
    expect(Date.parse(record.expiresAt as string)).toBeGreaterThan(NOW)
    expect(keepConnectedOffered(record, NOW)).toBe(false)
  })
})
