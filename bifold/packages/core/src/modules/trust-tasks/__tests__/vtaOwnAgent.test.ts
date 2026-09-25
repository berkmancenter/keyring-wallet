/**
 * Owning an agent from the phone (own_agent_subtask.md §2–§4, Phase 1): the
 * device list, adding a backup phone, removing a device, and the create flow's
 * one new check.
 *
 * The VTA below is the fake with an ACL from vtaSwapKeyRecovery.test.ts, grown
 * to hold ACL rows and answer the canonical `acl/*` tasks the way vta-service
 * does at ed672fff:
 *
 * - `acl/list/0.1` answers `{entries, truncated, cursor?, redactedFields?}`
 *   over the canonical `AclEntry` (vta-service trust_tasks/acl.rs:27-55,
 *   operations/acl.rs:1034-1057, vta-sdk acl_management/list.rs:77-93).
 * - `acl/grant/0.1` takes `{entry}` and answers `{entry}` (acl.rs:57-84,
 *   acl_management/create.rs:24-68); a subject already on the ACL is
 *   `taskFailed` "conflict: ACL entry already exists for DID: …"
 *   (operations/acl.rs:391-395, helpers.rs:154).
 * - `acl/revoke/0.1` takes `{subject}` and answers `{entry}` (acl.rs:207-234,
 *   acl_management/delete.rs:23-74); revoking yourself is `taskFailed`
 *   "conflict: cannot delete your own ACL entry" (operations/acl.rs:792-796).
 */
const ENVELOPE = 'https://trusttasks.org/binding/didcomm/0.1/envelope'
const TASK_ERROR = 'https://trusttasks.org/spec/trust-task-error/0.1'
const WHOAMI = 'https://trusttasks.org/spec/auth/whoami/0.1'
const SWAP = 'https://trusttasks.org/spec/acl/swap-key/0.1'
const ACL_LIST = 'https://trusttasks.org/spec/acl/list/0.1'
const ACL_GRANT = 'https://trusttasks.org/spec/acl/grant/0.1'
const ACL_REVOKE = 'https://trusttasks.org/spec/acl/revoke/0.1'
const ACL_UPDATE = 'https://trusttasks.org/spec/acl/update/0.1'
const VTA = 'did:webvh:QmFarm:farm.example:alice'
const PHONE = 'did:peer:2.phone'
const BACKUP = 'did:peer:2.backup'
const TEMPORARY = 'did:key:z6Mktemporary'
const PERMANENT = 'did:peer:2.permanent'

type Plain = { from: string; body: { type: string; payload: Record<string, unknown> } }
type Row = { role: string; scopes?: string[]; label?: string; expiresAt?: string }
type Refusal = { code: string; message: string; details?: unknown }

const mockVta = {
  refuseUpdate: false,
  acl: new Map<string, Row>(),
  asked: [] as { from: string; type: string; payload: Record<string, unknown> }[],
  /** Everything that happened, in order — owner confirmations and sends. */
  log: [] as string[],
  /** Refuse the next task of this type with this error, once. */
  refuseNext: new Map<string, Refusal>(),
  /** Hold these task types for consent until `consentGranted` is true. */
  consentFor: new Set<string>(),
  consentGranted: false,
  /** Members a newer VTA might add to every list entry — ignored by the phone. */
  extraEntryMembers: {} as Record<string, unknown>,
}
const mockSessions: { did: string; onMessage: (m: unknown) => void; open: boolean }[] = []
let mockMinted: string[] = []
/** Options the controller's client is built with; a test may shorten the consent wait. */
const mockClientOptions: Record<string, unknown> = {}

function mockAnswer(session: { onMessage: (m: unknown) => void }, type: string, payload: Record<string, unknown>) {
  setTimeout(
    () =>
      session.onMessage({
        type: ENVELOPE,
        created_time: Math.floor(Date.now() / 1000),
        body: { type, payload },
      }),
    0
  )
}

function mockWireEntry(subject: string, row: Row) {
  return {
    subject,
    role: row.role,
    ...(row.scopes?.length ? { scopes: row.scopes } : {}),
    ...(row.label ? { label: row.label } : {}),
    ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
    createdAt: '2026-09-25T00:00:00Z',
    createdBy: PHONE,
    ...mockVta.extraEntryMembers,
  }
}

