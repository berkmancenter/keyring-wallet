/**
 * The connect driver (plan §7.7): the real pairing machine over the real carriage, with fakes for the owner's VTA.
 * P0 pairs by the fallback; a confirmed pairing is stored, and is `active` only once its VDC grant is issued and stored
 * (#1060 finding 19).
 */
import type { AccessEntry, AgentAccessPort } from '../carriage'
import { AgentConnectDriver, ConnectionRecords, personaSigningKeyId, unservedOob } from '../driver'
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
  public async put(record: AgentConnection) {
    this.records.set(record.id, JSON.parse(JSON.stringify(record)))
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
    rotate: () => {
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
