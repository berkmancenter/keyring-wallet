import type { Agent } from '@credo-ts/core'

import { memoryGenericRecords } from '../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'
import { VTA_TASK } from '../../trust-tasks/module/VtaClient'
import { AgentActions } from '../actions'
import { AgentConnectDriver } from '../driver'
import { ACL_UPDATE_03 } from '../keepConnected'
import { NOT_FINISHED_AFTER_MS } from '../pairing'
import type { RevokeVta } from '../revoke'
import { administratorSigner, connectedAgentsServices, revokeEntryPort, vtaPorts, type VtaSession } from '../services'
import { AgentConnectionStore } from '../store'
import { agentRecord, FIXTURE_NOW } from '../testing/fixtures'

jest.mock('react-native-keychain', () => ({ ACCESS_CONTROL: {}, ACCESSIBLE: {}, STORAGE_TYPE: {} }))

// The reconcile's steps that are plain functions, recorded in the order they run and failed on demand; each otherwise
// runs as it is.
const mockSteps: string[] = []
const mockFailing = new Set<string>()
function mockStep<A extends unknown[], R>(name: string, actual: (...args: A) => Promise<R>) {
  return jest.fn(async (...args: A) => {
    mockSteps.push(name)
    if (mockFailing.has(name)) throw new Error(`${name} failed`)
    return actual(...args)
  })
}
jest.mock('../revoke', () => {
  const actual = jest.requireActual('../revoke')
  return { ...actual, reconcileAgents: mockStep('reconcileAgents', actual.reconcileAgents) }
})
jest.mock('../entryRead', () => {
  const actual = jest.requireActual('../entryRead')
  return { ...actual, readAgentEntries: mockStep('readAgentEntries', actual.readAgentEntries) }
})
jest.mock('../vdcReissue', () => {
  const actual = jest.requireActual('../vdcReissue')
  return { ...actual, reissueDueGrants: mockStep('reissueDueGrants', actual.reissueDueGrants) }
})
jest.mock('../../trust-tasks/documentProof', () => ({
  signDocumentProof: jest.fn(async (_agent: unknown, doc: Record<string, unknown>, did: string, opts: unknown) => ({
    ...doc,
    proof: { by: did, opts },
  })),
  verifyDocumentProof: jest.fn(async () => true),
}))

const VTA = 'did:webvh:QmVta:vta.example.org'

type Answer = (...args: unknown[]) => unknown

function fakeSession(managerDid?: string, answers: Record<string, Answer> = {}) {
  const calls: { vtaDid: string; method: string; args: unknown[] }[] = []
  const client = new Proxy(
    {},
    {
      get:
        (_t, method: string) =>
        async (...args: unknown[]) => {
          calls.push({ vtaDid: '', method, args })
          if (answers[method]) return answers[method](...args)
          if (method === 'listContexts') return [{ id: 'keyring-memory-educat1on', name: 'Education' }, { id: 'vta' }]
          if (method === 'findAgentEntries') return { complete: true, matches: [] }
          if (method === 'listAcl') return []
          return {}
        },
    }
  )
  const session: VtaSession = {
    async withAgentSession(_agent, vtaDid, use) {
      const out = await use(client as never)
      calls[calls.length - 1].vtaDid = vtaDid
      return out
    },
    getState: () => ({ managerDid }),
  }
  return { session, calls }
}

const agent = () =>
  ({
    genericRecords: memoryGenericRecords(),
    kms: { randomBytes: ({ length }: { length: number }) => new Uint8Array(length).fill(7) },
  }) as unknown as Agent

