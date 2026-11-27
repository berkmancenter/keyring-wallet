/**
 * Agent connect's VTA client additions (docs/plans/agent-connect-plan.md §3.3, §3.9, §3.15, step 7.4): an agent's
 * entry written at `acl/grant` 0.3, its contexts narrowed through `acl/revoke` 0.3 and widened through `acl/update`
 * 0.3, never stepping down to 0.1 or 0.2, and `device/list` read to its last page.
 *
 * Every payload sent, and every answer the fake VTA gives, at a version the fixtures carry, is validated against the
 * specification's own schemas at the pin (`fixtures/acl-schemas-0.3`, `dtgwg-trust-tasks-tf` 2a66a0351): `acl/grant`,
 * `acl/update` and `acl/revoke` 0.3, `acl/list` 0.4, `device/list` 0.3 and 0.2. So neither side of a test can take a
 * shape the VTA would not. A refusal the fake throws is not a payload and is not checked.
 */
import Ajv from 'ajv/dist/2020'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  AGENT_LISTING_MAX_PAGES,
  AgentAccessUnsupportedError,
  VTA_TASK,
  VtaClient,
  agentAccessWrites,
  agentGrantPayload,
  pageContinuation,
} from '../module/VtaClient'
import { VtiRefusal } from '../module/vtiAgent'
import { expectNoDrift, registryPath } from './fixtures/registryDrift'

jest.mock('react-native-keychain', () => ({ ACCESS_CONTROL: {}, ACCESSIBLE: {}, STORAGE_TYPE: {} }))

const DIR = join(__dirname, 'fixtures', 'acl-schemas-0.3')
const read = (file: string) => JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, unknown>

/**
 * The schemas' `$ref`s are relative paths; each referenced schema is registered under the URL its referrers resolve
 * it to (and without its own `$id`, which names another path), so Ajv finds it exactly where a referrer looks.
 */
function schemas() {
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false, logger: false })
  const asKey = (file: string, key: string) => {
    const schema = { ...read(file) }
    delete schema.$id
    ajv.addSchema(schema, key)
  }
  asKey('framework-0.4.schema.json', 'https://trusttasks.org/_framework/0.4/framework.schema.json')
  asKey('framework-0.2.schema.json', 'https://trusttasks.org/_framework/0.2/framework.schema.json')
  asKey('acl-entry-0.3.schema.json', 'https://trusttasks.org/spec/_shared/0.3/acl-entry.schema.json')
  asKey('device-binding-0.2.schema.json', 'https://trusttasks.org/spec/_shared/0.2/device-binding.schema.json')
  const payloads: Record<string, string> = {
    [VTA_TASK.aclGrant03]: 'acl-grant-0.3.payload.schema.json',
    [VTA_TASK.aclUpdate03]: 'acl-update-0.3.payload.schema.json',
    [VTA_TASK.aclRevoke03]: 'acl-revoke-0.3.payload.schema.json',
    [VTA_TASK.aclList04]: 'acl-list-0.4.payload.schema.json',
    'https://trusttasks.org/spec/device/list/0.3': 'device-list-0.3.payload.schema.json',
    'https://trusttasks.org/spec/device/list/0.2': 'device-list-0.2.payload.schema.json',
  }
  for (const file of Object.values(payloads)) ajv.addSchema(read(file))
  const request = (type: string) => {
    const validate = ajv.getSchema(type)
    if (!validate) throw new Error(`no schema for ${type}`)
    return validate
  }
  const response = (type: string) => ajv.compile({ $ref: `${type}#/$defs/Response` })
  return { request, response, known: (type: string) => type in payloads }
}

const S = schemas()

/** Fail with the validator's errors, so a shape mismatch names its member. */
function expectValid(validate: ReturnType<typeof S.request>, value: unknown) {
  const ok = validate(value)
  if (!ok) throw new Error(JSON.stringify(validate.errors, null, 1))
}

const K_A = 'did:key:z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp'
const K_B = 'did:key:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG'
const K_T = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
const OTHER = 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH'

