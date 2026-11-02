/**
 * The agent's current task versions (Trust Tasks group 1b).
 *
 * On 2026-10-28 vta-service stopped serving anything but the current version of most families (#2308-#2318). An
 * agent from 0d3f268e (what first.openvtc.net runs) serves only vault/list and vault/upsert 0.4,
 * vault/credentials/get 0.2, device/heartbeat and device/list 0.3, policy/upsert 0.3, task-consent/decision 0.2 and
 * auth/step-up/approve-response 0.6; agents at v0.60.0 to v0.66.0 serve only the older ones. Each family asks the
 * newest first and steps down on a refusal coded unsupportedVersion or unsupportedType (taskVersions.ts), and each
 * answer is read in either spelling of the 2026-10-24 naming pass (trust-tasks-tf f27ea5387).
 */
import { PAYLOAD_SCHEMA as POLICY_UPSERT_0_3 } from '@openvtc/trust-tasks/policy/upsert/0.3/payload'
import { PAYLOAD_SCHEMA as LIST_0_4 } from '@openvtc/trust-tasks/vault/list/0.4/payload'
import { PAYLOAD_SCHEMA as DIDS_CREATE_1_2 } from '@openvtc/trust-tasks/vta/webvh/dids/create/1.2/payload'
import { RESPONSE_PAYLOAD_SCHEMA as GET_0_2_ANSWER } from '@openvtc/trust-tasks/vault/credentials/get/0.2/payload'
import Ajv from 'ajv/dist/2020'

import { PHONE_SENDS } from '../module/approvalRules'
import { approveResponseTypesFor, STEP_UP_TASK } from '../module/stepUp'
import { forgetAllVersions } from '../module/taskVersions'
import { VTA_TASK, VtaClient, vaultPayloadFor } from '../module/VtaClient'
import { AGENT_DEVICE_TASK, heartbeat, listAgentDevices, renameThisDevice } from '../module/vtaDevices'
import { credentialOfGet, fetchAgentCards, VAULT_GET, VAULT_GET_02 } from '../module/vtiCardVault'
import { VtiRefusal } from '../module/vtiAgent'

jest.mock('react-native-keychain', () => ({ ACCESS_CONTROL: {}, ACCESSIBLE: {}, STORAGE_TYPE: {} }))

const ajv = new Ajv({ strict: false, allErrors: true, logger: false })
const SPEC = 'https://trusttasks.org/spec/'
const notServed = (uri: string) => new VtiRefusal('unsupportedType', `${uri} is not served`)
const logger = { info: jest.fn(), warn: jest.fn() }
const client = () => new VtaClient({ config: { logger } } as never, 'did:webvh:agent', {} as never, {})
const typesSent = (task: jest.SpyInstance) => task.mock.calls.map((c) => c[0])

beforeEach(() => {
  forgetAllVersions()
  logger.info.mockClear()
  logger.warn.mockClear()
})

describe('vault/list and vault/upsert: 0.4, then 0.3', () => {
  it('asks list at 0.4 in a payload 0.4 takes, with pageSize spelled limit', async () => {
    const vta = client()
    const task = jest.spyOn(vta, 'task').mockResolvedValueOnce({ entries: [], nextCursor: 'c1' })
    await vta.vaultList({ contextId: 'ctx', secretKind: 'did-self-issued', pageSize: 10 })
    const [type, payload] = task.mock.calls[0]
    expect(type).toBe(VTA_TASK.vaultList04)
    expect(payload).toEqual({ contextId: 'ctx', secretKind: 'didSelfIssued', limit: 10 })
    expect(ajv.compile(LIST_0_4 as object)(payload)).toBe(true)
  })

  it('steps down to 0.3 when an agent before 0d3f268e refuses 0.4, and is then asked 0.3 straight away', async () => {
    const vta = client()
    const task = jest
      .spyOn(vta, 'task')
      .mockRejectedValueOnce(notServed(VTA_TASK.vaultList04))
      .mockResolvedValue({ entries: [] })
    await vta.vaultList({})
    await vta.vaultList({})
    expect(typesSent(task)).toEqual([VTA_TASK.vaultList04, VTA_TASK.vaultList03, VTA_TASK.vaultList03])
  })

  it("reads upsert 0.4's wasCreated as created", async () => {
    const answer = { entry: { id: 'vault_1' }, wasCreated: true }
    const vta = client()
    jest.spyOn(vta, 'task').mockResolvedValueOnce(answer)
    await expect(vta.vaultUpsert({ label: 'x' })).resolves.toEqual({ entry: { id: 'vault_1' }, created: true })
  })

  it("keeps 0.3's created as it was", async () => {
    const vta = client()
    jest
      .spyOn(vta, 'task')
      .mockRejectedValueOnce(notServed(VTA_TASK.vaultUpsert04))
      .mockResolvedValueOnce({ entry: { id: 'vault_1' }, created: false })
    await expect(vta.vaultUpsert({ label: 'x' })).resolves.toEqual({ entry: { id: 'vault_1' }, created: false })
  })

  it('vaultPayloadFor leaves pageSize alone below 0.4', () => {
    expect(vaultPayloadFor(VTA_TASK.vaultList03, { pageSize: 5 })).toEqual({ pageSize: 5 })
  })
})