describe('vtaPorts: every call on a signed-in session to the administered VTA', () => {
  it('routes the access, signing and memory calls through withAgentSession for that VTA', async () => {
    const { session, calls } = fakeSession('did:peer:2.admin')
    const ports = vtaPorts(agent(), VTA, session)
    await ports.access.grantApplication({ subject: 'did:key:z', contexts: [], capabilities: [], purposes: [] })
    await ports.access.findAgentEntries({ subject: 'did:key:z' })
    await ports.vdcSign.task('t', {})
    await ports.memory.whoAmI()
    expect(calls.map((c) => `${c.method}@${c.vtaDid}`)).toEqual([
      `grantApplication@${VTA}`,
      `findAgentEntries@${VTA}`,
      `task@${VTA}`,
      `whoAmI@${VTA}`,
    ])
  })
})

describe('connectedAgentsServices', () => {
  it("names memories by their context's name, never a context with none", async () => {
    const { session } = fakeSession('did:peer:2.admin')
    const services = connectedAgentsServices(agent(), VTA, session, async () => [])
    expect(await services.memoryNames()).toEqual({ 'keyring-memory-educat1on': 'Education' })
  })

  it('keeps the count of the last opening per agent and memory', async () => {
    const { session } = fakeSession('did:peer:2.admin')
    const services = connectedAgentsServices(agent(), VTA, session, async () => [])
    expect(await services.lastCount('a', 'm')).toBeUndefined()
    await services.saveCount('a', 'm', 12)
    await services.saveCount('a', 'm', 15)
    expect(await services.lastCount('a', 'm')).toBe(15)
    expect(await services.lastCount('b', 'm')).toBeUndefined()
  })

  it("offers only this VTA's personas, named by their label", async () => {
    const { session } = fakeSession('did:peer:2.admin')
    const services = connectedAgentsServices(agent(), VTA, session, async () => [
      { did: 'did:p:1', vtaDid: VTA, label: 'Ada at work' },
      { did: 'did:p:2', vtaDid: 'did:webvh:other', label: 'Elsewhere' },
      { did: 'did:p:3', label: 'No VTA named' },
    ])
    expect(await services.personas()).toEqual([
      { did: 'did:p:1', name: 'Ada at work' },
      { did: 'did:p:3', name: 'No VTA named' },
    ])
  })

  it('reconcile also sweeps unfinished pairings 10 minutes old that the VTA no longer lists (§3.10)', async () => {
    const { session } = fakeSession('did:peer:2.admin') // its VTA lists no entry
    const a = agent()
    const store = new AgentConnectionStore(a)
    const at = (msAgo: number) => new Date(FIXTURE_NOW - msAgo).toISOString()
    await store.put(
      agentRecord({
        id: 'did:key:z6MkOld',
        agentDid: 'did:key:z6MkOld',
        state: 'notFinished',
        createdAt: at(NOT_FINISHED_AFTER_MS),
      })
    )
    await store.put(
      agentRecord({ id: 'did:key:z6MkYoung', agentDid: 'did:key:z6MkYoung', state: 'notFinished', createdAt: at(1000) })
    )
    const services = connectedAgentsServices(
      a,
      VTA,
      session,
      async () => [],
      () => FIXTURE_NOW
    )
    await services.reconcile()
    expect((await store.list()).map((r) => r.id)).toEqual(['did:key:z6MkYoung'])
  })

  it('a driver is made over these services, idle until started', async () => {
    const { session } = fakeSession('did:peer:2.admin')
    const services = connectedAgentsServices(agent(), VTA, session, async () => [])
    expect((await services.driver(() => undefined)).state.phase).toBe('idle')
  })
})