/** An AclEntry 0.3 as the VTA would answer it. */
const wireEntry = (subject: string, contexts: string[], capabilities: string[] = ['memory-read', 'memory-write']) => ({
  subject,
  role: 'application',
  act: { scope: 'contexts', contexts },
  keys: { scope: 'none' },
  capabilities:
    capabilities.length > 0
      ? { scope: 'listed', grants: capabilities.map((capability) => ({ capability })) }
      : { scope: 'none' },
  purposes: { scope: 'listed', purposes: ['personalisation', 'taskExecution'] },
  label: 'Notes helper',
  expiresAt: '2026-11-25T16:00:00Z',
})

const binding = (deviceId: string, consumerDid: string, serviceKind: 'aiAgent' | 'mediator' = 'aiAgent') => ({
  deviceId,
  consumerDid,
  consumerKind: { kind: 'service', serviceKind },
  displayName: 'Notes helper',
  registeredAt: '2026-11-25T12:00:00Z',
})

const logger = { info: jest.fn(), warn: jest.fn() }
const client = () => new VtaClient({ config: { logger } } as never, 'did:webvh:agent', {} as never, {})

/**
 * A VTA client whose `task` answers from `answer(type, payload)`, after checking the payload against the request
 * schema of its type and the answer against the response schema, wherever the pin has them.
 */
function withVta(answer: (type: string, payload: Record<string, unknown>) => unknown) {
  const vta = client()
  const sent: { type: string; payload: Record<string, unknown> }[] = []
  jest.spyOn(vta, 'task').mockImplementation(async (type: string, payload: Record<string, unknown>) => {
    sent.push({ type, payload })
    if (S.known(type)) expectValid(S.request(type), payload)
    const out = answer(type, payload)
    if (out instanceof Error) throw out
    if (S.known(type)) expectValid(S.response(type), out)
    return out as never
  })
  return { vta, sent }
}

const GRANT = {
  subject: K_T,
  contexts: ['keyring-memory-abcdefghij'],
  capabilities: ['memory-read', 'memory-write'],
  purposes: ['personalisation', 'taskExecution'],
  label: 'Notes helper',
  expiresAt: '2026-11-25T16:00:00Z',
}

const unsupported = (served: string[]) => new VtiRefusal('unsupportedVersion', 'not served', { servedVersions: served })

describe('grantApplication: acl/grant 0.3 only', () => {
  it("sends the entry of §3.3 in 0.3's shape, and reads the entry the VTA answers", async () => {
    const { vta, sent } = withVta(() => ({ entry: wireEntry(K_T, ['keyring-memory-abcdefghij']) }))
    const entry = await vta.grantApplication(GRANT)
    expect(sent.map((s) => s.type)).toEqual([VTA_TASK.aclGrant03])
    expect(sent[0].payload).toEqual({
      entry: {
        subject: K_T,
        role: 'application',
        act: { scope: 'contexts', contexts: ['keyring-memory-abcdefghij'] },
        keys: { scope: 'none' },
        capabilities: { scope: 'listed', grants: [{ capability: 'memory-read' }, { capability: 'memory-write' }] },
        purposes: { scope: 'listed', purposes: ['personalisation', 'taskExecution'] },
        label: 'Notes helper',
        expiresAt: '2026-11-25T16:00:00Z',
      },
    })
    expect(entry).toMatchObject({
      subject: K_T,
      role: 'application',
      act: { stated: 'contexts', contexts: ['keyring-memory-abcdefghij'] },
      capabilityScope: { stated: 'listed', capabilities: ['memory-read', 'memory-write'] },
      purposes: { scope: 'listed', purposes: ['personalisation', 'taskExecution'] },
    })
  })

  it('with no capability chosen, the entry holds none', () => {
    expect(agentGrantPayload({ ...GRANT, capabilities: [] })).toMatchObject({
      entry: { capabilities: { scope: 'none' } },
    })
    expectValid(S.request(VTA_TASK.aclGrant03), agentGrantPayload({ ...GRANT, capabilities: [] }))
  })

  it('a VTA that serves no 0.3 is refused, and no older version is asked', async () => {
    const { vta, sent } = withVta(() => unsupported([VTA_TASK.aclGrant02, VTA_TASK.aclGrant]))
    await expect(vta.grantApplication(GRANT)).rejects.toBeInstanceOf(AgentAccessUnsupportedError)
    expect(sent.map((s) => s.type)).toEqual([VTA_TASK.aclGrant03])
  })

  it('control: any other refusal is passed on as it came', async () => {
    const { vta } = withVta(() => new VtiRefusal('forbidden', 'no'))
    await expect(vta.grantApplication(GRANT)).rejects.toMatchObject({ name: 'VtiRefusal', code: 'forbidden' })
  })

  it.each([
    ['no context', { contexts: [] }],
    ['no purpose', { purposes: [] }],
    ['modelTraining', { purposes: ['personalisation', 'modelTraining'] }],
  ])('refuses %s before anything is sent', async (_, over) => {
    const { vta, sent } = withVta(() => ({ entry: wireEntry(K_T, ['x']) }))
    await expect(vta.grantApplication({ ...GRANT, ...over })).rejects.toThrow()
    expect(sent).toEqual([])
  })

  it('control: the schema refuses a payload 0.3 does not allow', () => {
    const bad = agentGrantPayload(GRANT) as { entry: Record<string, unknown> }
    expect(
      S.request(VTA_TASK.aclGrant03)({ entry: { ...bad.entry, capabilities: { scope: 'listed', grants: [] } } })
    ).toBe(false)
  })
})