describe('policy/upsert: 0.3, then 0.2', () => {
  const MODEL = { rules: [], sets: [] } as never

  it('writes the approval rules at 0.3 in a payload 0.3 takes, and reads the version back', async () => {
    const vta = client()
    const task = jest.spyOn(vta, 'task').mockResolvedValueOnce({ policy: { version: 4 }, wasCreated: false })
    await expect(vta.writeApprovals(MODEL, 3)).resolves.toBe(4)
    expect(task.mock.calls[0][0]).toBe(VTA_TASK.policyUpsert03)
    expect(ajv.compile(POLICY_UPSERT_0_3 as object)(task.mock.calls[0][1])).toBe(true)
  })

  it('steps down to 0.2 on an agent that serves only 0.2', async () => {
    const vta = client()
    const task = jest
      .spyOn(vta, 'task')
      .mockRejectedValueOnce(notServed(VTA_TASK.policyUpsert03))
      .mockResolvedValueOnce({ policy: { version: 4 }, created: false })
    await expect(vta.writeApprovals(MODEL, 3)).resolves.toBe(4)
    expect(typesSent(task)).toEqual([VTA_TASK.policyUpsert03, VTA_TASK.policyUpsert])
  })

  it('never writes again in another version when the refusal is about the write', async () => {
    const vta = client()
    const task = jest.spyOn(vta, 'task').mockRejectedValueOnce(new VtiRefusal('conflict', 'changed since'))
    await expect(vta.writeApprovals(MODEL, 3)).rejects.toThrow(/changed since/)
    expect(task).toHaveBeenCalledTimes(1)
  })
})

describe('task-consent/decision: 0.2, then 0.1', () => {
  // A sha2-256 multihash (0x12 0x20 + 32 bytes), base64url with the `u` multibase prefix.
  const DIGEST = 'u' + Buffer.concat([Buffer.from([0x12, 0x20]), Buffer.alloc(32, 7)]).toString('base64url')
  const REQUEST = { challenge: 'c'.repeat(32), payloadDigest: DIGEST }

  it('decides at 0.2 first, and at 0.1 on an agent that serves only 0.1', async () => {
    const vta = client()
    const task = jest
      .spyOn(vta, 'task')
      .mockRejectedValueOnce(notServed(VTA_TASK.consentDecision02))
      .mockResolvedValueOnce({ status: 'approved' })
    await expect(vta.decideConsent(REQUEST, 'approve')).resolves.toEqual({ status: 'approved' })
    expect(typesSent(task)).toEqual([VTA_TASK.consentDecision02, VTA_TASK.consentDecision])
  })
})

describe('vta/webvh/dids/create: 1.2, then 1.1', () => {
  it('mints at 1.2 in a payload 1.2 takes', async () => {
    const vta = client()
    const task = jest.spyOn(vta, 'task').mockResolvedValueOnce({ did: 'did:webvh:x', contextId: 'vta' })
    await vta.mintPersona({ contextId: 'vta', serverId: 'control' })
    expect(task.mock.calls[0][0]).toBe(VTA_TASK.didsCreate12)
    expect(ajv.compile(DIDS_CREATE_1_2 as object)(task.mock.calls[0][1])).toBe(true)
  })
})

describe('auth/step-up/approve-response: 0.7 first, then 0.6, the request’s own version as the last step down', () => {
  it('answers a 0.2 request with 0.7 first, then 0.6, then 0.2', () => {
    expect(approveResponseTypesFor(STEP_UP_TASK.approveRequest02)).toEqual([
      STEP_UP_TASK.approveResponse07,
      STEP_UP_TASK.approveResponse06,
      STEP_UP_TASK.approveResponse,
    ])
    expect(approveResponseTypesFor(STEP_UP_TASK.approveRequest03)).toEqual([
      STEP_UP_TASK.approveResponse07,
      STEP_UP_TASK.approveResponse06,
      STEP_UP_TASK.approveResponse05,
    ])
    expect(approveResponseTypesFor(STEP_UP_TASK.approveRequest05)).toEqual([
      STEP_UP_TASK.approveResponse07,
      STEP_UP_TASK.approveResponse06,
    ])
  })
})