jest.mock('@bifold/trust-tasks', () => ({
  TRUST_TASK_V2_ENVELOPE_TYPE: 'https://trusttasks.org/binding/didcomm/0.1/envelope',
  tsp: { CODEC_FORMS_RELATIONSHIPS: false },
  signDocumentProof: jest.fn(async (_a: unknown, doc: Record<string, unknown>) => doc),
  signCompactJws: jest.fn(async () => 'header.payload.sig'),
}))
jest.mock('../module/tspCapability', () => ({ chooseCarriage: jest.fn(async () => 'didcomm') }))
jest.mock('../module/vtiTsp', () => ({
  tspSessionForManager: jest.fn(async () => {
    throw new Error('no TSP in this test')
  }),
  packTrustTaskForPeer: jest.fn(),
  unpackTrustTaskFromPeer: jest.fn(),
}))
jest.mock('../module/VtiMediatorTransport', () => ({
  createVtiClientDid: jest.fn(async () => {
    const did = 'did:peer:2.permanent'
    mockMinted.push(did)
    return did
  }),
  createVtiTemporaryDidKey: jest.fn(async () => {
    const did = 'did:key:z6Mktemporary'
    mockMinted.push(did)
    return did
  }),
  resolveVtiMediator: jest.fn(async (_a: unknown, did: string) => ({ did })),
  resolveDidDocumentRetrying: jest.fn(async () => ({
    service: [{ type: 'DIDCommMessaging', serviceEndpoint: 'did:peer:2.mediator' }],
  })),
  vtiClientIdentityFromDid: jest.fn(async (_a: unknown, did: string) => ({ did })),
  VtiMediatorSession: class {
    readonly record: (typeof mockSessions)[number]
    constructor(_agent: unknown, identity: { did: string }, _m: unknown, opts: { onMessage: (m: unknown) => void }) {
      this.record = { did: identity.did, onMessage: opts.onMessage, open: false }
      mockSessions.push(this.record)
    }
    get isOpen() {
      return this.record.open
    }
    async start() {
      this.record.open = true
    }
    async stop() {
      this.record.open = false
    }
    async sendTo(_to: string, message: Plain) {
      const { from, body } = message
      const payload = body.payload ?? {}
      mockVta.asked.push({ from, type: body.type, payload })
      mockVta.log.push(`sent ${body.type}`)
      const refuse = (r: Refusal) => mockAnswer(this.record, TASK_ERROR, r as unknown as Record<string, unknown>)
      if (!mockVta.acl.has(from)) {
        refuse({ code: 'permissionDenied', message: `forbidden: DID not in ACL: ${from}` })
        return
      }
      const injected = mockVta.refuseNext.get(body.type)
      if (injected) {
        mockVta.refuseNext.delete(body.type)
        refuse(injected)
        return
      }
      if (mockVta.consentFor.has(body.type) && !mockVta.consentGranted) {
        // policy_gate.rs consent_gate: held, with the challenge in details.
        refuse({
          code: 'taskFailed',
          message: 'auth:consent_required',
          details: { reason: 'auth:consent_required', payloadDigest: 'zQmDigest', consentRequests: [] },
        })
        return
      }
      switch (body.type) {
        case WHOAMI:
          mockAnswer(this.record, `${WHOAMI}#response`, { roles: ['admin'] })
          return
        case SWAP: {
          const newSubject = String(payload.newSubject)
          const row = mockVta.acl.get(from) as Row
          mockVta.acl.set(newSubject, row)
          mockVta.acl.delete(from)
          mockAnswer(this.record, `${SWAP}#response`, { entry: { subject: newSubject }, previousSubject: from })
          return
        }
        case ACL_LIST:
          mockAnswer(this.record, `${ACL_LIST}#response`, {
            entries: [...mockVta.acl].map(([subject, row]) => mockWireEntry(subject, row)),
            truncated: false,
            redactedFields: [],
          })
          return
        case ACL_GRANT: {
          const entry = payload.entry as { subject: string; role: string; label?: string; scopes?: string[] }
          if (mockVta.acl.has(entry.subject)) {
            refuse({
              code: 'taskFailed',
              message: `conflict: ACL entry already exists for DID: ${entry.subject}`,
              details: { reason: 'conflict' },
            })
            return
          }
          mockVta.acl.set(entry.subject, { role: entry.role, scopes: entry.scopes, label: entry.label })
          mockAnswer(this.record, `${ACL_GRANT}#response`, {
            entry: mockWireEntry(entry.subject, mockVta.acl.get(entry.subject) as Row),
          })
          return
        }
        case ACL_REVOKE: {
          const subject = String(payload.subject)
          if (subject === from) {
            refuse({
              code: 'taskFailed',
              message: 'conflict: cannot delete your own ACL entry',
              details: { reason: 'conflict' },
            })
            return
          }
          const row = mockVta.acl.get(subject)
          if (!row) {
            refuse({
              code: 'taskFailed',
              message: `not found: ACL entry not found for DID: ${subject}`,
              details: { reason: 'not_found' },
            })
            return
          }
          mockVta.acl.delete(subject)
          mockAnswer(this.record, `${ACL_REVOKE}#response`, { entry: mockWireEntry(subject, row) })
          return
        }
        case ACL_UPDATE: {
          const subject = String(payload.subject)
          const row = mockVta.acl.get(subject)
          if (!row || mockVta.refuseUpdate) {
            refuse({ code: 'taskFailed', message: `not found: ACL entry not found for DID: ${subject}` })
            return
          }
          if (typeof payload.label === 'string') row.label = payload.label
          mockAnswer(this.record, `${ACL_UPDATE}#response`, { entry: mockWireEntry(subject, row) })
          return
        }
        default:
          refuse({ code: 'unsupportedType', message: `no handler for ${body.type}` })
      }
    }
  },
}))