describe('narrowOrWidenCapabilities: narrow through acl/revoke 0.3, widen through acl/update 0.3', () => {
  const answerFor = (contexts: string[]) => (type: string, payload: Record<string, unknown>) => {
    if (type === VTA_TASK.aclRevoke03) {
      const act = (payload.revocation as { act: { scope: string; contexts?: string[] } }).act
      return { entry: wireEntry(K_A, act.scope === 'contexts' ? (act.contexts as string[]) : ['unused']) }
    }
    return { entry: wireEntry(K_A, contexts) }
  }

  it('widening only: one update', async () => {
    const { vta, sent } = withVta(answerFor(['a', 'b']))
    const entry = await vta.narrowOrWidenCapabilities({ subject: K_A, act: { from: ['a'], to: ['a', 'b'] } })
    expect(sent).toEqual([
      { type: VTA_TASK.aclUpdate03, payload: { subject: K_A, act: { scope: 'contexts', contexts: ['a', 'b'] } } },
    ])
    expect(entry.act).toEqual({ stated: 'contexts', contexts: ['a', 'b'] })
  })

  it('narrowing only: one revoke of the act scope, never an update', async () => {
    const { vta, sent } = withVta(answerFor(['a']))
    await vta.narrowOrWidenCapabilities({ subject: K_A, act: { from: ['a', 'b'], to: ['a'] } })
    expect(sent).toEqual([
      {
        type: VTA_TASK.aclRevoke03,
        payload: { subject: K_A, revocation: { kind: 'act', act: { scope: 'contexts', contexts: ['a'] } } },
      },
    ])
  })

  it('both: narrows first, then widens, so it never holds more than either end', async () => {
    const { vta, sent } = withVta(answerFor(['a', 'c']))
    const entry = await vta.narrowOrWidenCapabilities({ subject: K_A, act: { from: ['a', 'b'], to: ['a', 'c'] } })
    expect(sent.map((s) => s.type)).toEqual([VTA_TASK.aclRevoke03, VTA_TASK.aclUpdate03])
    expect(sent[0].payload).toMatchObject({ revocation: { kind: 'act', act: { scope: 'contexts', contexts: ['a'] } } })
    expect(sent[1].payload).toMatchObject({ act: { scope: 'contexts', contexts: ['a', 'c'] } })
    expect(entry.act).toEqual({ stated: 'contexts', contexts: ['a', 'c'] })
  })

  it('every context replaced: narrowed to none, then widened to the new set', () => {
    expect(agentAccessWrites({ subject: K_A, act: { from: ['a'], to: ['b'] } })).toEqual([
      { type: VTA_TASK.aclRevoke03, payload: { subject: K_A, revocation: { kind: 'act', act: { scope: 'none' } } } },
      { type: VTA_TASK.aclUpdate03, payload: { subject: K_A, act: { scope: 'contexts', contexts: ['b'] } } },
    ])
  })

  it('capabilities, either way, through acl/update (a reduction is accepted there)', async () => {
    const { vta, sent } = withVta(answerFor(['a']))
    await vta.narrowOrWidenCapabilities({ subject: K_A, capabilities: ['memory-read'] })
    await vta.narrowOrWidenCapabilities({ subject: K_A, capabilities: [] })
    expect(sent.map((s) => s.payload.capabilities)).toEqual([
      { scope: 'listed', grants: [{ capability: 'memory-read' }] },
      { scope: 'none' },
    ])
  })

  it('a half-applied change: the narrowing stays, and only a retry computed from the entry as it now is goes through', async () => {
    // the revoke lands, the update is refused
    const failing = withVta((type, payload) =>
      type === VTA_TASK.aclRevoke03 ? answerFor(['a'])(type, payload) : new VtiRefusal('forbidden', 'no')
    )
    const change = { subject: K_A, act: { from: ['a', 'b'], to: ['a', 'c'] } }
    await expect(failing.vta.narrowOrWidenCapabilities(change)).rejects.toMatchObject({ code: 'forbidden' })
    expect(failing.sent.map((s) => s.type)).toEqual([VTA_TASK.aclRevoke03, VTA_TASK.aclUpdate03])
    // the same change again would ask to narrow to what the entry already holds, which acl/revoke 0.3 refuses
    expect(agentAccessWrites(change)[0]).toMatchObject({ type: VTA_TASK.aclRevoke03 })
    // control: computed from the entry as it now holds (['a']), the retry is the widening alone
    expect(agentAccessWrites({ ...change, act: { from: ['a'], to: ['a', 'c'] } })).toEqual([
      { type: VTA_TASK.aclUpdate03, payload: { subject: K_A, act: { scope: 'contexts', contexts: ['a', 'c'] } } },
    ])
  })

  it("a new expiry is one acl/update 0.3 expiresAt; a value that isn't a time is refused, and nothing sends a null", () => {
    const at = '2026-11-27T05:00:00.000Z'
    expect(agentAccessWrites({ subject: K_A, expiresAt: at })).toEqual([
      { type: VTA_TASK.aclUpdate03, payload: { subject: K_A, expiresAt: at } },
    ])
    // with a widening, both in the one update
    expect(agentAccessWrites({ subject: K_A, act: { from: ['a'], to: ['a', 'b'] }, expiresAt: at })).toEqual([
      {
        type: VTA_TASK.aclUpdate03,
        payload: { subject: K_A, act: { scope: 'contexts', contexts: ['a', 'b'] }, expiresAt: at },
      },
    ])
    expect(() => agentAccessWrites({ subject: K_A, expiresAt: 'tomorrow' })).toThrow('not a time')
    // control: no expiry asked, none sent
    expect(agentAccessWrites({ subject: K_A, capabilities: [] })[0].payload).not.toHaveProperty('expiresAt')
  })

  it('nothing to change sends nothing', async () => {
    const { vta, sent } = withVta(answerFor(['a']))
    await expect(vta.narrowOrWidenCapabilities({ subject: K_A, act: { from: ['a'], to: ['a'] } })).rejects.toThrow(
      'nothing to change'
    )
    expect(sent).toEqual([])
  })

  it('an empty target set is refused: an entry names at least one context', () => {
    expect(() => agentAccessWrites({ subject: K_A, act: { from: ['a'], to: [] } })).toThrow('at least one context')
  })

  it('a VTA that serves no 0.3 is refused at the first write, and nothing older is asked', async () => {
    const { vta, sent } = withVta(() => unsupported([VTA_TASK.aclRevoke02]))
    await expect(
      vta.narrowOrWidenCapabilities({ subject: K_A, act: { from: ['a', 'b'], to: ['a', 'c'] } })
    ).rejects.toBeInstanceOf(AgentAccessUnsupportedError)
    expect(sent.map((s) => s.type)).toEqual([VTA_TASK.aclRevoke03])
  })
})

