/**
 * The connect driver (plan §7.7): the real pairing machine over the real carriage, with fakes for the owner's VTA.
 * P0 pairs by the fallback; a confirmed pairing is stored, and is `active` only once its VDC grant is issued and stored
 * (#1060 finding 19).
 */
import type { AccessEntry, AgentAccessPort } from '../carriage'
import { AgentConnectDriver, ConnectionRecords, personaSigningKeyId, unservedOob } from '../driver'
import { isContactStatus, statusOf } from '../status'
import { deriveHandle } from '../handle'
import type { LockoutStore } from '../lockout'
import { NOT_FINISHED_AFTER_MS, type AgentConnectChoice, type PairingLink, type SpentRequestStore } from '../pairing'
import type { AgentConnection } from '../types'
import { KEYS_SIGN_DOCUMENT_TASK, type VdcSignPort } from '../vdc'

jest.mock('react-native-keychain', () => ({ ACCESS_CONTROL: {}, ACCESSIBLE: {}, STORAGE_TYPE: {} }))

const VTA = 'did:webvh:QmVta:vta.example.org'
const PERSONA = 'did:webvh:QmPersona:persona.example.org'
const K_T = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
const K_A = 'did:key:z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp'
const ID = 'q3Vn7Zk2Xo9Rt1LwPb4HdA'
const T0 = Date.parse('2026-11-26T12:00:00Z')
const MEMORY = 'keyring-memory-aaaaaaaaaa'

const choice = (): AgentConnectChoice => ({
  name: 'Notes helper',
  ownerPersonaDid: PERSONA,
  memoryContexts: [MEMORY],
  purposes: ['personalisation', 'taskExecution'],
})

const fallbackLink = (): PairingLink => ({
  kind: 'fallback',
  agentDid: K_T,
  requestId: ID,
  exp: Math.floor(T0 / 1000) + 300,
})

class MemoryRecords implements ConnectionRecords {
  public records = new Map<string, AgentConnection>()
  public async list() {
    return [...this.records.values()]
  }
  public async get(id: string) {
    return this.records.get(id)
  }
  private queue: Promise<unknown> = Promise.resolve()
  /** Called once, by the next findByKey, before it answers: lets a test land another writer's change just then. */
  public beforeNextFind?: () => void
  // One queue for every write of the fake, as the store has one lock per record.
  private locked<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work)
    this.queue = next.catch(() => undefined)
    return next
  }
  public put(record: AgentConnection) {
    return this.locked(async () => {
      this.records.set(record.id, JSON.parse(JSON.stringify(record)))
    })
  }
  public update(id: string, change: (r: AgentConnection) => AgentConnection) {
    return this.upsert(id, (r) => (r ? change(r) : undefined))
  }
  public upsert(id: string, decide: (r: AgentConnection | undefined) => AgentConnection | undefined) {
    return this.locked(async () => {
      const stored = this.records.get(id)
      const current = stored ? (JSON.parse(JSON.stringify(stored)) as AgentConnection) : undefined
      const next = decide(current)
      if (next === undefined || next === current) return current
      this.records.set(id, JSON.parse(JSON.stringify(next)))
      return next
    })
  }
  public async findByKey(did: string) {
    const hook = this.beforeNextFind
    this.beforeNextFind = undefined
    hook?.()
    return [...this.records.values()].find((r) => r.id === did || r.agentDid === did)
  }
}

class MemorySpent implements SpentRequestStore {
  public ids = new Set<string>()
  public async has(id: string) {
    return this.ids.has(id)
  }
  public async add(id: string) {
    this.ids.add(id)
  }
}

class MemoryLockout implements LockoutStore {
  public times: number[] = []
  public async load() {
    return [...this.times]
  }
  public async save(times: number[]) {
    this.times = [...times]
  }
}