describe('device/heartbeat and device/list: 0.3, then 0.2', () => {
  const port = () => {
    const task = jest.fn()
    return { port: { managerDid: `did:key:z6Mk${Math.random().toString(36).slice(2)}`, task }, task }
  }

  it('beats at 0.3, and at 0.2 on an agent that serves only 0.2, remembered for the next beat', async () => {
    const { port: p, task } = port()
    task.mockRejectedValueOnce(notServed(AGENT_DEVICE_TASK.heartbeat03)).mockResolvedValue({ serverTime: 'x' })
    await heartbeat(p)
    await renameThisDevice(p, 'Phone')
    expect(task.mock.calls.map((c) => c[0])).toEqual([
      AGENT_DEVICE_TASK.heartbeat03,
      AGENT_DEVICE_TASK.heartbeat,
      AGENT_DEVICE_TASK.heartbeat,
    ])
  })

  it('lists devices at 0.3 with the same filters', async () => {
    const { port: p, task } = port()
    task.mockImplementation(async (type: string) => (type.includes('/acl/') ? { entries: [] } : { devices: [] }))
    await listAgentDevices(p)
    const list = task.mock.calls.find((c) => (c[0] as string).includes('/device/list/'))
    expect(list).toEqual([AGENT_DEVICE_TASK.list03, { includeWiped: true, includeDisabled: true }])
  })
})

describe('vault/credentials/get: 0.2, then 0.1', () => {
  const CARD = { id: 'urn:uuid:card-1', type: ['VerifiableCredential'] }

  it('reads a 0.2 answer’s credential, or its credentialBase64 when that is JSON', () => {
    const answer = { format: 'ldp_vc', credential: CARD }
    expect(ajv.compile(GET_0_2_ANSWER as object)(answer)).toBe(true)
    expect(credentialOfGet(answer)).toEqual(CARD)
    const b64 = Buffer.from(JSON.stringify(CARD)).toString('base64')
    expect(credentialOfGet({ format: 'ldp_vc', credentialBase64: b64 })).toEqual(CARD)
    expect(credentialOfGet({ format: 'jwt_vc', credentialBase64: Buffer.from('eyJ.x.y').toString('base64') })).toBe(
      undefined
    )
  })

  it('asks 0.2 first and 0.1 on an agent that serves only 0.1', async () => {
    const task = jest.fn(async (type: string, payload: Record<string, unknown>) => {
      if (type.includes('/query/')) return { credentials: [{ id: CARD.id }] }
      if (type === VAULT_GET_02) throw notServed(VAULT_GET_02)
      return { credential: { ...CARD, id: payload.id } }
    })
    const cards = await fetchAgentCards(task as never)
    expect(cards).toEqual([{ id: CARD.id, credential: CARD }])
    expect(task.mock.calls.map((c) => c[0]).filter((t) => t.includes('/get/'))).toEqual([VAULT_GET_02, VAULT_GET])
  })
})

describe('acl: list 0.3, the rest 0.2, then 0.1', () => {
  it('lists at 0.3 first, and steps down to 0.1 on an agent before v0.67.0', async () => {
    const vta = client()
    const task = jest
      .spyOn(vta, 'task')
      .mockRejectedValueOnce(notServed(VTA_TASK.aclList03))
      .mockRejectedValueOnce(notServed(VTA_TASK.aclList02))
      .mockResolvedValueOnce({ entries: [], truncated: false })
    await vta.listAcl()
    expect(typesSent(task)).toEqual([VTA_TASK.aclList03, VTA_TASK.aclList02, VTA_TASK.aclList])
  })

  it('says a 0.3 page with a nextCursor is partial, as 0.1 and 0.2 say it with truncated', async () => {
    const vta = client()
    jest.spyOn(vta, 'task').mockResolvedValueOnce({ entries: [], nextCursor: 'more' })
    await vta.listAcl()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('answered a partial access list'))
  })

  it('My devices lists the access list at 0.3 first', async () => {
    const task = jest.fn(async (type: string) => (type.includes('/acl/') ? { entries: [] } : { devices: [] }))
    await listAgentDevices({ managerDid: 'did:key:z6MkAclList', task: task as never })
    expect(task.mock.calls.map((c) => c[0]).find((t) => t.includes('/acl/list/'))).toBe(AGENT_DEVICE_TASK.aclList03)
  })
})

describe('the approval rules know every version the phone now sends about itself', () => {
  it.each([
    'device/heartbeat/0.3',
    'device/list/0.3',
    'vault/credentials/get/0.2',
    'policy/upsert/0.3',
    'acl/list/0.3',
    'auth/step-up/approve-response/0.5',
    'auth/step-up/approve-response/0.7',
    'vta/webvh/dids/create/1.1',
    'vta/webvh/dids/create/1.2',
  ])('%s', (slug) => {
    expect(PHONE_SENDS).toContain(SPEC + slug)
  })
})