describe('devicesByKind: device/list, every page', () => {
  const pages03 = [
    { devices: [binding('dev-1', K_A)], nextCursor: 'c1' },
    { devices: [binding('dev-2', K_B, 'mediator')], nextCursor: 'c2' },
    { devices: [{ ...binding('dev-3', OTHER), disabledAt: '2026-11-25T13:00:00Z' }] },
  ]

  it('reads 0.3 to its last page, with the cursor each page gave, disabled and wiped devices included', async () => {
    const { vta, sent } = withVta((_, p) => pages03[p.cursor === 'c1' ? 1 : p.cursor === 'c2' ? 2 : 0])
    const listed = await vta.devicesByKind()
    expect(sent.map((s) => s.payload)).toEqual([
      { includeDisabled: true, includeWiped: true },
      { includeDisabled: true, includeWiped: true, cursor: 'c1' },
      { includeDisabled: true, includeWiped: true, cursor: 'c2' },
    ])
    expect(listed).toEqual({
      complete: true,
      devices: [
        { deviceId: 'dev-1', consumerDid: K_A, kind: 'ai-agent', disabled: false, wiped: false },
        { deviceId: 'dev-2', consumerDid: K_B, kind: 'mediator', disabled: false, wiped: false },
        { deviceId: 'dev-3', consumerDid: OTHER, kind: 'ai-agent', disabled: true, wiped: false },
      ],
    })
  })

  it('asks for one service kind when told', async () => {
    const { vta, sent } = withVta(() => ({ devices: [] }))
    await vta.devicesByKind('aiAgent')
    expect(sent[0].payload).toMatchObject({ consumerKindFilter: 'service', serviceKindFilter: 'aiAgent' })
  })

  it('steps down to 0.2 and pages it with truncated and cursor', async () => {
    const { vta, sent } = withVta((type, p) => {
      if (type.endsWith('/0.3')) return unsupported(['https://trusttasks.org/spec/device/list/0.2'])
      return p.cursor === 'p2'
        ? { devices: [binding('dev-2', K_B)], truncated: false }
        : { devices: [binding('dev-1', K_A)], truncated: true, cursor: 'p2' }
    })
    const listed = await vta.devicesByKind()
    expect(sent.map((s) => s.type)).toEqual([
      'https://trusttasks.org/spec/device/list/0.3',
      'https://trusttasks.org/spec/device/list/0.2',
      'https://trusttasks.org/spec/device/list/0.2',
    ])
    expect(listed.complete).toBe(true)
    expect(listed.devices.map((d) => d.deviceId)).toEqual(['dev-1', 'dev-2'])
  })

  it('a page that says it is truncated and gives no cursor leaves the listing incomplete', async () => {
    const { vta } = withVta((type) =>
      type.endsWith('/0.3') ? unsupported([]) : { devices: [binding('dev-1', K_A)], truncated: true }
    )
    expect((await vta.devicesByKind()).complete).toBe(false)
  })

  it('a cursor given twice ends the listing as incomplete', async () => {
    const { vta, sent } = withVta(() => ({ devices: [binding('dev-1', K_A)], nextCursor: 'same' }))
    expect((await vta.devicesByKind()).complete).toBe(false)
    expect(sent).toHaveLength(2)
  })

  it(`stops after ${AGENT_LISTING_MAX_PAGES} pages as incomplete`, async () => {
    let n = 0
    const { vta, sent } = withVta(() => ({ devices: [], nextCursor: `c${++n}` }))
    expect((await vta.devicesByKind()).complete).toBe(false)
    expect(sent).toHaveLength(AGENT_LISTING_MAX_PAGES)
  })

  it('pageContinuation reads both spellings', () => {
    expect(pageContinuation({ nextCursor: 'x' })).toEqual({ next: 'x', complete: false })
    expect(pageContinuation({ truncated: true, cursor: 'y' })).toEqual({ next: 'y', complete: false })
    expect(pageContinuation({ truncated: true })).toEqual({ complete: false })
    expect(pageContinuation({ truncated: false, cursor: 'stale' })).toEqual({ complete: true })
    expect(pageContinuation({})).toEqual({ complete: true })
  })
})