describe('the reconcile (§3.4, §3.9, §3.10)', () => {
  let pairing: jest.SpyInstance
  let sweep: jest.SpyInstance
  beforeEach(() => {
    mockSteps.length = 0
    mockFailing.clear()
    const reconcilePairing = AgentConnectDriver.prototype.reconcilePairing
    pairing = jest.spyOn(AgentConnectDriver.prototype, 'reconcilePairing').mockImplementation(async function (
      this: AgentConnectDriver
    ) {
      mockSteps.push('reconcilePairing')
      if (mockFailing.has('reconcilePairing')) throw new Error('reconcilePairing failed')
      return reconcilePairing.call(this)
    })
    const sweepNotFinished = AgentActions.prototype.sweepNotFinished
    sweep = jest.spyOn(AgentActions.prototype, 'sweepNotFinished').mockImplementation(async function (
      this: AgentActions
    ) {
      mockSteps.push('sweepNotFinished')
      if (mockFailing.has('sweepNotFinished')) throw new Error('sweepNotFinished failed')
      return sweepNotFinished.call(this)
    })
  })
  afterEach(() => {
    pairing.mockRestore()
    sweep.mockRestore()
  })

  const ORDER = ['reconcilePairing', 'reconcileAgents', 'sweepNotFinished', 'readAgentEntries', 'reissueDueGrants']

  it('runs the pairing, the revoke reconcile, the sweep, the entry reads and the VDC re-issue, in that order', async () => {
    const { session } = fakeSession('did:peer:2.admin')
    await connectedAgentsServices(agent(), VTA, session, async () => []).reconcile()
    expect(mockSteps).toEqual(ORDER)
  })

  it('one step failing still runs the rest, and the reconcile itself does not fail', async () => {
    // control: awaiting each step without `step`'s catch makes this fail (the reconcile rejects at the first step).
    for (const failing of ORDER) {
      mockSteps.length = 0
      mockFailing.clear()
      mockFailing.add(failing)
      const { session } = fakeSession('did:peer:2.admin')
      await expect(connectedAgentsServices(agent(), VTA, session, async () => []).reconcile()).resolves.toBeUndefined()
      expect(mockSteps).toEqual(ORDER)
    }
  })

  it("keeps each agent's entry as read, and answers its contexts for drift; none before a reconcile", async () => {
    const record = agentRecord()
    const { session } = fakeSession('did:peer:2.admin', {
      findAgentEntries: () => ({
        complete: true,
        matches: [
          {
            deviceId: record.deviceId,
            entry: { subject: record.agentDid, act: { stated: 'contexts', contexts: ['keyring-memory-trave1abc'] } },
          },
        ],
      }),
    })
    const a = agent()
    await new AgentConnectionStore(a).put(record)
    const services = connectedAgentsServices(
      a,
      VTA,
      session,
      async () => [],
      () => FIXTURE_NOW
    )
    expect(services.entryContexts?.(record.id)).toBeUndefined()
    await services.reconcile()
    expect(services.entryContexts?.(record.id)).toEqual(['keyring-memory-trave1abc'])
    expect(services.entryContexts?.('did:key:z6MkNoSuchAgent')).toBeUndefined()
  })
})