// The controller's own client, with a fast clock: no drain, short waits.
jest.mock('../module/VtaClient', () => {
  const actual = jest.requireActual('../module/VtaClient')
  class FastVtaClient extends actual.VtaClient {
    constructor(a: unknown, vtaDid: string, store: unknown, options: Record<string, unknown> = {}) {
      super(a, vtaDid, store, {
        connectDrainMs: 0,
        swapTimeoutMs: 200,
        probeTimeoutMs: 200,
        consentWaitMs: 0,
        ...mockClientOptions,
        ...options,
      })
    }
  }
  return { ...actual, VtaClient: FastVtaClient }
})

import { VtaClient } from '../module/VtaClient'
import type { VtaLink } from '../module/VtaLinkStore'
import type { VtiManagerIdentity } from '../module/VtiIdentityStore'
import { VtaAgentController } from '../module/vtaAgent'
import {
  DeviceActionRefused,
  DeviceCannotOwn,
  OwnerCheckNotConfigured,
  OwnerNotConfirmed,
  type OwnerConfirmation,
} from '../module/vtaOwner'

const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }
const agent = {
  config: { logger },
  dids: { resolveDidDocument: jest.fn(async () => Promise.reject(new Error('no resolver in this test'))) },
} as never

const linkedManager: VtiManagerIdentity = {
  vtaDid: VTA,
  did: PHONE,
  createdAt: '2026-09-25T00:00:00Z',
  stage: 'permanent',
}

/** The phone's two stores. */
function phone(initial: { manager?: VtiManagerIdentity; link?: VtaLink } = {}) {
  const disk = { manager: initial.manager, link: initial.link }
  const identities = {
    getManager: jest.fn(async () => disk.manager),
    setManager: jest.fn(async (m: VtiManagerIdentity) => {
      disk.manager = { ...m }
    }),
    forgetManager: jest.fn(async () => {
      disk.manager = undefined
    }),
  }
  const links = {
    get: async () => disk.link,
    set: async (link: VtaLink) => {
      disk.link = { ...link }
    },
    clear: async () => {
      disk.link = undefined
    },
  }
  return { disk, identities, links }
}

type Owner = {
  confirmOwner?: jest.Mock<Promise<OwnerConfirmation>, [string]>
  deviceCanOwn?: jest.Mock<Promise<boolean>, []>
}

const confirmed = () =>
  jest.fn(async (reason: string) => {
    mockVta.log.push(`confirmOwner: ${reason}`)
    return { ok: true } as OwnerConfirmation
  })

let alive: VtaAgentController[] = []