describe('entryKind and findAgentEntries: found by deviceId after the subject changed', () => {
  // The agent registered as K_A (dev-1), then swapped to K_B: the device's consumerDid is K_B now.
  const vtaAfterSwap = (
    aclPages: Record<string, unknown>[] = [{ entries: [wireEntry(K_B, ['a']), wireEntry(OTHER, ['z'])] }]
  ) =>
    withVta((type, p) => {
      if (type.includes('/device/list/')) return { devices: [binding('dev-1', K_B), binding('dev-9', OTHER)] }
      if (type.includes('/acl/list/')) return aclPages[p.cursor === 'n1' ? 1 : 0]
      throw new Error(`unexpected ${type}`)
    })

  it('the kind of the device a subject now authenticates as', async () => {
    const { vta } = vtaAfterSwap()
    expect(await vta.entryKind(K_B)).toEqual({ kind: 'ai-agent', deviceId: 'dev-1', complete: true })
    // control: the old key has no device any more
    expect(await vta.entryKind(K_A)).toEqual({ complete: true })
  })

  it('the stored deviceId finds the entry under its new key; the old subject alone finds nothing', async () => {
    const { vta } = vtaAfterSwap()
    const found = await vta.findAgentEntries({ deviceId: 'dev-1', subject: K_A })
    expect(found.complete).toBe(true)
    expect(found.matches.map((m) => [m.entry.subject, m.deviceId, m.kind])).toEqual([[K_B, 'dev-1', 'ai-agent']])
    // control: without the deviceId, the stored subject K_A matches nothing (the swap moved the entry away from it)
    expect((await vta.findAgentEntries({ subject: K_A })).matches).toEqual([])
  })

  it('reads every page of the access list, and says incomplete when it cannot', async () => {
    const paged = vtaAfterSwap([
      { entries: [wireEntry(OTHER, ['z'])], nextCursor: 'n1' },
      { entries: [wireEntry(K_B, ['a'])] },
    ])
    const found = await paged.vta.findAgentEntries({ deviceId: 'dev-1' })
    expect(found).toMatchObject({ complete: true, matches: [{ entry: { subject: K_B } }] })
    // acl/list 0.4 says "more" only with nextCursor; a cursor given twice cannot be continued
    const cut = vtaAfterSwap([{ entries: [wireEntry(OTHER, ['z'])], nextCursor: 'again' }])
    expect((await cut.vta.findAgentEntries({ deviceId: 'dev-1' })).complete).toBe(false)
  })
})