describe("Remove's revoke (step 7.10, #1077)", () => {
  const refusal = () => Object.assign(new Error('subjectNotPresent'), { name: 'VtiRefusal' })
  const vta = (listings: Awaited<ReturnType<RevokeVta['findAgentEntries']>>[] | Error) => {
    const asked: { method: string; arg: unknown }[] = []
    const port: RevokeVta = {
      findAgentEntries: async (query) => {
        asked.push({ method: 'findAgentEntries', arg: query })
        if (listings instanceof Error) throw listings
        return listings.shift() ?? { complete: true, matches: [] }
      },
      revokeSubject: async (did) => {
        asked.push({ method: 'revokeSubject', arg: did })
        throw refusal()
      },
    }
    return { port, asked }
  }
  const listed = (subject: string) => ({ complete: true, matches: [{ entry: { subject } as never }] })

  it('with no deviceId: revokes the stored key (a refusal ignored), then lists by that key alone', async () => {
    const record = agentRecord({ deviceId: '' })
    const { port, asked } = vta([{ complete: true, matches: [] }])
    expect(await revokeEntryPort(port)(record)).toEqual({ gone: true })
    expect(asked).toEqual([
      { method: 'revokeSubject', arg: record.agentDid },
      { method: 'findAgentEntries', arg: { subject: record.agentDid } },
    ])
  })

  it('with no deviceId: an entry still listed, or a partial listing, is not gone; no answer throws', async () => {
    const record = agentRecord({ deviceId: '' })
    expect(await revokeEntryPort(vta([listed(record.agentDid)]).port)(record)).toEqual({ gone: false })
    expect(await revokeEntryPort(vta([{ complete: false, matches: [] }]).port)(record)).toEqual({ gone: false })
    await expect(revokeEntryPort(vta(new Error('timeout')).port)(record)).rejects.toThrow()
  })

  it('with a deviceId: removeAgentEntries decides, and a VTA that never answered throws', async () => {
    const record = agentRecord()
    const { port, asked } = vta([listed(record.agentDid), { complete: true, matches: [] }])
    expect(await revokeEntryPort(port)(record)).toEqual({ gone: true })
    expect(asked[0]).toEqual({
      method: 'findAgentEntries',
      arg: { deviceId: record.deviceId, subject: record.agentDid },
    })
    await expect(revokeEntryPort(vta(new Error('timeout')).port)(record)).rejects.toThrow(/did not answer/)
  })

  it('Remove of an expired agent with no deviceId whose entry is listed: revoked, then the record is dropped', async () => {
    const record = agentRecord({
      deviceId: '',
      expiresAt: new Date(FIXTURE_NOW - 60_000).toISOString(),
    })
    let revoked = false
    const { session, calls } = fakeSession('did:peer:2.admin', {
      findAgentEntries: () => (revoked ? { complete: true, matches: [] } : listed(record.agentDid)),
      revokeSubject: () => {
        revoked = true
        return { subject: record.agentDid }
      },
    })
    const a = agent()
    const store = new AgentConnectionStore(a)
    await store.put(record)
    const services = connectedAgentsServices(
      a,
      VTA,
      session,
      async () => [],
      () => FIXTURE_NOW
    )
    expect(await services.actions.remove(record.id)).toEqual({ ok: true })
    expect(await store.get(record.id)).toBeUndefined()
    expect(calls.filter((c) => c.method === 'revokeSubject').map((c) => c.args)).toEqual([[record.agentDid]])
  })
})

describe('tasks this phone sends about its own VTA: never waited on for consent', () => {
  it('deleting a memory sends vta/contexts/delete/1.2 with force, and waitForConsent: false', async () => {
    const { session, calls } = fakeSession('did:peer:2.admin')
    const services = connectedAgentsServices(agent(), VTA, session, async () => [])
    expect(await services.deleteMemory('keyring-memory-trave1abc', true)).toEqual({ ok: true, recordsNotUpdated: 0 })
    const sent = calls.filter((c) => c.method === 'task')
    expect(sent.map((c) => c.args)).toEqual([
      [
        VTA_TASK.contextsDelete12,
        { id: 'keyring-memory-trave1abc', force: true },
        30000,
        {},
        undefined,
        { waitForConsent: false },
      ],
    ])
    expect(sent[0].vtaDid).toBe(VTA)
  })

  it('a delete held for approval is heldForApproval, by the client classifier', async () => {
    const { VtiRefusal } = jest.requireActual('../../trust-tasks/module/vtiAgent') as {
      VtiRefusal: new (code: string, message: string, details?: unknown) => Error
    }
    const { session } = fakeSession('did:peer:2.admin', {
      task: () => {
        throw new VtiRefusal('auth:consent_required', 'held', { reason: 'auth:consent_required', consentRequests: [] })
      },
    })
    const services = connectedAgentsServices(agent(), VTA, session, async () => [])
    expect(await services.deleteMemory('keyring-memory-trave1abc', true)).toEqual({
      ok: false,
      code: 'heldForApproval',
    })
  })

  it('Keep it connected sends acl/update/0.3 with { subject, expiresAt: null }, and waitForConsent: false', async () => {
    const record = agentRecord()
    let updated = false
    const entry = () => ({
      complete: true,
      matches: [
        {
          deviceId: record.deviceId,
          entry: updated ? { subject: record.agentDid } : { subject: record.agentDid, expiresAt: record.expiresAt },
        },
      ],
    })
    const { session, calls } = fakeSession('did:peer:2.admin', {
      findAgentEntries: entry,
      task: (type) => {
        if (type === ACL_UPDATE_03) updated = true
        return {}
      },
    })
    const a = agent()
    await new AgentConnectionStore(a).put(record)
    const services = connectedAgentsServices(
      a,
      VTA,
      session,
      async () => [],
      () => FIXTURE_NOW
    )
    await services.actions.keepConnected(record.id)
    const update = calls.filter((c) => c.method === 'task' && c.args[0] === ACL_UPDATE_03)
    expect(update.map((c) => c.args)).toEqual([
      [ACL_UPDATE_03, { subject: record.agentDid, expiresAt: null }, 30000, {}, undefined, { waitForConsent: false }],
    ])
  })

  it('Keep it connected is not offered while it is unmeasured, nor for an agent with no record', async () => {
    const record = agentRecord()
    const a = agent()
    await new AgentConnectionStore(a).put(record)
    const services = connectedAgentsServices(
      a,
      VTA,
      fakeSession().session,
      async () => [],
      () => FIXTURE_NOW
    )
    expect(await services.keepConnectedOffered(record.id)).toBe(false)
    expect(await services.keepConnectedOffered('did:key:z6MkNoSuchAgent')).toBe(false)
  })
})

