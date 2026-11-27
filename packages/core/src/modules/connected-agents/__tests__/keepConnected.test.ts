/**
 * "Keep it connected" (backlog fb-4, plan §7.28): built to the source reading of VTI `97fda9813` and shipped unoffered.
 * The act reads the entry, sends `acl/update/0.3` with exactly `{ subject, expiresAt: null }`, reads it back, makes the
 * record persistent and re-issues its grant for 7 days. `keepConnectedOffered` stays false until the lab measures it.
 */
import type { AccessEntry, AgentAccessPort } from '../carriage'
import { ACL_UPDATE_03, KEEP_CONNECTED_MEASURED, keepConnected, keepConnectedOffered } from '../keepConnected'
import type { KeepConnectedPorts } from '../keepConnected'
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

function setup(
  record: AgentConnection,
  options: { port?: Pick<AgentAccessPort, 'findAgentEntries'>; taskFails?: boolean; signFails?: boolean } = {}
) {
  const tasks: { type: string; payload: Record<string, unknown> }[] = []
  const sign = signer(options.signFails)
  const db = store([record])
  const ports: KeepConnectedPorts = {
    clock: () => NOW,
    access: options.port ?? clearsExpiry(record),
    async task(type, payload) {
      tasks.push({ type, payload })
      if (options.taskFails) throw new Error('vta unreachable')
      return {}
    },
    vdcSign: sign.vdcSign,
    connections: db.connections,
  }
  return { ports, tasks, sign, db }
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

  it('a read-back still showing an expiry is notApplied, and the record is untouched', async () => {
    const record = temporary()
    const port = access([listedWith(record.agentDid, record.expiresAt)])
    const { ports, db, sign } = setup(record, { port })
    expect(await keepConnected(ports, record.id)).toEqual({ ok: false, code: 'notApplied' })
    expect(db.byId.get(record.id)).toBe(record)
    expect(db.updated).toEqual([])
    expect(sign.sent).toEqual([])
  })

  it('a read-back that fails is notApplied too, and the record is untouched', async () => {
    const record = temporary()
    const port = access([listedWith(record.agentDid, record.expiresAt), new Error('vta unreachable')])
    const { ports, db } = setup(record, { port })
    expect(await keepConnected(ports, record.id)).toEqual({ ok: false, code: 'notApplied' })
    expect(db.updated).toEqual([])
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

  it('an update that throws is unreachable, and the record is untouched', async () => {
    const record = temporary()
    const { ports, db } = setup(record, { taskFails: true })
    expect(await keepConnected(ports, record.id)).toEqual({ ok: false, code: 'unreachable' })
    expect(db.updated).toEqual([])
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