describe('the vendored acl 0.3 and device/list schemas still match the registry', () => {
  // Runs where the registry clone is found (registryPath); CI has none and skips. Byte comparison: the folder is in
  // packages/.prettierignore and vendored verbatim, so a reformatting is drift.
  const maybe = registryPath() ? it : it.skip

  maybe('byte-identical to the commit PROVENANCE names', () => {
    expectNoDrift(DIR, {
      'acl-entry-0.3.schema.json': 'specs/acl/_shared/0.3/acl-entry.schema.json',
      'acl-grant-0.3.payload.schema.json': 'specs/acl/grant/0.3/payload.schema.json',
      'acl-update-0.3.payload.schema.json': 'specs/acl/update/0.3/payload.schema.json',
      'acl-revoke-0.3.payload.schema.json': 'specs/acl/revoke/0.3/payload.schema.json',
      'acl-list-0.4.payload.schema.json': 'specs/acl/list/0.4/payload.schema.json',
      'device-list-0.3.payload.schema.json': 'specs/device/list/0.3/payload.schema.json',
      'device-list-0.2.payload.schema.json': 'specs/device/list/0.2/payload.schema.json',
      'device-binding-0.2.schema.json': 'specs/device/_shared/0.2/device-binding.schema.json',
      'framework-0.4.schema.json': 'specs/_framework/0.4/framework.schema.json',
      'framework-0.2.schema.json': 'specs/_framework/0.2/framework.schema.json',
    })
  })
})