describe('a memory create an approval rule holds (#1060 finding 20)', () => {
  it("is heldForApproval with the client's own consent classifier; any other refusal is failed", async () => {
    const { VtiRefusal } = jest.requireActual('../../trust-tasks/module/vtiAgent') as {
      VtiRefusal: new (code: string, message: string, details?: unknown) => Error
    }
    const run = async (refusal: Error) => {
      const { session } = fakeSession('did:peer:2.admin')
      const wrapped: VtaSession = {
        ...session,
        withAgentSession: async (a, did, use) =>
          session.withAgentSession(a, did, (client) =>
            use(
              new Proxy(client, {
                get: (target, method: string) =>
                  method === 'createContext'
                    ? async () => {
                        throw refusal
                      }
                    : (target as unknown as Record<string, unknown>)[method],
              })
            )
          ),
      }
      return connectedAgentsServices(agent(), VTA, wrapped, async () => []).createMemory('Travel')
    }
    const held = new VtiRefusal('auth:consent_required', 'held', {
      reason: 'auth:consent_required',
      consentRequests: [],
    })
    expect(await run(held)).toEqual({ ok: false, code: 'heldForApproval' })
    expect(await run(new VtiRefusal('permissionDenied', 'no'))).toEqual({ ok: false, code: 'failed' })
  })
})

describe('administratorSigner (§7.5): the phone signs as its administrator DID', () => {
  it("signs as the session's manager DID, read at each signature, so a rotated key is followed", async () => {
    let manager: string | undefined = 'did:peer:2.first'
    const signer = administratorSigner(agent(), { getState: () => ({ managerDid: manager }) })
    expect(signer.did).toBe('did:peer:2.first')
    const first = await signer.sign({ a: 1 }, 'authentication')
    manager = 'did:peer:2.rotated'
    const second = await signer.sign({ a: 2 }, 'assertionMethod')
    expect(first.proof).toEqual({ by: 'did:peer:2.first', opts: { proofPurpose: 'authentication' } })
    expect(second.proof).toEqual({ by: 'did:peer:2.rotated', opts: { proofPurpose: 'assertionMethod' } })
  })

  it('with no administrator key it refuses, rather than sign as anyone else', async () => {
    const signer = administratorSigner(agent(), { getState: () => ({}) })
    expect(() => signer.did).toThrow(/no administrator key/)
    await expect(signer.sign({ a: 1 }, 'authentication')).rejects.toThrow(/no administrator key/)
  })
})