async function until(done: () => boolean, ms = 4000) {
  for (let waited = 0; !done(); waited += 10) {
    if (waited > ms) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** A phone linked to its agent, online, as the owner. */
async function linkedPhone(owner: Owner = { confirmOwner: confirmed() }) {
  const p = phone({ manager: linkedManager, link: { vtaDid: VTA, label: 'farm.example', linkedAt: 'x', owner: true } })
  const vta = new VtaAgentController()
  alive.push(vta)
  vta.configure({
    linkStore: () => p.links,
    identityStore: () => p.identities as never,
    ...owner,
  })
  await vta.restore(agent)
  await until(() => {
    const link = vta.getState().link
    return link.kind === 'linked' && link.connection.kind === 'online'
  })
  mockVta.asked = []
  mockVta.log = []
  return { vta, ...p }
}

const sentOf = (type: string) => mockVta.asked.filter((a) => a.type === type)
/** Wait (in 10 ms steps, up to 2 s) until the phone has sent its background acl/update. */
async function labelSent() {
  for (let waited = 0; sentOf(ACL_UPDATE).length === 0 && waited < 2000; waited += 10) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

beforeEach(() => {
  mockVta.refuseUpdate = false
  mockVta.acl = new Map([
    [PHONE, { role: 'admin' }],
    ['did:key:z6MkMediator', { role: 'application', scopes: ['vta'] }],
  ])
  mockVta.asked = []
  mockVta.log = []
  mockVta.refuseNext = new Map()
  mockVta.consentFor = new Set()
  mockVta.consentGranted = false
  mockVta.extraEntryMembers = {}
  mockSessions.length = 0
  mockMinted = []
  for (const key of Object.keys(mockClientOptions)) delete mockClientOptions[key]
  jest.clearAllMocks()
})

afterEach(async () => {
  for (const vta of alive) await vta.unlink(agent).catch(() => undefined)
  alive = []
})

describe('VtaClient: the acl/* tasks', () => {
  async function connected() {
    const store = {
      getManager: jest.fn(async () => linkedManager),
      setManager: jest.fn(async () => undefined),
    }
    const client = new VtaClient(agent, VTA, store as never, { connectDrainMs: 0 })
    await client.connect()
    mockVta.asked = []
    return client
  }

  it('grantAdmin sends exactly an unrestricted, permanent admin entry', async () => {
    const client = await connected()
    const entry = await client.grantAdmin(BACKUP, { label: 'Pixel 8' })
    expect(sentOf(ACL_GRANT).map((a) => a.payload)).toEqual([
      { entry: { subject: BACKUP, role: 'admin', label: 'Pixel 8' } },
    ])
    expect(entry).toMatchObject({ subject: BACKUP, role: 'admin', label: 'Pixel 8' })
    await client.disconnect()
  })

  it('grantAdmin without a label sends no label, and clips one past the schema bound', async () => {
    const client = await connected()
    await client.grantAdmin(BACKUP)
    await client.grantAdmin('did:peer:2.third', { label: 'x'.repeat(300) })
    const [first, second] = sentOf(ACL_GRANT).map((a) => a.payload as { entry: Record<string, unknown> })
    expect(first).toEqual({ entry: { subject: BACKUP, role: 'admin' } })
    expect(String(second.entry.label)).toHaveLength(256)
    await client.disconnect()
  })

  it('revokeSubject sends a full removal: the subject, no scopes', async () => {
    mockVta.acl.set(BACKUP, { role: 'admin' })
    const client = await connected()
    const removed = await client.revokeSubject(BACKUP)
    expect(sentOf(ACL_REVOKE).map((a) => a.payload)).toEqual([{ subject: BACKUP }])
    expect(removed).toMatchObject({ subject: BACKUP, role: 'admin' })
    expect(mockVta.acl.has(BACKUP)).toBe(false)
    await client.disconnect()
  })

  it('listAcl reads the entries and ignores members it does not know', async () => {
    mockVta.extraEntryMembers = { stepUp: { require: 'self' }, ext: { 'org.example': 1 }, somethingNew: true }
    const client = await connected()
    const entries = await client.listAcl()
    expect(sentOf(ACL_LIST).map((a) => a.payload)).toEqual([{}])
    expect(entries.map((e) => [e.subject, e.role])).toEqual([
      [PHONE, 'admin'],
      ['did:key:z6MkMediator', 'application'],
    ])
    await client.disconnect()
  })

  it('listAcl drops rows that are not entries, and tolerates a missing list', async () => {
    const client = await connected()
    mockVta.refuseNext = new Map()
    const spy = jest
      .spyOn(client, 'task')
      .mockResolvedValueOnce({ entries: [{ subject: 'did:key:a', role: 'admin' }, { role: 'admin' }, 'junk', null] })
      .mockResolvedValueOnce({ truncated: false })
    expect((await client.listAcl()).map((e) => e.subject)).toEqual(['did:key:a'])
    expect(await client.listAcl()).toEqual([])
    spy.mockRestore()
    await client.disconnect()
  })
})

describe('the device list', () => {
  it('lists the admin rows only, and marks this phone', async () => {
    mockVta.acl.set(BACKUP, { role: 'admin', label: 'Pixel 8', expiresAt: '2026-10-01T00:00:00Z' })
    const { vta } = await linkedPhone()
    const devices = await vta.listDevices(agent)
    expect(devices).toEqual([
      { did: PHONE, role: 'admin', thisPhone: true, createdAt: '2026-09-25T00:00:00Z', createdBy: PHONE },
      {
        did: BACKUP,
        role: 'admin',
        label: 'Pixel 8',
        thisPhone: false,
        expiresAt: '2026-10-01T00:00:00Z',
        createdAt: '2026-09-25T00:00:00Z',
        createdBy: PHONE,
      },
    ])
  })

  it('agentAddress is the linked agent, and nothing before a link', async () => {
    const { vta } = await linkedPhone()
    expect(vta.agentAddress()).toBe(VTA)
    expect(new VtaAgentController().agentAddress()).toBeUndefined()
  })

  it('an unlinked phone has no devices to list', async () => {
    const vta = new VtaAgentController()
    const p = phone()
    vta.configure({ linkStore: () => p.links, identityStore: () => p.identities as never })
    await expect(vta.listDevices(agent)).rejects.toMatchObject({ name: 'DeviceActionRefused', reason: 'notLinked' })
  })
})

describe('adding a backup device', () => {
  it('asks the owner first, then sends the grant', async () => {
    const confirmOwner = confirmed()
    const { vta } = await linkedPhone({ confirmOwner })
    const added = await vta.addBackupDevice(agent, BACKUP, 'Pixel 8')

    expect(confirmOwner).toHaveBeenCalledTimes(1)
    expect(mockVta.log[0]).toMatch(/^confirmOwner: /)
    expect(mockVta.log.filter((l) => l.startsWith('sent ')).slice(-1)).toEqual([`sent ${ACL_GRANT}`])
    expect(sentOf(ACL_GRANT).map((a) => a.payload)).toEqual([
      { entry: { subject: BACKUP, role: 'admin', label: 'Pixel 8' } },
    ])
    expect(added).toEqual({
      did: BACKUP,
      role: 'admin',
      label: 'Pixel 8',
      thisPhone: false,
      createdAt: '2026-09-25T00:00:00Z',
      createdBy: PHONE,
    })
    expect(mockVta.acl.get(BACKUP)).toMatchObject({ role: 'admin' })
  })

  it.each(['cancelled', 'failed', 'unavailable'] as const)(
    'an owner check that answers %s sends nothing and says why',
    async (reason) => {
      const confirmOwner = jest.fn(async () => ({ ok: false, reason }) as OwnerConfirmation)
      const { vta } = await linkedPhone({ confirmOwner })
      const failure = await vta.addBackupDevice(agent, BACKUP).catch((e: unknown) => e)
      expect(failure).toBeInstanceOf(OwnerNotConfirmed)
      expect((failure as OwnerNotConfirmed).reason).toBe(reason)
      expect(sentOf(ACL_GRANT)).toEqual([])
      expect(mockVta.acl.has(BACKUP)).toBe(false)
    }
  )

  it('an owner check that throws counts as failed, and sends nothing', async () => {
    const confirmOwner = jest.fn(async () => {
      throw new Error('keychain exploded')
    })
    const { vta } = await linkedPhone({ confirmOwner: confirmOwner as never })
    await expect(vta.addBackupDevice(agent, BACKUP)).rejects.toMatchObject({
      name: 'OwnerNotConfirmed',
      reason: 'failed',
    })
    expect(sentOf(ACL_GRANT)).toEqual([])
  })

  it('with no owner check configured, refuses loudly rather than skipping it', async () => {
    const { vta } = await linkedPhone({})
    await expect(vta.addBackupDevice(agent, BACKUP)).rejects.toBeInstanceOf(OwnerCheckNotConfigured)
    expect(sentOf(ACL_GRANT)).toEqual([])
  })

  it('lists each device with when it was added and by whom', async () => {
    const { vta } = await linkedPhone({ confirmOwner: confirmed() })
    const devices = await vta.listDevices(agent)
    expect(devices[0]).toMatchObject({ createdAt: '2026-09-25T00:00:00Z', createdBy: PHONE })
  })

  it('owner checks set by the app are used, and setting them keeps the rest of the wiring', async () => {
    const confirmOwner = confirmed()
    const { vta } = await linkedPhone({})
    // What the app does at start: only the owner checks, nothing else replaced.
    vta.setOwnerChecks({ confirmOwner, deviceCanOwn: async () => true })
    await vta.addBackupDevice(agent, BACKUP)
    expect(confirmOwner).toHaveBeenCalledTimes(1)
    expect(sentOf(ACL_GRANT)).toHaveLength(1)
  })

  it("refuses this phone's own code before asking the owner or the agent", async () => {
    const confirmOwner = confirmed()
    const { vta } = await linkedPhone({ confirmOwner })
    await expect(vta.addBackupDevice(agent, PHONE)).rejects.toMatchObject({
      name: 'DeviceActionRefused',
      reason: 'thisPhone',
    })
    expect(confirmOwner).not.toHaveBeenCalled()
    expect(mockVta.asked).toEqual([])
  })

  it.each(['', 'hello', ' did:peer:2.x', 'https://farm.example', 'did:'])(
    'refuses %p as not a device code, before asking anyone',
    async (input) => {
      const confirmOwner = confirmed()
      const { vta } = await linkedPhone({ confirmOwner })
      await expect(vta.addBackupDevice(agent, input)).rejects.toMatchObject({
        name: 'DeviceActionRefused',
        reason: 'notADid',
      })
      expect(confirmOwner).not.toHaveBeenCalled()
      expect(mockVta.asked).toEqual([])
    }
  )

  it('a device already on the agent reads as already added', async () => {
    mockVta.acl.set(BACKUP, { role: 'admin' })
    const { vta } = await linkedPhone()
    await expect(vta.addBackupDevice(agent, BACKUP)).rejects.toMatchObject({
      name: 'DeviceActionRefused',
      reason: 'alreadyAdded',
    })
  })

  it('an agent that will not let this phone add an owner reads as not permitted', async () => {
    mockVta.refuseNext.set(ACL_GRANT, {
      code: 'permissionDenied',
      message: 'forbidden: only super admin can create an unrestricted (super-admin) account',
    })
    const { vta } = await linkedPhone()
    const failure = (await vta.addBackupDevice(agent, BACKUP).catch((e: unknown) => e)) as DeviceActionRefused
    expect(failure).toBeInstanceOf(DeviceActionRefused)
    expect(failure.reason).toBe('notPermitted')
    // The VTA's own words stay available for Details.
    expect(failure.detail).toMatch(/only super admin/)
    // Plain words on the error itself: no DID, ACL or VTA jargon.
    expect(failure.message).not.toMatch(/ACL|VTA|DID|did:/)
  })

  it('an agent that no longer knows this phone reads as access revoked', async () => {
    const { vta } = await linkedPhone()
    mockVta.acl.delete(PHONE)
    await expect(vta.addBackupDevice(agent, BACKUP)).rejects.toMatchObject({ reason: 'accessRevoked' })
  })
})

describe('removing a device', () => {
  it('asks the owner first, then revokes the other device', async () => {
    mockVta.acl.set(BACKUP, { role: 'admin' })
    const confirmOwner = confirmed()
    const { vta } = await linkedPhone({ confirmOwner })
    await vta.removeDevice(agent, BACKUP)

    expect(mockVta.log[0]).toMatch(/^confirmOwner: /)
    expect(sentOf(ACL_REVOKE).map((a) => a.payload)).toEqual([{ subject: BACKUP }])
    expect(mockVta.acl.has(BACKUP)).toBe(false)
  })

  it('a cancelled owner check removes nothing', async () => {
    mockVta.acl.set(BACKUP, { role: 'admin' })
    const confirmOwner = jest.fn(async () => ({ ok: false, reason: 'cancelled' }) as OwnerConfirmation)
    const { vta } = await linkedPhone({ confirmOwner })
    await expect(vta.removeDevice(agent, BACKUP)).rejects.toMatchObject({
      name: 'OwnerNotConfirmed',
      reason: 'cancelled',
    })
    expect(sentOf(ACL_REVOKE)).toEqual([])
    expect(mockVta.acl.has(BACKUP)).toBe(true)
  })

  it('refuses to remove this phone before asking the owner or the agent', async () => {
    const confirmOwner = confirmed()
    const { vta } = await linkedPhone({ confirmOwner })
    const failure = (await vta.removeDevice(agent, PHONE).catch((e: unknown) => e)) as DeviceActionRefused
    expect(failure).toBeInstanceOf(DeviceActionRefused)
    expect(failure.reason).toBe('thisPhone')
    expect(confirmOwner).not.toHaveBeenCalled()
    expect(mockVta.asked).toEqual([])
  })

  it("the agent's own refusal to remove the caller reads as this phone", async () => {
    // The phone's record says it is PHONE, but it signs in as another of its
    // keys (a swap settled elsewhere): the agent is the one that notices.
    mockVta.acl.set(BACKUP, { role: 'admin' })
    const { vta } = await linkedPhone()
    mockVta.refuseNext.set(ACL_REVOKE, {
      code: 'taskFailed',
      message: 'conflict: cannot delete your own ACL entry',
      details: { reason: 'conflict' },
    })
    await expect(vta.removeDevice(agent, BACKUP)).rejects.toMatchObject({ reason: 'thisPhone' })
  })

  it('a device the agent does not hold reads as not found', async () => {
    const { vta } = await linkedPhone()
    await expect(vta.removeDevice(agent, 'did:peer:2.gone')).rejects.toMatchObject({ reason: 'notFound' })
  })
})

describe('an agent that asks for more than the owner check (policy gate)', () => {
  it('a re-authentication (step-up) rule is reported once, not retried', async () => {
    // policy_gate.rs:213-221 → step_up.rs:1300-1308: taskFailed with the reason
    // as its message and the approve request in details.
    mockVta.refuseNext.set(ACL_GRANT, {
      code: 'taskFailed',
      message: 'auth:step_up_required',
      details: { requiredAcr: 'aal2', approveRequest: { id: 'urn:uuid:x' } },
    })
    const { vta } = await linkedPhone()
    await expect(vta.addBackupDevice(agent, BACKUP)).rejects.toMatchObject({
      name: 'DeviceActionRefused',
      reason: 'stepUpRequired',
    })
    expect(sentOf(ACL_GRANT)).toHaveLength(1)
    expect(mockVta.acl.has(BACKUP)).toBe(false)
  })

  it('a consent rule is waited on, and the grant goes through once approved', async () => {
    mockClientOptions.consentWaitMs = 2000
    mockVta.consentFor.add(ACL_GRANT)
    const { vta } = await linkedPhone()
    const adding = vta.addBackupDevice(agent, BACKUP)
    await until(() => sentOf(ACL_GRANT).length >= 1)
    mockVta.consentGranted = true
    await expect(adding).resolves.toMatchObject({ did: BACKUP })
    expect(mockVta.acl.has(BACKUP)).toBe(true)
  })

  it('a consent that never comes reads as awaiting approval', async () => {
    mockClientOptions.consentWaitMs = 50
    mockVta.consentFor.add(ACL_REVOKE)
    mockVta.acl.set(BACKUP, { role: 'admin' })
    const { vta } = await linkedPhone()
    // The setup pins Date.now, and the consent wait's deadline is read from
    // it: a clock that moves on each reading lets the wait run out.
    const clock = Date.now as jest.Mock
    const pinned = Date.now()
    let tick = pinned
    clock.mockImplementation(() => (tick += 25))
    try {
      await expect(vta.removeDevice(agent, BACKUP)).rejects.toMatchObject({ reason: 'awaitingApproval' })
    } finally {
      clock.mockImplementation(() => pinned)
    }
    expect(mockVta.acl.has(BACKUP)).toBe(true)
  })
})

describe('creating an agent', () => {
  function freshPhone(owner: Owner) {
    const p = phone()
    const vta = new VtaAgentController()
    alive.push(vta)
    vta.configure({ linkStore: () => p.links, identityStore: () => p.identities as never, ...owner })
    return { vta, ...p }
  }

  it('refuses on a phone with no screen lock, and makes no key', async () => {
    const deviceCanOwn = jest.fn(async () => false)
    const { vta, disk } = freshPhone({ deviceCanOwn })
    await expect(vta.startCreateAgent(agent, VTA)).rejects.toBeInstanceOf(DeviceCannotOwn)
    expect(mockMinted).toEqual([])
    expect(disk.manager).toBeUndefined()
    expect(vta.getState().link.kind).toBe('notLinked')
  })

  it('with no screen-lock check configured, refuses loudly', async () => {
    const { vta } = freshPhone({})
    await expect(vta.startCreateAgent(agent, VTA)).rejects.toBeInstanceOf(OwnerCheckNotConfigured)
    expect(mockMinted).toEqual([])
  })

  it('shows the owner code through the manual link, and the finished link belongs to this phone', async () => {
    const { vta, disk } = freshPhone({ deviceCanOwn: jest.fn(async () => true) })
    await vta.startCreateAgent(agent, VTA, 'farm.example')
    expect(vta.getState().link).toMatchObject({ kind: 'showingKey', vtaDid: VTA, did: TEMPORARY })

    // The person pastes the code into the Farm's Admin DID box.
    mockVta.acl.set(TEMPORARY, { role: 'admin' })
    await vta.checkManualGrant(agent)

    expect(vta.getState().link).toMatchObject({ kind: 'linked', vtaDid: VTA })
    expect(disk.link).toMatchObject({ vtaDid: VTA, label: 'farm.example', owner: true })
    expect(vta.getState().ownsAgent).toBe(true)
    // Swapped onto the long-term key, as every link does.
    expect(mockVta.acl.has(PERMANENT)).toBe(true)
    expect(mockVta.acl.has(TEMPORARY)).toBe(false)
  })

  it('names its own access entry after the swap: "Keyring — <device name>"', async () => {
    const { vta } = freshPhone({ deviceCanOwn: jest.fn(async () => true) })
    vta.setDeviceName(() => 'Test phone')
    await vta.startCreateAgent(agent, VTA, 'farm.example')
    mockVta.acl.set(TEMPORARY, { role: 'admin' })
    await vta.checkManualGrant(agent)

    expect(vta.getState().link).toMatchObject({ kind: 'linked' })
    // The label goes out in the background, after the link is done.
    await labelSent()
    expect(sentOf(ACL_UPDATE).map((a) => a.payload)).toEqual([{ subject: PERMANENT, label: 'Keyring — Test phone' }])
    expect(mockVta.acl.get(PERMANENT)).toMatchObject({ label: 'Keyring — Test phone' })
  })

  it('a platform that answers "unknown" gives the plain "Keyring" label', async () => {
    const { vta } = freshPhone({ deviceCanOwn: jest.fn(async () => true) })
    vta.setDeviceName(() => 'unknown')
    await vta.startCreateAgent(agent, VTA, 'farm.example')
    mockVta.acl.set(TEMPORARY, { role: 'admin' })
    await vta.checkManualGrant(agent)
    await labelSent()
    expect(sentOf(ACL_UPDATE).map((a) => a.payload)).toEqual([{ subject: PERMANENT, label: 'Keyring' }])
  })

  it('without a device name the label is just "Keyring"; a refused relabel does not fail the link', async () => {
    mockVta.refuseUpdate = true
    const { vta } = freshPhone({ deviceCanOwn: jest.fn(async () => true) })
    await vta.startCreateAgent(agent, VTA, 'farm.example')
    mockVta.acl.set(TEMPORARY, { role: 'admin' })
    await vta.checkManualGrant(agent)

    await labelSent()
    expect(sentOf(ACL_UPDATE).map((a) => a.payload)).toEqual([{ subject: PERMANENT, label: 'Keyring' }])
    expect(vta.getState().link).toMatchObject({ kind: 'linked' })
  })

  it('a plain manual link is not marked as owned', async () => {
    const { vta, disk } = freshPhone({ deviceCanOwn: jest.fn(async () => true) })
    await vta.startManualLink(agent, VTA, 'farm.example')
    mockVta.acl.set(TEMPORARY, { role: 'admin' })
    await vta.checkManualGrant(agent)
    expect(vta.getState().link.kind).toBe('linked')
    expect(disk.link?.owner).toBeUndefined()
    expect(vta.getState().ownsAgent).toBeFalsy()
  })

  it('a create that is cancelled does not mark a later plain link as owned', async () => {
    const { vta, disk } = freshPhone({ deviceCanOwn: jest.fn(async () => true) })
    await vta.startCreateAgent(agent, VTA, 'farm.example')
    vta.cancelLink()
    mockMinted = []
    await vta.startManualLink(agent, VTA, 'farm.example')
    mockVta.acl.set(TEMPORARY, { role: 'admin' })
    await vta.checkManualGrant(agent)
    expect(disk.link?.owner).toBeUndefined()
  })

  it('the owned marker survives a restart', async () => {
    const { vta } = await linkedPhone()
    expect(vta.getState().ownsAgent).toBe(true)
  })
})