/** The owner's VTA: the access list (the entry the test makes the agent rotate to) and the persona's signer. */
function fakeVta() {
  const grants: Parameters<AgentAccessPort['grantApplication']>[0][] = []
  let listed: { entry: AccessEntry; deviceId?: string; kind?: string } | undefined
  let signing: 'ok' | 'fail' = 'ok'
  let duringSign: () => Promise<void> = async () => undefined
  const signed: Record<string, unknown>[] = []
  const access: AgentAccessPort = {
    async grantApplication(grant) {
      grants.push(grant)
      return { entry: {} }
    },
    async findAgentEntries() {
      return { complete: true, matches: listed ? [listed] : [] }
    },
    async narrowOrWidenCapabilities() {
      return {}
    },
  }
  const vdcSign: VdcSignPort = {
    async task(type, payload) {
      expect(type).toBe(KEYS_SIGN_DOCUMENT_TASK)
      if (signing === 'fail') throw new Error('unreachable')
      await duringSign()
      signed.push(payload)
      const document = payload.document as Record<string, unknown>
      const proof = { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', verificationMethod: payload.keyId }
      return { keyId: payload.keyId, signerDid: document.issuer, document: { ...document, proof }, proof }
    },
  }
  return {
    access,
    vdcSign,
    grants,
    signed,
    /** The agent registered, then swapped K_t for K_a: the entry as the VTA lists it now, with what was granted. */
    rotate: (over: Partial<AccessEntry> = {}) => {
      const g = grants[grants.length - 1]
      listed = {
        entry: {
          subject: K_A,
          role: 'application',
          act: { stated: 'contexts', contexts: [...g.contexts] },
          capabilityScope: { stated: 'listed', capabilities: [...g.capabilities] },
          purposes: { scope: 'listed', purposes: [...g.purposes] },
          keys: { scope: 'none' },
          expiresAt: g.expiresAt,
          ...over,
        },
        deviceId: 'dev-1',
        kind: 'ai-agent',
      }
    },
    failSigning: () => {
      signing = 'fail'
    },
    restoreSigning: () => {
      signing = 'ok'
    },
    whileSigning: (f: () => Promise<void>) => {
      duringSign = f
    },
  }
}

async function setup(existing: AgentConnection[] = []) {
  let now = T0
  const vta = fakeVta()
  const connections = new MemoryRecords()
  for (const r of existing) await connections.put(r)
  const phases: string[] = []
  const driver = await AgentConnectDriver.create(
    {
      clock: () => now,
      vtaDid: VTA,
      access: vta.access,
      vdcSign: vta.vdcSign,
      verify: async () => true,
      administrator: { did: 'did:peer:2.admin', sign: async (d) => d },
      connections,
      lockoutStore: new MemoryLockout(),
      spent: new MemorySpent(),
    },
    (s) => phases.push(s.phase)
  )
  return {
    driver,
    vta,
    connections,
    phases,
    advance: (ms: number) => {
      now += ms
    },
  }
}

async function pairToConfirmed(t: Awaited<ReturnType<typeof setup>>) {
  await t.driver.start(choice())
  await t.driver.scan(fallbackLink())
  expect(t.driver.state.phase).toBe('awaitingApproval')
  await t.driver.approve()
  expect(t.driver.state.phase).toBe('awaitingEnrolment')
  t.vta.rotate()
  expect((await t.driver.poll()).phase).toBe('confirmed')
  return t.driver.settled()
}

describe('the P0 fallback through the driver', () => {
  it('grants for K_t, confirms on the rotated entry, stores the record and its VDC grant, and only then is active', async () => {
    const t = await setup()
    expect(await pairToConfirmed(t)).toEqual({ state: 'active' })
    expect(t.vta.grants).toHaveLength(1)
    expect(t.vta.grants[0]).toMatchObject({
      subject: K_T,
      contexts: [MEMORY],
      purposes: ['personalisation', 'taskExecution'],
    })
    const record = t.connections.records.get(K_A)
    expect(record).toMatchObject({
      id: K_A,
      agentDid: K_A,
      deviceId: 'dev-1',
      vtaDid: VTA,
      ownerPersonaDid: PERSONA,
      memoryContexts: [MEMORY],
      contexts: [MEMORY],
      pendingContexts: [],
      capabilities: ['memory-read', 'memory-write'],
      grantType: 'temporary',
      state: 'active',
      keyChanged: false,
      answersOthers: false,
    })
    expect(record?.handle).toBe(
      deriveHandle('Notes helper', K_A, []).ok && (deriveHandle('Notes helper', K_A, []) as { handle: string }).handle
    )
    const grant = record?.vdcGrant as { issuer?: string; credentialSubject?: { id?: string }; proof?: unknown }
    expect(grant.issuer).toBe(PERSONA)
    expect(grant.credentialSubject?.id).toBe(K_A)
    expect(grant.proof).toBeDefined()
    expect(t.vta.signed[0].keyId).toBe(personaSigningKeyId(PERSONA))
  })

  it("the handle check knows the owner's other agents", async () => {
    const first = deriveHandle('Notes helper', K_A, [])
    if (!first.ok) throw new Error('no handle')
    const other: AgentConnection = {
      id: 'did:key:z6MkOther',
      name: 'Notes helper',
      handle: first.handle,
      agentDid: 'did:key:z6MkOther',
      deviceId: 'dev-0',
      ownerPersonaDid: PERSONA,
      vtaDid: VTA,
      contexts: [],
      memoryContexts: [],
      pendingContexts: [],
      capabilities: [],
      purposes: ['personalisation'],
      grantType: 'persistent',
      answersOthers: false,
      state: 'active',
      keyChanged: false,
      createdAt: new Date(T0).toISOString(),
    }
    const t = await setup([other])
    await pairToConfirmed(t)
    const handle = t.connections.records.get(K_A)?.handle
    expect(handle).not.toBe(first.handle)
    expect(handle).toBe((deriveHandle('Notes helper', K_A, [first.handle]) as { handle: string }).handle)
  })
})

describe('a grant that cannot be issued (#1060 finding 19)', () => {
  it('leaves the record pairing, not listed; a later reconcile issues it and makes it active', async () => {
    const t = await setup()
    t.vta.failSigning()
    expect(await pairToConfirmed(t)).toEqual({ state: 'pairing', reason: 'vdc' })
    expect(t.connections.records.get(K_A)?.state).toBe('pairing')
    expect(t.connections.records.get(K_A)?.vdcGrant).toBeUndefined()
    t.vta.restoreSigning()
    await t.driver.reconcilePairing()
    expect(t.connections.records.get(K_A)?.state).toBe('active')
  })

  it('ten minutes after the pairing, a grant still not issued is Not finished', async () => {
    const t = await setup()
    t.vta.failSigning()
    await pairToConfirmed(t)
    t.advance(NOT_FINISHED_AFTER_MS - 1)
    await t.driver.reconcilePairing()
    expect(t.connections.records.get(K_A)?.state).toBe('pairing')
    t.advance(1)
    await t.driver.reconcilePairing()
    expect(t.connections.records.get(K_A)?.state).toBe('notFinished')
  })
})

describe('auth/oob while no VTA serves it (P0)', () => {
  it('an auth/oob code ends as unsupported, and nothing is written', async () => {
    const t = await setup()
    await t.driver.start(choice())
    const end = await t.driver.scan({ kind: 'oob', vtaDid: VTA, requestId: ID, exp: Math.floor(T0 / 1000) + 300 })
    expect(end).toMatchObject({ phase: 'failed', reason: 'unsupported' })
    expect(t.connections.records.size).toBe(0)
    expect(t.vta.grants).toHaveLength(0)
    expect(await unservedOob.send(VTA, {})).toEqual({ refused: 'auth/oob/claim:unsupportedType' })
  })

  it('control: a code for a VTA this phone does not administer is refused before any call', async () => {
    const t = await setup()
    await t.driver.start(choice())
    const end = await t.driver.scan({
      kind: 'oob',
      vtaDid: 'did:webvh:QmOther:other.example.org',
      requestId: ID,
      exp: Math.floor(T0 / 1000) + 300,
    })
    expect(end).toMatchObject({ phase: 'failed', reason: 'foreign-vta' })
  })
})

describe('what an ended pairing leaves at the VTA is recorded as Not finished (§3.10)', () => {
  async function toEnrolment(t: Awaited<ReturnType<typeof setup>>) {
    await t.driver.start(choice())
    await t.driver.scan(fallbackLink())
    await t.driver.approve()
    expect(t.driver.state.phase).toBe('awaitingEnrolment')
  }

  it("a cancel after the grant: K_t's entry is a Not finished row, never a contact", async () => {
    const t = await setup()
    await toEnrolment(t)
    expect((await t.driver.cancel()).phase).toBe('cancelled')
    expect(await t.driver.settled()).toEqual({ state: 'notFinished', subject: K_T })
    const record = t.connections.records.get(K_T)
    expect(record).toMatchObject({ id: K_T, name: 'Notes helper', vtaDid: VTA, state: 'notFinished', handle: '' })
    expect(statusOf(record as AgentConnection, T0)).toBe('notFinished')
    expect(isContactStatus(statusOf(record as AgentConnection, T0))).toBe(false)
  })

  it("a rotation that lost a limit: K_a's entry, with its deviceId, is recorded", async () => {
    const t = await setup()
    await toEnrolment(t)
    t.vta.rotate({ expiresAt: new Date(T0 + 99 * 60 * 60 * 1000).toISOString() })
    expect(await t.driver.poll()).toMatchObject({ phase: 'failed', reason: 'rotation-lost-limits' })
    expect(await t.driver.settled()).toEqual({ state: 'notFinished', subject: K_A })
    expect(t.connections.records.get(K_A)).toMatchObject({ state: 'notFinished', deviceId: 'dev-1' })
  })

  it('a pairing still not enrolled after ten minutes is recorded under K_t', async () => {
    const t = await setup()
    await toEnrolment(t)
    t.advance(NOT_FINISHED_AFTER_MS)
    expect((await t.driver.poll()).phase).toBe('notFinished')
    expect(await t.driver.settled()).toEqual({ state: 'notFinished', subject: K_T })
    expect(t.connections.records.get(K_T)?.state).toBe('notFinished')
  })

  it('control: a cancel before any grant leaves nothing to record', async () => {
    const t = await setup()
    await t.driver.start(choice())
    await t.driver.scan(fallbackLink())
    await t.driver.cancel()
    expect(await t.driver.settled()).toBeUndefined()
    expect(t.connections.records.size).toBe(0)
  })

  it("control: a leftover never writes over a connected agent's record", async () => {
    const t = await setup()
    await toEnrolment(t)
    await t.connections.put({
      id: K_T,
      name: 'Already connected',
      handle: 'already-k3qa',
      agentDid: K_T,
      deviceId: 'dev-0',
      ownerPersonaDid: PERSONA,
      vtaDid: VTA,
      contexts: [],
      memoryContexts: [],
      pendingContexts: [],
      capabilities: [],
      purposes: ['personalisation'],
      grantType: 'persistent',
      answersOthers: false,
      state: 'active',
      keyChanged: false,
      createdAt: new Date(T0).toISOString(),
    })
    await t.driver.cancel()
    expect(await t.driver.settled()).toEqual({ state: 'kept', subject: K_T })
    expect(t.connections.records.get(K_T)?.state).toBe('active')
  })
})

describe('two writers of one record at app start (step 7.10 and the driver)', () => {
  it("a changed key 7.10 records while the grant is being signed survives the grant's write", async () => {
    const t = await setup()
    t.vta.failSigning()
    await pairToConfirmed(t)
    t.vta.restoreSigning()
    t.vta.whileSigning(async () => {
      await t.connections.update(K_A, (r) => ({ ...r, keyChanged: true, agentDid: 'did:key:z6MkRotatedByReconcile' }))
    })
    await t.driver.reconcilePairing()
    expect(t.connections.records.get(K_A)).toMatchObject({
      id: K_A,
      state: 'active',
      keyChanged: true,
      agentDid: 'did:key:z6MkRotatedByReconcile',
    })
  })

  it("a record that becomes active between the leftover's read and its write is kept, grant and all", async () => {
    const t = await setup()
    await t.connections.put({
      id: K_T,
      name: 'Being granted',
      handle: 'granted-k3qa',
      agentDid: K_T,
      deviceId: 'dev-0',
      ownerPersonaDid: PERSONA,
      vtaDid: VTA,
      contexts: [],
      memoryContexts: [],
      pendingContexts: [],
      capabilities: [],
      purposes: ['personalisation'],
      grantType: 'persistent',
      answersOthers: false,
      state: 'pairing',
      keyChanged: false,
      createdAt: new Date(T0).toISOString(),
    })
    await t.driver.start(choice())
    await t.driver.scan(fallbackLink())
    await t.driver.approve()
    // Another writer stores the grant just after the leftover's lookup has read "pairing".
    let granting: Promise<unknown> = Promise.resolve()
    t.connections.beforeNextFind = () => {
      granting = t.connections.update(K_T, (r) => ({ ...r, state: 'active', vdcGrant: { issuer: PERSONA } }))
    }
    await t.driver.cancel()
    expect(await t.driver.settled()).toEqual({ state: 'kept', subject: K_T })
    await granting
    expect(t.connections.records.get(K_T)).toMatchObject({ state: 'active', vdcGrant: { issuer: PERSONA } })
  })

  it("a leftover naming a connected agent's CURRENT key is not written beside it (Remove would revoke it)", async () => {
    const t = await setup()
    await t.connections.put({
      id: 'did:key:z6MkFirstKey',
      name: 'Rotated agent',
      handle: 'rotated-k3qa',
      agentDid: K_T,
      deviceId: 'dev-0',
      ownerPersonaDid: PERSONA,
      vtaDid: VTA,
      contexts: [],
      memoryContexts: [],
      pendingContexts: [],
      capabilities: [],
      purposes: ['personalisation'],
      grantType: 'persistent',
      answersOthers: false,
      state: 'active',
      keyChanged: true,
      createdAt: new Date(T0).toISOString(),
    })
    await t.driver.start(choice())
    await t.driver.scan(fallbackLink())
    await t.driver.approve()
    await t.driver.cancel()
    expect(await t.driver.settled()).toEqual({ state: 'kept', subject: K_T })
    expect(t.connections.records.has(K_T)).toBe(false)
  })
})
