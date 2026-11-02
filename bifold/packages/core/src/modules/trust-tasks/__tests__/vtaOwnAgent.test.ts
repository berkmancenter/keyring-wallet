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
const POLICY_GET = 'https://trusttasks.org/spec/policy/get/0.1'
const POLICY_UPSERT = 'https://trusttasks.org/spec/policy/upsert/0.2'
const CONTEXTS_CREATE = 'https://trusttasks.org/spec/vta/contexts/create/1.0'
const CONTEXTS_DELETE = 'https://trusttasks.org/spec/vta/contexts/delete/1.0'
const CONTEXTS_DELETE_11 = 'https://trusttasks.org/spec/vta/contexts/delete/1.1'
const DISCOVERY = 'https://trusttasks.org/spec/trust-task-discovery/0.3'
const VTA = 'did:webvh:QmFarm:farm.example:alice'
const PHONE = 'did:peer:2.phone'
const BACKUP = 'did:peer:2.backup'
const TEMPORARY = 'did:key:z6Mktemporary'
const PERMANENT = 'did:peer:2.permanent'
/** The Farm a claimed agent came from (the vta-claim code's `_from`). */
const FARM = 'did:webvh:QmHost:farm.example'

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
  /** Never answer these task types: a reply lost on the way. */
  silentFor: new Set<string>(),
  /** A session start that never finishes: an agent that cannot be reached (IN-53). */
  startHangs: false,
  /** Members a newer VTA might add to every list entry — ignored by the phone. */
  extraEntryMembers: {} as Record<string, unknown>,
  /** whoami's roles and scopes for every caller. */
  whoami: { roles: ['admin'] } as { roles: string[]; scopes?: string[] },
  /** The reserved `approvals` row, as vta-service keeps it (operations/policy.rs). */
  policy: undefined as { version: number; module: string; ext: Record<string, unknown> } | undefined,
  contexts: new Set<string>(),
  /** The contexts/delete versions this agent dispatches: only 1.0 before vta-service v0.67.0, only 1.1 from 61c23f20. */
  contextsDelete: [CONTEXTS_DELETE] as string[],
  /** trust-task-discovery/0.3's `supportedTypes`; undefined: discovery is not served. */
  discovery: undefined as string[] | undefined,
  /** Hold every task a consent rule in the approvals row names, by its exact type URI (policy_gate.rs, the Rego). */
  enforceRules: false,
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
      if (mockVta.startHangs) await new Promise(() => undefined)
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
      if (mockVta.silentFor.has(body.type)) return
      const injected = mockVta.refuseNext.get(body.type)
      if (injected) {
        mockVta.refuseNext.delete(body.type)
        refuse(injected)
        return
      }
      const ruled =
        mockVta.enforceRules &&
        ((mockVta.policy?.ext['openvtc.approvals'] ?? []) as { taskType: string; requires: string }[]).some(
          (rule) => rule.requires === 'consent' && rule.taskType === body.type
        )
      if ((mockVta.consentFor.has(body.type) || ruled) && !mockVta.consentGranted) {
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
          mockAnswer(this.record, `${WHOAMI}#response`, mockVta.whoami)
          return
        case POLICY_GET:
          // operations/policy.rs:129-144: NotFound → taskFailed, details.reason not_found.
          if (payload.id !== 'approvals' || !mockVta.policy) {
            refuse({
              code: 'taskFailed',
              message: `not found: policy \`${String(payload.id)}\` not found`,
              details: { reason: 'not_found' },
            })
            return
          }
          mockAnswer(this.record, `${POLICY_GET}#response`, {
            policy: { id: 'approvals', name: 'Declarative approvals', priority: 200, enabled: true, ...mockVta.policy },
          })
          return
        case POLICY_UPSERT: {
          // operations/policy.rs:152-251, in its order: super-admin, the
          // declarative row checked against its rules, then the version.
          if (!mockVta.whoami.roles.includes('admin') || mockVta.whoami.scopes?.length) {
            refuse({ code: 'permissionDenied', message: 'forbidden: super admin role required' })
            return
          }
          const { synthesizeRego, validateApprovals } = jest.requireActual('../module/approvalsPolicy')
          const ext = payload.ext as Record<string, unknown>
          try {
            validateApprovals(ext['openvtc.approvals'], ext['openvtc.approver-sets'])
          } catch (e) {
            refuse({ code: 'taskFailed', message: `validation error: ${(e as Error).message}` })
            return
          }
          if (payload.id !== 'approvals' || payload.module !== synthesizeRego(ext['openvtc.approvals'])) {
            refuse({
              code: 'taskFailed',
              message: 'validation error: the submitted `module` is not what ext synthesizes to',
            })
            return
          }
          const current = mockVta.policy?.version ?? 0
          if (payload.expectedVersion !== undefined && payload.expectedVersion !== current) {
            refuse({
              code: 'taskFailed',
              message: `conflict: policy \`approvals\` is at version ${current}, not the expected ${String(payload.expectedVersion)}`,
              details: { reason: 'conflict' },
            })
            return
          }
          mockVta.policy = { version: current + 1, module: String(payload.module), ext }
          mockAnswer(this.record, `${POLICY_UPSERT}#response`, {
            policy: { id: 'approvals', ...mockVta.policy },
            created: current === 0,
          })
          return
        }
        case CONTEXTS_CREATE:
          mockVta.contexts.add(String(payload.id))
          mockAnswer(this.record, `${CONTEXTS_CREATE}#response`, { id: payload.id, name: payload.name })
          return
        case CONTEXTS_DELETE:
        case CONTEXTS_DELETE_11:
          if (!mockVta.contextsDelete.includes(body.type)) {
            // helpers.rs method_not_found: the family is served, at another version.
            refuse({
              code: 'unsupportedVersion',
              message: `no handler for ${body.type}`,
              details: { servedVersions: mockVta.contextsDelete },
            })
            return
          }
          mockVta.contexts.delete(String(payload.id))
          mockAnswer(this.record, `${body.type}#response`, { id: payload.id, deleted: true })
          return
        case DISCOVERY:
          if (!mockVta.discovery) {
            refuse({ code: 'unsupportedType', message: `no handler for ${body.type}` })
            return
          }
          mockAnswer(this.record, `${DISCOVERY}#response`, { supportedTypes: mockVta.discovery })
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
          const entry = payload.entry as {
            subject: string
            role: string
            label?: string
            scopes?: string[]
            expiresAt?: string
          }
          // VTI-ACL-053 as the VTA words it, epoch seconds and all (vta-service operations/acl.rs:388-403).
          const callerExpiry = mockVta.acl.get(from)?.expiresAt
          if (callerExpiry) {
            const mine = Math.floor(Date.parse(callerExpiry) / 1000)
            const theirs = entry.expiresAt ? Math.floor(Date.parse(entry.expiresAt) / 1000) : undefined
            if (theirs === undefined || theirs > mine) {
              refuse({
                code: 'permissionDenied',
                message:
                  theirs === undefined
                    ? `your entry expires at ${mine}, so you cannot write a permanent one — give it an expiry no later than yours (VTI-ACL-053)`
                    : `this entry would expire at ${theirs}, after your own (${mine}) — an entry you write cannot outlive your authority (VTI-ACL-053)`,
              })
              return
            }
          }
          if (mockVta.acl.has(entry.subject)) {
            refuse({
              code: 'taskFailed',
              message: `conflict: ACL entry already exists for DID: ${entry.subject}`,
              details: { reason: 'conflict' },
            })
            return
          }
          mockVta.acl.set(entry.subject, {
            role: entry.role,
            scopes: entry.scopes,
            label: entry.label,
            ...(entry.expiresAt ? { expiresAt: entry.expiresAt } : {}),
          })
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
        case 'https://trusttasks.org/spec/device/set-wake/0.2':
          mockAnswer(this.record, `${body.type}#response`, { pushCapable: true })
          return
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

import { DeviceEventEmitter } from 'react-native'

import { hasOtaApplyBlockers, otaApplyBlockerReasons } from '../../../utils/otaApply'
import { VTI_PERSONA_KEYS_HELD_EVENT } from '../module/communityChanged'
import { VtaClient } from '../module/VtaClient'
import type { VtaLink } from '../module/VtaLinkStore'
import type { VtiManagerIdentity, VtiPersona } from '../module/VtiIdentityStore'
import { AgentAlreadyOnPhone, VtaAgentController } from '../module/vtaAgent'
import {
  DeviceActionRefused,
  DeviceCannotOwn,
  OwnerCheckNotConfigured,
  OwnerNotConfirmed,
  ownExpiryFromRefusal,
  type OwnerConfirmation,
} from '../module/vtaOwner'
import { VtiRefusal } from '../module/vtiAgent'

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
  mockVta.silentFor = new Set()
  mockVta.startHangs = false
  mockVta.extraEntryMembers = {}
  mockVta.whoami = { roles: ['admin'] }
  mockVta.policy = undefined
  mockVta.contexts = new Set()
  mockVta.contextsDelete = [CONTEXTS_DELETE]
  mockVta.discovery = undefined
  mockVta.enforceRules = false
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

  // IN-53 (226, a Farm-hosted agent): the session to the agent never came back,
  // and "Add as backup" spun for minutes with nothing listed. Past its deadline
  // the add gives up in words the screen already has ("didn't answer").
  it('gives up with "didn\'t answer" when the agent cannot be reached, instead of waiting forever', async () => {
    const { vta } = await linkedPhone({ confirmOwner: confirmed(), ownerActDeadlineMs: 50 } as never)
    for (const session of mockSessions) session.open = false
    mockVta.startHangs = true
    const failure = await vta.addBackupDevice(agent, BACKUP, 'Pixel 8').catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(DeviceActionRefused)
    expect((failure as DeviceActionRefused).reason).toBe('noAnswer')
    expect(sentOf(ACL_GRANT)).toEqual([])
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

// A phone whose own entry lapses may add a device only until then (VTI-ACL-053):
// a permanent grant was refused, and the person read "Your agent doesn't let this
// phone do that." The new device now gets this phone's own expiry.
describe('adding a device from a phone whose own access lapses', () => {
  const HOUR = '2026-10-22T13:00:00.000Z'
  const MONTH = '2026-11-21T12:00:00.000Z'
  const ownExpiry = (expiresAt: string) => mockVta.acl.set(PHONE, { role: 'admin', expiresAt })

  it.each([
    ['an hour', HOUR],
    ['a month', MONTH],
  ])('lapsing in %s: the device is added until the same moment, and says so', async (_, expiresAt) => {
    const { vta } = await linkedPhone()
    ownExpiry(expiresAt)
    const added = await vta.addBackupDevice(agent, BACKUP, 'Pixel 8')
    expect(sentOf(ACL_GRANT).map((a) => a.payload)).toEqual([
      { entry: { subject: BACKUP, role: 'admin', label: 'Pixel 8', expiresAt } },
    ])
    expect(added.expiresAt).toBe(expiresAt)
    expect(mockVta.acl.get(BACKUP)).toMatchObject({ role: 'admin', expiresAt })
  })

  it('a phone whose access never lapses still adds a permanent device', async () => {
    const { vta } = await linkedPhone()
    const added = await vta.addBackupDevice(agent, BACKUP, 'Pixel 8')
    expect(sentOf(ACL_GRANT).map((a) => (a.payload as { entry: object }).entry)).toEqual([
      { subject: BACKUP, role: 'admin', label: 'Pixel 8' },
    ])
    expect(added.expiresAt).toBeUndefined()
  })

  it("its own row unreadable: the agent's refusal names the expiry, and the grant goes once more with it", async () => {
    const { vta } = await linkedPhone()
    ownExpiry(HOUR)
    mockVta.refuseNext.set(ACL_LIST, { code: 'permissionDenied', message: 'forbidden: list unavailable' })
    const added = await vta.addBackupDevice(agent, BACKUP, 'Pixel 8')
    const grants = sentOf(ACL_GRANT).map((a) => (a.payload as { entry: { expiresAt?: string } }).entry.expiresAt)
    expect(grants).toEqual([undefined, HOUR])
    expect(added.expiresAt).toBe(HOUR)
  })

  it('a second refusal is said in plain words, and nothing is sent a third time', async () => {
    const { vta } = await linkedPhone()
    ownExpiry(HOUR)
    mockVta.refuseNext.set(ACL_LIST, { code: 'permissionDenied', message: 'forbidden: list unavailable' })
    // A refusal naming a later moment than this phone's own: the retry with it is refused as outliving it.
    const later = Math.floor(Date.parse(MONTH) / 1000)
    mockVta.refuseNext.set(ACL_GRANT, {
      code: 'permissionDenied',
      message: `your entry expires at ${later}, so you cannot write a permanent one — give it an expiry no later than yours (VTI-ACL-053)`,
    })
    const failure = (await vta.addBackupDevice(agent, BACKUP).catch((e: unknown) => e)) as DeviceActionRefused
    expect(failure).toBeInstanceOf(DeviceActionRefused)
    expect(failure.reason).toBe('beyondOwnAccess')
    expect(failure.message).not.toMatch(/ACL|VTA|DID|did:|053/)
    expect(sentOf(ACL_GRANT)).toHaveLength(2)
  })

  it('reads the expiry out of the refusal, and nothing out of any other', () => {
    const refusal = (message: string, code = 'permissionDenied') => new VtiRefusal(code as never, message)
    expect(
      ownExpiryFromRefusal(
        refusal(
          'your entry expires at 1792674000, so you cannot write a permanent one — give it an expiry no later than yours (VTI-ACL-053)'
        )
      )
    ).toBe(new Date(1792674000 * 1000).toISOString())
    expect(ownExpiryFromRefusal(refusal('forbidden: super admin role required'))).toBeUndefined()
    expect(
      ownExpiryFromRefusal(refusal('this entry would expire at 2, after your own (1) — (VTI-ACL-053)'))
    ).toBeUndefined()
    expect(
      ownExpiryFromRefusal(new Error('your entry expires at 1792674000, so you cannot write a permanent one'))
    ).toBeUndefined()
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

// IN-123: a computer (pnm) added to the agent is named, and renamed later,
// through its access-list label; the agent refuses a caller's own entry, so
// this phone keeps its own rename (device/register).
describe('renaming another device', () => {
  it('asks the owner first, then sets the label on that device only', async () => {
    mockVta.acl.set(BACKUP, { role: 'admin', label: 'Another device' })
    const confirmOwner = confirmed()
    const { vta } = await linkedPhone({ confirmOwner })
    const before = sentOf(ACL_UPDATE).length
    await vta.renameAgentDevice(agent, BACKUP, 'Work laptop (pnm)')

    expect(mockVta.log.some((l) => /^confirmOwner: Rename a device/.test(l))).toBe(true)
    const sent = sentOf(ACL_UPDATE)
      .slice(before)
      .map((a) => a.payload)
    expect(sent).toEqual([expect.objectContaining({ label: 'Work laptop (pnm)' })])
    expect(mockVta.acl.get(BACKUP)?.label).toBe('Work laptop (pnm)')
  })

  it('a cancelled owner check renames nothing', async () => {
    mockVta.acl.set(BACKUP, { role: 'admin', label: 'Another device' })
    const confirmOwner = jest.fn(async () => ({ ok: false, reason: 'cancelled' }) as OwnerConfirmation)
    const { vta } = await linkedPhone({ confirmOwner })
    await expect(vta.renameAgentDevice(agent, BACKUP, 'X')).rejects.toMatchObject({ name: 'OwnerNotConfirmed' })
    expect(mockVta.acl.get(BACKUP)?.label).toBe('Another device')
  })

  it('this phone is refused before the owner or the agent is asked', async () => {
    const confirmOwner = confirmed()
    const { vta } = await linkedPhone({ confirmOwner })
    await expect(vta.renameAgentDevice(agent, PHONE, 'X')).rejects.toMatchObject({ reason: 'thisPhone' })
    expect(confirmOwner).not.toHaveBeenCalled()
  })
})

// IN-124: My devices spun forever. Reading the list signs in through
// connect, which shares a sign-in already in flight and has no deadline of
// its own; one stuck sign-in held the list for good.
describe('reading the device list', () => {
  it('a sign-in that never finishes is "no answer" at the deadline, not a wait for ever', async () => {
    const { vta } = await linkedPhone({ confirmOwner: confirmed(), deviceListDeadlineMs: 50 } as never)
    jest
      .spyOn(vta as unknown as { connect: () => Promise<void> }, 'connect')
      .mockReturnValue(new Promise(() => undefined))
    await expect(vta.agentDevices(agent)).rejects.toMatchObject({ name: 'DeviceActionRefused', reason: 'noAnswer' })
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

  it('a task waiting on consent holds the OTA apply blocker until it ends', async () => {
    mockClientOptions.consentWaitMs = 2000
    mockVta.consentFor.add(ACL_GRANT)
    const { vta } = await linkedPhone()
    const adding = vta.addBackupDevice(agent, BACKUP)
    // Past the first refusal: the wait for the grant and its re-submit run
    // outside the first send, and a reload there would lose them.
    await until(() => sentOf(ACL_GRANT).length >= 2)
    expect(hasOtaApplyBlockers()).toBe(true)
    expect(otaApplyBlockerReasons()).toContain(`vta-task:${ACL_GRANT}`)
    mockVta.consentGranted = true
    await adding
    expect(otaApplyBlockerReasons()).not.toContain(`vta-task:${ACL_GRANT}`)
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

  // IN-200: an agent refuses any change to the caller's own entry
  // (VTI-ACL-052). The phone no longer tries; the entry keeps its grant's label.
  it('does not try to label its own access entry after the swap', async () => {
    const { vta } = freshPhone({ deviceCanOwn: jest.fn(async () => true) })
    await vta.startCreateAgent(agent, VTA, 'farm.example')
    mockVta.acl.set(TEMPORARY, { role: 'admin', label: 'mobile integration' })
    await vta.checkManualGrant(agent)
    expect(vta.getState().link).toMatchObject({ kind: 'linked' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(sentOf(ACL_UPDATE)).toEqual([])
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

  // One-scan setup (vta-claim): the host handed the agent over to the key the
  // phone claimed with, so there is no code to paste; the rest is the manual
  // link's own finish, owned, and swapped onto the long-term key.
  it("a claimed agent links as this phone's own, with the key it claimed with", async () => {
    const { vta, disk } = freshPhone({ deviceCanOwn: jest.fn(async () => true) })
    const key = await vta.createClaimKey(agent)
    expect(key).toBe(TEMPORARY)
    mockVta.acl.set(TEMPORARY, { role: 'admin' })
    await vta.finishClaimedLink(agent, VTA, key)
    expect(vta.getState().link).toMatchObject({ kind: 'linked', vtaDid: VTA })
    expect(disk.link).toMatchObject({ vtaDid: VTA, owner: true })
    expect(vta.getState().ownsAgent).toBe(true)
    expect(mockVta.acl.has(PERMANENT)).toBe(true)
    expect(mockVta.acl.has(TEMPORARY)).toBe(false)
  })

  // IN-388: the Farm signs the person in by the key the agent was claimed with (vtafarm-api c437bfbb, the
  // binding is `mobile_connections.admin_did`), not by the long-term key the phone swaps onto.
  it('a claimed agent keeps its Farm and claim key after the swap onto the long-term key, and the key is not deleted', async () => {
    const { vta, disk } = freshPhone({ deviceCanOwn: jest.fn(async () => true) })
    const deleteKey = jest.fn()
    const withKms = { ...(agent as object), kms: { deleteKey } } as never
    const key = await vta.createClaimKey(withKms)
    mockVta.acl.set(TEMPORARY, { role: 'admin' })
    await vta.finishClaimedLink(withKms, VTA, key, FARM)
    expect(vta.getState().link).toMatchObject({ kind: 'linked', vtaDid: VTA })
    // Swapped: the agent knows the long-term key only, and the phone acts as it.
    expect(mockVta.acl.has(PERMANENT)).toBe(true)
    expect(mockVta.acl.has(TEMPORARY)).toBe(false)
    expect(disk.manager?.did).toBe(PERMANENT)
    expect(disk.link?.farmLogin).toEqual({ farmDid: FARM, did: TEMPORARY })
    expect(deleteKey).not.toHaveBeenCalled()
  })

  it('a claimed agent that takes its key only later still keeps its Farm', async () => {
    const { vta, disk } = freshPhone({ deviceCanOwn: jest.fn(async () => true) })
    const key = await vta.createClaimKey(agent)
    await vta.finishClaimedLink(agent, VTA, key, FARM)
    expect(vta.getState().link).toMatchObject({ kind: 'showingKey', vtaDid: VTA, did: TEMPORARY })
    mockVta.acl.set(TEMPORARY, { role: 'admin' })
    await vta.checkManualGrant(agent)
    expect(vta.getState().link).toMatchObject({ kind: 'linked', vtaDid: VTA })
    expect(disk.link?.farmLogin).toEqual({ farmDid: FARM, did: TEMPORARY })
  })

  // A guard: on main nothing records a Farm at all, so this passes there too.
  it('a claim given up records no Farm on a later link of the same agent made with another key', async () => {
    const { vta, disk } = freshPhone({ deviceCanOwn: jest.fn(async () => true) })
    // Restored, as in the app: a cancel then forgets the key given up (IN-135), and the next link makes a new one.
    await vta.restore(agent)
    await vta.finishClaimedLink(agent, VTA, 'did:key:z6MkClaimedThenGivenUp', FARM)
    expect(vta.getState().link).toMatchObject({ kind: 'showingKey', vtaDid: VTA })
    vta.cancelLink()
    await until(() => vta.getState().link.kind === 'notLinked' && disk.manager === undefined)
    mockMinted = []
    await vta.startManualLink(agent, VTA, 'farm.example')
    mockVta.acl.set(TEMPORARY, { role: 'admin' })
    await vta.checkManualGrant(agent)
    expect(vta.getState().link).toMatchObject({ kind: 'linked', vtaDid: VTA })
    expect(disk.link?.farmLogin).toBeUndefined()
  })

  // A swap the agent never makes undoes the link, Farm and all, and keeps the claim key for a Try again (IN-135).
  // The Farm still knows that key, so the link a Try again makes must know its Farm too.
  it('a claim whose swap is refused, tried again with the same key, keeps its Farm', async () => {
    const deviceCanOwn = jest.fn(async () => true)
    const { vta, disk } = freshPhone({ deviceCanOwn })
    const key = await vta.createClaimKey(agent)
    mockVta.acl.set(TEMPORARY, { role: 'admin' })
    mockVta.refuseNext.set(SWAP, { code: 'permissionDenied', message: 'forbidden: super admin role required' })
    await vta.finishClaimedLink(agent, VTA, key, FARM)
    await until(() => vta.getState().link.kind === 'notLinked')
    expect(disk.link).toBeUndefined()
    expect(await vta.pendingLinkKey(agent, VTA)).toMatchObject({ did: TEMPORARY })
    await vta.startManualLink(agent, VTA, 'farm.example')
    await vta.checkManualGrant(agent)
    expect(vta.getState().link).toMatchObject({ kind: 'linked', vtaDid: VTA })
    expect(disk.link?.farmLogin).toEqual({ farmDid: FARM, did: TEMPORARY })
  })

  it('the same after the app restarts between the refused swap and the Try again', async () => {
    const deviceCanOwn = jest.fn(async () => true)
    const { vta, disk, links, identities } = freshPhone({ deviceCanOwn })
    const key = await vta.createClaimKey(agent)
    mockVta.acl.set(TEMPORARY, { role: 'admin' })
    mockVta.refuseNext.set(SWAP, { code: 'permissionDenied', message: 'forbidden: super admin role required' })
    await vta.finishClaimedLink(agent, VTA, key, FARM)
    await until(() => vta.getState().link.kind === 'notLinked')
    const restarted = new VtaAgentController()
    alive.push(restarted)
    restarted.configure({ linkStore: () => links, identityStore: () => identities as never, deviceCanOwn })
    await restarted.startManualLink(agent, VTA, 'farm.example')
    await restarted.checkManualGrant(agent)
    expect(restarted.getState().link).toMatchObject({ kind: 'linked', vtaDid: VTA })
    expect(disk.link?.farmLogin).toEqual({ farmDid: FARM, did: TEMPORARY })
  })

  it("the Farm sign-in key stays on the link through the link's later writes", async () => {
    const farmLogin = { farmDid: FARM, did: TEMPORARY }
    const p = phone({
      manager: linkedManager,
      link: { vtaDid: VTA, label: 'farm.example', linkedAt: 'x', owner: true, farmLogin },
    })
    const vta = new VtaAgentController()
    alive.push(vta)
    vta.configure({ linkStore: () => p.links, identityStore: () => p.identities as never })
    await vta.restore(agent)
    await until(() => p.disk.link?.lastOnlineAt !== undefined)
    await vta.nameAgent(agent, VTA, 'Home agent')
    expect(p.disk.link).toMatchObject({ nickname: 'Home agent', farmLogin })
  })

  it('a claimed agent that has not taken the key yet waits on it, and a later check finishes', async () => {
    const { vta } = freshPhone({ deviceCanOwn: jest.fn(async () => true) })
    const key = await vta.createClaimKey(agent)
    await vta.finishClaimedLink(agent, VTA, key)
    expect(vta.getState().link).toMatchObject({ kind: 'showingKey', vtaDid: VTA, did: TEMPORARY })
    mockVta.acl.set(TEMPORARY, { role: 'admin' })
    await vta.checkManualGrant(agent)
    expect(vta.getState().link).toMatchObject({ kind: 'linked', vtaDid: VTA })
  })

  it('a claimed agent this phone already has is refused', async () => {
    const { vta } = await linkedPhone()
    await expect(vta.finishClaimedLink(agent, VTA, 'did:key:z6MkOther')).rejects.toBeInstanceOf(AgentAlreadyOnPhone)
  })

  it('the owned marker survives a restart', async () => {
    const { vta } = await linkedPhone()
    expect(vta.getState().ownsAgent).toBe(true)
  })
})

describe('a link whose swap onto the long-term key does not happen says why', () => {
  async function linkByHand() {
    const p = phone()
    const vta = new VtaAgentController()
    alive.push(vta)
    vta.configure({ linkStore: () => p.links, identityStore: () => p.identities as never })
    await vta.startManualLink(agent, VTA, 'farm.example')
    mockVta.acl.set(TEMPORARY, { role: 'admin' })
    await vta.checkManualGrant(agent).catch(() => undefined)
    return { vta, ...p }
  }
  const failure = (vta: VtaAgentController) => {
    const link = vta.getState().link
    return link.kind === 'notLinked' ? link.lastError : undefined
  }

  it('held by an approval rule: the failure says so, and the agent kept the first key', async () => {
    // #287's device check, Run A: a consent rule held the swap until the wait ran out.
    mockClientOptions.consentWaitMs = 50
    mockVta.consentFor.add(SWAP)
    // The setup pins Date.now, and the consent wait's deadline is read from it.
    const clock = Date.now as jest.Mock
    const pinned = Date.now()
    let tick = pinned
    clock.mockImplementation(() => (tick += 25))
    let linked: Awaited<ReturnType<typeof linkByHand>>
    try {
      linked = await linkByHand()
    } finally {
      clock.mockImplementation(() => pinned)
    }
    const { vta, disk } = linked
    expect(failure(vta)).toMatchObject({ reason: 'failed', swap: 'held' })
    // UX-240-a: the wait for an approval is over, held or not.
    expect(vta.getState().awaitingConsentFor).toBeUndefined()
    expect(mockVta.acl.has(TEMPORARY)).toBe(true)
    expect(disk.link).toBeUndefined()
    // 239 gate (linkfail, swap held): the agent stayed on the phone's list
    // after the link was undone, so it read as linked: no key to try again
    // with, and a scan of it said "already on this phone".
    expect((vta.getState().agents ?? []).map((a) => a.vtaDid)).not.toContain(VTA)
    expect(vta.hasAgent(VTA)).toBe(false)
    expect(await vta.pendingLinkKey(agent, VTA)).toMatchObject({ vtaDid: VTA, did: TEMPORARY })
  })

  it('refused: the failure says the agent refused', async () => {
    mockVta.refuseNext.set(SWAP, { code: 'permissionDenied', message: 'forbidden: super admin role required' })
    const { vta } = await linkByHand()
    expect(failure(vta)).toMatchObject({ reason: 'failed', swap: 'refused' })
    expect(mockVta.acl.has(TEMPORARY)).toBe(true)
  })

  it('not answered, and the agent then confirms it kept the first key: the failure says no answer', async () => {
    mockClientOptions.swapTimeoutMs = 50
    mockVta.silentFor.add(SWAP)
    const { vta } = await linkByHand()
    expect(failure(vta)).toMatchObject({ reason: 'failed', swap: 'noAnswer' })
    expect(mockVta.acl.has(TEMPORARY)).toBe(true)
  })

  it('a link that fails some other way carries no swap reason', async () => {
    const p = phone()
    const vta = new VtaAgentController()
    alive.push(vta)
    vta.configure({ linkStore: () => p.links, identityStore: () => p.identities as never })
    await vta.startManualLink(agent, VTA, 'farm.example')
    mockVta.acl.set(TEMPORARY, { role: 'admin' })
    mockVta.refuseNext.set(WHOAMI, { code: 'taskFailed', message: 'something new' })
    await vta.checkManualGrant(agent).catch(() => undefined)
    expect(failure(vta)?.swap).toBeUndefined()
  })
})

describe("an identity's key copy used before any session fetched it (TestFlight 239)", () => {
  const OTHER = 'did:webvh:QmFarm:farm.example:bob'
  const persona = (vtaDid: string, name: string): VtiPersona =>
    ({
      vtaDid,
      did: `did:webvh:QmP:dids.example:${name}`,
      communityDid: `did:webvh:QmC:community-${name}`,
      vtaKeyIds: {
        signing: `did:webvh:QmP:dids.example:${name}#key-0`,
        keyAgreement: `did:webvh:QmP:dids.example:${name}#key-1`,
      },
      kmsKeyIds: {
        signing: `vta-copy:${vtaDid}:did:webvh:QmP:dids.example:${name}#key-0`,
        keyAgreement: `vta-copy:${vtaDid}:did:webvh:QmP:dids.example:${name}#key-1`,
      },
    }) as unknown as VtiPersona

  /** A phone linked to VTA (current) and OTHER, holding the given identities, on an agent with an in-memory backend. */
  async function restartedPhone(personas: VtiPersona[], { waitOnline = true } = {}) {
    const p = phone({
      manager: linkedManager,
      link: { vtaDid: VTA, label: 'farm.example', linkedAt: 'x', owner: true },
    })
    const links = {
      ...p.links,
      list: async () => [
        { vtaDid: VTA, label: 'farm.example', linkedAt: 'x' },
        { vtaDid: OTHER, label: 'bob', linkedAt: 'y' },
      ],
    }
    const identities = { ...p.identities, listPersonas: jest.fn(async () => personas) }
    let fetcher: ((keyId: string) => Promise<void>) | undefined
    const backend = { backend: 'ephemeral', setMissingKeyFetcher: (f: typeof fetcher) => (fetcher = f) }
    const kmsAgent = {
      ...(agent as object),
      dependencyManager: { resolve: () => ({ backends: [{ backend: 'askar' }, backend] }) },
    } as never
    const other = { holdPersonaKeys: jest.fn(async () => true), disconnect: jest.fn(async () => undefined) }
    const keyClient = jest.fn(() => other)
    const vta = new VtaAgentController()
    alive.push(vta)
    vta.configure({ linkStore: () => links as never, identityStore: () => identities as never, keyClient } as never)
    await vta.restore(kmsAgent)
    if (waitOnline) {
      await until(() => {
        const link = vta.getState().link
        return link.kind === 'linked' && link.connection.kind === 'online'
      })
    }
    return {
      vta,
      fetch: (keyId: string) => (fetcher as NonNullable<typeof fetcher>)(keyId),
      keyClient,
      other,
      hasFetcher: () => Boolean(fetcher),
    }
  }

  it('the app registers the fetcher with the in-memory backend when it hands over its agent', async () => {
    const { hasFetcher } = await restartedPhone([])
    expect(hasFetcher()).toBe(true)
  })

  it("a persona under a non-current agent, after a restart: fetched through that agent's own short session", async () => {
    const tiger = persona(OTHER, 'tiger-silver')
    const held = jest.spyOn(VtaClient.prototype, 'holdPersonaKeys')
    const { fetch, keyClient, other } = await restartedPhone([tiger])
    const announced: unknown[] = []
    const sub = DeviceEventEmitter.addListener(VTI_PERSONA_KEYS_HELD_EVENT, (e) => announced.push(e))
    await fetch(tiger.kmsKeyIds?.keyAgreement as string)
    sub.remove()
    // Its inbox looks again at once, rather than at its next 30 s look.
    expect(announced).toEqual([{ did: tiger.did }])
    expect(keyClient).toHaveBeenCalledTimes(1)
    expect((keyClient.mock.calls[0] as unknown[])[1]).toBe(OTHER)
    expect(other.holdPersonaKeys).toHaveBeenCalledWith(tiger)
    expect(other.disconnect).toHaveBeenCalledTimes(1)
    // Not on the current agent's session: that agent does not hold this identity's keys.
    expect(held).not.toHaveBeenCalled()
    held.mockRestore()
  })

  it("used straight after a restart: waits for the current agent's session, then fetches on it", async () => {
    const mine = persona(VTA, 'mine')
    const held = jest.spyOn(VtaClient.prototype, 'holdPersonaKeys').mockResolvedValue(true)
    const { vta, fetch, keyClient } = await restartedPhone([mine], { waitOnline: false })
    const before = vta.getState().link
    // Asked for before the session that fetches the keys has opened.
    expect(before.kind === 'linked' && before.connection.kind).not.toBe('online')
    const fetching = fetch(mine.kmsKeyIds?.signing as string)
    await fetching
    const link = vta.getState().link
    expect(link.kind === 'linked' && link.connection.kind).toBe('online')
    expect(held).toHaveBeenCalledWith(mine)
    expect(keyClient).not.toHaveBeenCalled()
    held.mockRestore()
  })

  it('an identity of the agent being linked right now waits for that link, never a second session as the same key', async () => {
    // A relink of an agent whose identities this phone still holds: the link
    // signs in as this phone's manager key, and a side session beside it would
    // be the same DID twice at the mediator.
    const p = phone()
    // finishLink keeps the link before it swaps keys, so for that while the
    // agent is on the list and the link is still in progress.
    const listed: { vtaDid: string; label: string; linkedAt: string }[] = []
    const links = { ...p.links, list: async () => listed }
    const tiger = persona(OTHER, 'tiger-silver')
    const identities = { ...p.identities, listPersonas: jest.fn(async () => [tiger]) }
    let fetcher: ((keyId: string) => Promise<void>) | undefined
    const backend = { backend: 'ephemeral', setMissingKeyFetcher: (f: typeof fetcher) => (fetcher = f) }
    const kmsAgent = {
      ...(agent as object),
      dependencyManager: { resolve: () => ({ backends: [backend] }) },
    } as never
    const keyClient = jest.fn(() => ({
      holdPersonaKeys: jest.fn(async () => true),
      disconnect: jest.fn(async () => undefined),
    }))
    const vta = new VtaAgentController()
    alive.push(vta)
    vta.configure({
      linkStore: () => links as never,
      identityStore: () => identities as never,
      keyClient,
      keyFetchWaitMs: 300,
    } as never)
    await vta.restore(kmsAgent)
    await vta.startManualLink(kmsAgent, OTHER, 'bob')
    expect(vta.getState().link).toMatchObject({ kind: 'showingKey', vtaDid: OTHER })
    listed.push({ vtaDid: OTHER, label: 'bob', linkedAt: 'y' })
    await expect((fetcher as NonNullable<typeof fetcher>)(tiger.kmsKeyIds?.signing as string)).rejects.toThrow(
      /did not come online/
    )
    expect(keyClient).not.toHaveBeenCalled()
  })

  it('installed before the link is read (#422, a sign-in at start-up): the fetch waits for it, and asks the current agent on its own session', async () => {
    const mine = persona(VTA, 'mine')
    const held = jest.spyOn(VtaClient.prototype, 'holdPersonaKeys').mockResolvedValue(true)
    const p = phone({
      manager: linkedManager,
      link: { vtaDid: VTA, label: 'farm.example', linkedAt: 'x', owner: true },
    })
    const links = { ...p.links, list: async () => [{ vtaDid: VTA, label: 'farm.example', linkedAt: 'x' }] }
    const identities = { ...p.identities, listPersonas: jest.fn(async () => [mine]) }
    let fetcher: ((keyId: string) => Promise<void>) | undefined
    const backend = { backend: 'ephemeral', setMissingKeyFetcher: (f: typeof fetcher) => (fetcher = f) }
    const kmsAgent = {
      ...(agent as object),
      dependencyManager: { resolve: () => ({ backends: [{ backend: 'askar' }, backend] }) },
    } as never
    const keyClient = jest.fn(() => ({
      holdPersonaKeys: jest.fn(async () => true),
      disconnect: jest.fn(async () => undefined),
    }))
    const vta = new VtaAgentController()
    alive.push(vta)
    vta.configure({ linkStore: () => links as never, identityStore: () => identities as never, keyClient } as never)

    // The persona inbox's order on a fresh install: the fetcher first, the restore after.
    vta.installKeyFetcher(kmsAgent)
    expect(fetcher).toBeDefined()
    const fetching = (fetcher as NonNullable<typeof fetcher>)(mine.kmsKeyIds?.keyAgreement as string)
    await vta.restore(kmsAgent)
    await fetching
    // The current agent, on the session the restore opens; never taken for
    // "another linked agent" and asked on a second session as the same key.
    expect(keyClient).not.toHaveBeenCalled()
    expect(held).toHaveBeenCalledWith(mine)
    held.mockRestore()
  })

  it('installing the fetcher again for the same agent changes nothing; refetchPersonaKeys asks for the persona key now', async () => {
    const mine = persona(VTA, 'mine')
    const held = jest.spyOn(VtaClient.prototype, 'holdPersonaKeys').mockResolvedValue(true)
    const { vta } = await restartedPhone([mine])
    vta.installKeyFetcher(agent as never)
    await vta.refetchPersonaKeys(agent as never, mine)
    expect(held).toHaveBeenCalledWith(mine)
    held.mockRestore()
  })

  it('a fetch asked for when the link is never read says so, rather than guessing the agent', async () => {
    const vta = new VtaAgentController()
    alive.push(vta)
    vta.configure({ keyFetchWaitMs: 300 } as never)
    let fetcher: ((keyId: string) => Promise<void>) | undefined
    const backend = { backend: 'ephemeral', setMissingKeyFetcher: (f: typeof fetcher) => (fetcher = f) }
    vta.installKeyFetcher({
      ...(agent as object),
      dependencyManager: { resolve: () => ({ backends: [backend] }) },
    } as never)
    await expect((fetcher as NonNullable<typeof fetcher>)('vta-copy:x:y#key-1')).rejects.toThrow(/was not read within/)
  })

  it('a key no identity on this phone names is refused, not guessed at', async () => {
    const { fetch, keyClient } = await restartedPhone([persona(OTHER, 'tiger-silver')])
    await expect(fetch('vta-copy:did:webvh:nobody:did:webvh:x#key-1')).rejects.toThrow(
      /no identity on this phone names/
    )
    expect(keyClient).not.toHaveBeenCalled()
  })

  it('an identity whose agent is no longer linked is refused', async () => {
    const gone = persona('did:webvh:QmFarm:farm.example:carol', 'gone')
    const { fetch, keyClient } = await restartedPhone([gone])
    await expect(fetch(gone.kmsKeyIds?.signing as string)).rejects.toThrow(/no longer linked/)
    expect(keyClient).not.toHaveBeenCalled()
  })
})

describe("Settings → Notifications when an approval rule holds this phone's set-wake", () => {
  const SET_WAKE = 'https://trusttasks.org/spec/device/set-wake/0.2'
  const WAKE = { gateway: 'did:web:gateway.example', handle: 'zHandle' }

  it('is refused at once, never waited on, and the agent state says a rule is blocking it', async () => {
    mockClientOptions.consentWaitMs = 60000
    mockVta.consentFor.add(SET_WAKE)
    const { vta } = await linkedPhone()
    mockVta.asked = []
    const started = Date.now()
    await expect(vta.setThisDeviceWake(agent, WAKE)).rejects.toMatchObject({ reason: 'awaitingApproval' })
    // A 60 s consent wait was not entered: one send, answered at once.
    expect(Date.now() - started).toBeLessThan(5000)
    expect(sentOf(SET_WAKE)).toHaveLength(1)
    expect(vta.getState().wakeBlockedByRule).toBe(true)
  })

  it('clearing the wake channel is refused at once too', async () => {
    mockClientOptions.consentWaitMs = 60000
    mockVta.consentFor.add(SET_WAKE)
    const { vta } = await linkedPhone()
    await expect(vta.clearThisDeviceWake(agent)).rejects.toMatchObject({ reason: 'awaitingApproval' })
    expect(vta.getState().wakeBlockedByRule).toBe(true)
  })

  it('once the rule no longer holds it, the next set-wake clears the warning', async () => {
    mockVta.consentFor.add(SET_WAKE)
    const { vta } = await linkedPhone()
    await expect(vta.setThisDeviceWake(agent, WAKE)).rejects.toBeTruthy()
    mockVta.consentFor.delete(SET_WAKE)
    await expect(vta.setThisDeviceWake(agent, WAKE)).resolves.toMatchObject({ pushCapable: true })
    expect(vta.getState().wakeBlockedByRule).toBe(false)
  })
})

describe('VtaClient: approval rules follow a key swap', () => {
  const OLD = 'did:key:z6MkRetiredLinkingKey'
  const CREATE = CONTEXTS_CREATE
  const OLD_SET = `keyring-phone:${OLD}`
  const NEW_SET = `keyring-phone:${PHONE}`
  const rule = (set: string) => ({
    taskType: CREATE,
    requires: 'consent',
    approverSet: set,
    minApprovals: 1,
    excludeRequester: false,
  })
  async function afterSwap(record: Partial<VtiManagerIdentity> = { approversFrom: OLD }) {
    let held: VtiManagerIdentity = { ...linkedManager, ...record }
    const store = {
      getManager: jest.fn(async () => held),
      setManager: jest.fn(async (m: VtiManagerIdentity) => void (held = m)),
    }
    const client = new VtaClient(agent, VTA, store as never, { connectDrainMs: 0 })
    await client.connect()
    mockVta.asked = []
    return { client, record: () => held }
  }
  const seed = (version: number) => {
    mockVta.policy = {
      version,
      module: 'before',
      ext: { 'openvtc.approvals': [rule(OLD_SET)], 'openvtc.approver-sets': { [OLD_SET]: [OLD] } },
    }
  }

  it('moves the rules onto the new key, written against the version read, then forgets the old key', async () => {
    seed(3)
    const { client, record } = await afterSwap()
    expect(await client.carryApproversAcrossSwap()).toBe('moved')
    expect(sentOf(POLICY_UPSERT)[0].payload).toMatchObject({ id: 'approvals', expectedVersion: 3 })
    expect(mockVta.policy?.ext['openvtc.approvals']).toEqual([rule(NEW_SET)])
    expect(mockVta.policy?.ext['openvtc.approver-sets']).toEqual({ [NEW_SET]: [PHONE] })
    expect(record().approversFrom).toBeUndefined()
    // Done once: the next session sends nothing.
    mockVta.asked = []
    expect(await client.carryApproversAcrossSwap()).toBe('none')
    expect(sentOf(POLICY_UPSERT)).toEqual([])
    await client.disconnect()
  })

  it('no rule names the old key: nothing is written, and the old key is forgotten', async () => {
    const { client, record } = await afterSwap()
    expect(await client.carryApproversAcrossSwap()).toBe('unchanged')
    expect(sentOf(POLICY_UPSERT)).toEqual([])
    expect(record().approversFrom).toBeUndefined()
    await client.disconnect()
  })

  it('a phone that may not change the rules hears so once, and stops asking', async () => {
    seed(2)
    mockVta.whoami = { ...mockVta.whoami, scopes: ['some-context'] }
    const { client, record } = await afterSwap()
    expect(await client.carryApproversAcrossSwap()).toBe('notAllowed')
    expect(mockVta.policy?.ext['openvtc.approvals']).toEqual([rule(OLD_SET)])
    expect(record().approversFrom).toBeUndefined()
    await client.disconnect()
  })

  it('no swap pending: asks nothing', async () => {
    seed(1)
    const { client } = await afterSwap({})
    expect(await client.carryApproversAcrossSwap()).toBe('none')
    expect(sentOf(POLICY_GET)).toEqual([])
    await client.disconnect()
  })
})

describe('"Ask me before…": the agent\'s approval rules', () => {
  const CREATE = CONTEXTS_CREATE
  const REVOKE_KEY = 'https://trusttasks.org/spec/keys/revoke/0.1'
  const MINE = `keyring-phone:${PHONE}`
  const rulesHeld = () => mockVta.policy?.ext['openvtc.approvals']

  it('an agent with no rules yet: nothing on, and this phone may change them', async () => {
    const { vta } = await linkedPhone()
    const state = await vta.approvalRules(agent)
    expect(state.canChange).toBe(true)
    expect(state.model.version).toBe(0)
    expect(state.view.offered.every((o) => !o.on)).toBe(true)
  })

  it('switching one on: the owner check, then the row written against the version read', async () => {
    const { vta } = await linkedPhone()
    const state = await vta.setApprovalRule(agent, CREATE, true)
    expect(mockVta.log[0]).toBe('confirmOwner: Change what your agent asks you about')
    const [upsert] = sentOf(POLICY_UPSERT)
    expect(upsert.payload).toMatchObject({
      id: 'approvals',
      name: 'Declarative approvals',
      priority: 200,
      enabled: true,
      expectedVersion: 0,
    })
    expect(rulesHeld()).toEqual([
      { taskType: CREATE, requires: 'consent', approverSet: MINE, minApprovals: 1, excludeRequester: false },
    ])
    expect(mockVta.policy?.ext['openvtc.approver-sets']).toEqual({ [MINE]: [PHONE] })
    expect(state.view.offered.find((o) => o.taskType === CREATE)?.on).toBe(true)
    expect(state.model.version).toBe(1)
  })

  it('rules set elsewhere are kept, and a rule on a task this phone sends is flagged', async () => {
    const SET_WAKE = 'https://trusttasks.org/spec/device/set-wake/0.2'
    const others = [{ taskType: SET_WAKE, requires: 'consent', approverSet: 'ops', excludeRequester: true }]
    mockVta.policy = {
      version: 4,
      module: 'elsewhere',
      ext: { 'openvtc.approvals': others, 'openvtc.approver-sets': { ops: ['did:key:z6MkOps'] } },
    }
    const { vta } = await linkedPhone()
    expect((await vta.approvalRules(agent)).view.elsewhere).toMatchObject([{ holdsThisPhone: true }])
    await vta.setApprovalRule(agent, REVOKE_KEY, true)
    expect(rulesHeld()).toEqual([others[0], expect.objectContaining({ taskType: REVOKE_KEY, approverSet: MINE })])
    expect(mockVta.policy?.ext['openvtc.approver-sets']).toEqual({ ops: ['did:key:z6MkOps'], [MINE]: [PHONE] })
    await vta.setApprovalRule(agent, REVOKE_KEY, false)
    expect(rulesHeld()).toEqual(others)
    expect(mockVta.policy?.ext['openvtc.approver-sets']).toEqual({ ops: ['did:key:z6MkOps'] })
  })

  it('a row changed in between is read again and the change applied to it', async () => {
    const { vta } = await linkedPhone()
    // Another device writes between this phone's read and its write.
    mockVta.refuseNext.set(POLICY_UPSERT, {
      code: 'taskFailed',
      message: 'conflict: policy `approvals` is at version 1, not the expected 0',
      details: { reason: 'conflict' },
    })
    await vta.setApprovalRule(agent, CREATE, true)
    expect(sentOf(POLICY_GET)).toHaveLength(2)
    expect(sentOf(POLICY_UPSERT)).toHaveLength(2)
    expect(rulesHeld()).toHaveLength(1)
  })

  it('a scoped administrator is told only an administrator can change this, and nothing is sent', async () => {
    mockVta.whoami = { roles: ['admin'], scopes: ['ctx:vetting'] }
    const { vta } = await linkedPhone()
    expect((await vta.approvalRules(agent)).canChange).toBe(false)
  })

  it('a row Keyring cannot read whole is never written back', async () => {
    mockVta.policy = {
      version: 2,
      module: 'elsewhere',
      ext: { 'openvtc.approvals': [{ taskType: CREATE, requires: 'consent', approverSet: 's', later: 1 }] },
    }
    const { vta } = await linkedPhone()
    expect((await vta.approvalRules(agent)).canChange).toBe(false)
    await expect(vta.setApprovalRule(agent, REVOKE_KEY, true)).rejects.toBeInstanceOf(DeviceActionRefused)
    expect(sentOf(POLICY_UPSERT)).toEqual([])
  })

  it('a cancelled owner check changes nothing', async () => {
    const confirmOwner = jest.fn(async () => ({ ok: false, reason: 'cancelled' }) as OwnerConfirmation)
    const { vta } = await linkedPhone({ confirmOwner })
    await expect(vta.setApprovalRule(agent, CREATE, true)).rejects.toMatchObject({ name: 'OwnerNotConfirmed' })
    expect(sentOf(POLICY_GET)).toEqual([])
    expect(sentOf(POLICY_UPSERT)).toEqual([])
  })

  it('the test request is held for consent and never re-submitted, so nothing is created', async () => {
    mockClientOptions.consentWaitMs = 5000
    mockVta.consentFor = new Set([CREATE])
    const { vta } = await linkedPhone()
    expect(await vta.sendTestRequest(agent)).toEqual({ kind: 'held' })
    expect(sentOf(CREATE)).toHaveLength(1)
    expect(mockVta.contexts.size).toBe(0)
  })

  it('an agent that enforces nothing lets the test through; the context is deleted again', async () => {
    const { vta } = await linkedPhone()
    expect(await vta.sendTestRequest(agent)).toEqual({ kind: 'letThrough', cleanedUp: true })
    expect(sentOf(CREATE)[0].payload).toMatchObject({ name: 'Keyring test request' })
    // An agent before vta-service v0.67.0 refuses 1.1 and is asked 1.0.
    expect(sentOf(CONTEXTS_DELETE_11)).toHaveLength(1)
    expect(sentOf(CONTEXTS_DELETE)[0].payload).toEqual({ id: sentOf(CREATE)[0].payload.id, force: true })
    expect(mockVta.contexts.size).toBe(0)
  })

  it('an agent serving contexts/delete only at 1.1 has the test context deleted at 1.1', async () => {
    mockVta.contextsDelete = [CONTEXTS_DELETE_11]
    const { vta } = await linkedPhone()
    expect(await vta.sendTestRequest(agent)).toEqual({ kind: 'letThrough', cleanedUp: true })
    expect(sentOf(CONTEXTS_DELETE_11)[0].payload).toEqual({ id: sentOf(CREATE)[0].payload.id, force: true })
    expect(sentOf(CONTEXTS_DELETE)).toEqual([])
    expect(mockVta.contexts.size).toBe(0)
  })

  it('"ask me before deleting a context" names every version the agent dispatches', async () => {
    const ruleOf = () => (rulesHeld() as { taskType: string }[]).map((r) => r.taskType)
    mockVta.discovery = [CONTEXTS_DELETE_11, CREATE]
    const { vta } = await linkedPhone()
    const on = await vta.setApprovalRule(agent, CONTEXTS_DELETE_11, true)
    expect(ruleOf()).toEqual([CONTEXTS_DELETE_11])
    expect(on.view.offered.find((o) => o.key === 'contextsDelete')).toMatchObject({ on: true, renew: false })

    // v0.67.0 dispatches both, gated apart.
    mockVta.discovery = [CONTEXTS_DELETE, CONTEXTS_DELETE_11, CREATE]
    await vta.setApprovalRule(agent, CONTEXTS_DELETE_11, true)
    expect(ruleOf()).toEqual([CONTEXTS_DELETE_11, CONTEXTS_DELETE])
    await vta.setApprovalRule(agent, CONTEXTS_DELETE_11, false)
    expect(ruleOf()).toEqual([])
  })

  it('on an agent updated to serve contexts/delete only at 1.1, an old 1.0 rule reads off and, turned on again, holds', async () => {
    // Turned on while the agent served only 1.0.
    mockVta.discovery = [CONTEXTS_DELETE, CREATE]
    mockVta.enforceRules = true
    const { vta } = await linkedPhone()
    await vta.setApprovalRule(agent, CONTEXTS_DELETE_11, true)

    // The agent is updated (61c23f20): 1.1 only. The 1.0 rule now holds nothing — the test context goes unasked.
    mockVta.contextsDelete = [CONTEXTS_DELETE_11]
    mockVta.discovery = [CONTEXTS_DELETE_11, CREATE]
    expect(await vta.sendTestRequest(agent)).toEqual({ kind: 'letThrough', cleanedUp: true })
    expect((await vta.approvalRules(agent)).view.offered.find((o) => o.key === 'contextsDelete')).toMatchObject({
      on: false,
      renew: true,
    })

    // Turned on again: the rule is re-written at 1.1, and a deletion is held for this phone's approval.
    const renewed = await vta.setApprovalRule(agent, CONTEXTS_DELETE_11, true)
    expect(renewed.view.offered.find((o) => o.key === 'contextsDelete')).toMatchObject({ on: true, renew: false })
    expect(await vta.sendTestRequest(agent)).toEqual({ kind: 'letThrough', cleanedUp: false })
    expect(mockVta.contexts.size).toBe(1)
  })
})
