/**
 * The pairing carriage (plan §3.2, §7.5).
 *
 * DRAFT #1386 at ceda53bca: the `deviceEnrol` path runs against a fake `auth/oob` service that follows the open
 * upstream pull request trustoverip/dtgwg-trust-tasks-tf #1386. Every request Keyring sends and every answer the fake
 * gives is checked against that draft's own schemas (`fixtures/auth-oob-draft-1386`). Nothing here is proven against
 * a real service: no VTA serves `auth/oob` today. One difference from the draft is deliberate and stated: the fake
 * takes a two-digit number on `deviceEnrol`, as §7.2 and §11 Q8 have it, where the draft's `MatchNumber` asks four.
 *
 * The fallback (`acl/grant` 0.3) and the entry read back (step 10) run against a fake access port.
 */
import Ajv from 'ajv/dist/2020'
import { readFileSync } from 'fs'
import { join } from 'path'

import { digestMultibase } from '@bifold/trust-tasks'

import { newThrowawayKey } from '../../trust-tasks/module/oobSignIn'
import { parseAclEntries } from '../../trust-tasks/module/VtaClient'
import { PairingLockout } from '../lockout'
import {
  AgentConnectChoice,
  ListedEntry,
  PairingLink,
  PairingMachine,
  PAIRING_FAILURE_COPY,
  SpentRequestStore,
} from '../pairing'
import {
  AccessEntry,
  AgentAccessPort,
  OobSendResult,
  PairingCarriage,
  accessEntryReader,
  completeEnrolment,
  listedEntryFrom,
} from '../carriage'
import { DEVICE_ENROL_DRAFT_COMMIT, DEVICE_ENROL_TASK, AdministratorSigner, draftAclScope } from '../deviceEnrolDraft'

jest.mock('react-native-keychain', () => ({ ACCESS_CONTROL: {}, ACCESSIBLE: {}, STORAGE_TYPE: {} }))

const DIR = join(__dirname, 'fixtures', 'auth-oob-draft-1386')
const read = (file: string) => JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, unknown>

/** Each schema registered under the URL its referrers resolve it to (their `$ref`s are relative paths). */
function draftSchemas() {
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false, logger: false })
  const under = (file: string, key: string) => {
    const s = { ...read(file) }
    delete s.$id
    ajv.addSchema(s, key)
  }
  // The draft's $id values do not mirror its file layout, so every key is the URL its referrer's $ref resolves to.
  const task = 'https://trusttasks.org/spec/auth/oob/claim/0.3'
  const oob = new URL('../../_shared/0.2/oob.schema.json', task).href
  const acl = new URL('../../../../acl/_shared/0.3/acl-entry.schema.json', oob).href
  const device = new URL('../../../../device/_shared/0.2/device-binding.schema.json', oob).href
  under('draft-auth-oob-_shared-0.2-oob.schema.json', oob)
  under('acl-entry-0.3.schema.json', acl)
  under('device-binding-0.2.schema.json', device)
  under('framework-0.4.schema.json', new URL('../../../../_framework/0.4/framework.schema.json', task).href)
  const fw4fromAcl = new URL('../../../_framework/0.4/framework.schema.json', acl).href
  if (!ajv.getSchema(fw4fromAcl)) under('framework-0.4.schema.json', fw4fromAcl)
  under('framework-0.2.schema.json', new URL('../../../_framework/0.2/framework.schema.json', device).href)
  for (const f of ['claim-0.3', 'prove-0.4', 'identify-0.2', 'grant-0.4', 'respond-0.4'])
    ajv.addSchema(read(`draft-auth-oob-${f}.schema.json`))
  const get = (ref: string) => {
    const v = ajv.getSchema(ref) ?? ajv.compile({ $ref: ref })
    return (value: unknown) => {
      if (!v(value)) throw new Error(`${ref}: ${JSON.stringify(v.errors)}`)
    }
  }
  return { request: (type: string) => get(type), response: (type: string) => get(`${type}#/$defs/Response`) }
}
const S = draftSchemas()

const VTA = 'did:webvh:QmVtaScid:vta.example.org'
const ADMIN = 'did:key:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG'
const K_T = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
const K_A = 'did:key:z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp'
const PERSONA = 'did:webvh:QmPersona:persona.example.org'
const ID = 'q3Vn7Zk2Xo9Rt1LwPb4HdA'
const NUMBER = '42'
const T0 = Date.parse('2026-11-26T12:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.000Z$/, 'Z')

const fakeProof = (vm: string, proofPurpose: string) => ({
  type: 'DataIntegrityProof',
  cryptosuite: 'eddsa-jcs-2022',
  created: iso(T0),
  verificationMethod: vm,
  proofPurpose,
  proofValue: 'z3FXQjecWJKT',
})

/** The phone's administrator signer, faked: it records what it signed and for which purpose. */
function administrator(): AdministratorSigner & { signed: { type: unknown; purpose: string }[] } {
  const signed: { type: unknown; purpose: string }[] = []
  return {
    did: ADMIN,
    signed,
    async sign(document, purpose) {
      signed.push({ type: document.type, purpose })
      return { ...document, proof: fakeProof(`${ADMIN}#key-1`, purpose) }
    },
  }
}

/**
 * A fake owner's VTA serving draft #1386's `deviceEnrol`. It checks every request against the draft's schema, the
 * lock and the administrator, and answers with documents the draft's response schemas accept.
 */
function fakeVta(options: { refuse?: Partial<Record<string, string>>; purpose?: string; unsigned?: boolean } = {}) {
  const sent: Record<string, unknown>[] = []
  let lock: string | undefined
  let step2: Record<string, unknown> | undefined
  const decisions: Record<string, unknown>[] = []
  const answer = (type: string, recipient: string, payload: Record<string, unknown>) => {
    S.response(type)(payload)
    return {
      id: `urn:uuid:answer-${sent.length}`,
      type: `${type}#response`,
      issuer: VTA,
      recipient,
      payload,
      ...(options.unsigned ? {} : { proof: fakeProof(`${VTA}#key-0`, 'assertionMethod') }),
    }
  }
  const step1 = () => ({
    requestId: ID,
    service: { did: VTA, name: 'The owner VTA' },
    origin: 'https://vta.example.org',
    purpose: options.purpose ?? 'deviceEnrol',
    decisionClosesAt: iso(T0 + 120_000),
  })
  const port = {
    async send(vtaDid: string, document: Record<string, unknown>): Promise<OobSendResult> {
      sent.push(document)
      const type = String(document.type)
      const payload = document.payload as Record<string, unknown>
      S.request(type)(payload)
      expect(vtaDid).toBe(VTA)
      if (options.refuse?.[type]) return { refused: options.refuse[type] as string }
      if (type === DEVICE_ENROL_TASK.claim) {
        lock = String(document.issuer)
        return { answer: answer(type, lock, step1()) }
      }
      expect(document.issuer).toBe(lock)
      if (type === DEVICE_ENROL_TASK.prove) {
        const identify = payload.identify as Record<string, unknown>
        S.request(DEVICE_ENROL_TASK.identify)(identify.payload)
        expect(identify).toMatchObject({ type: DEVICE_ENROL_TASK.identify, issuer: ADMIN, recipient: VTA })
        expect(identify.proof).toMatchObject({ proofPurpose: 'authentication' })
        expect(identify.payload).toMatchObject({ requestId: ID, approverKey: lock })
        // Two digits, as §7.2 and §11 Q8 have it: the draft's MatchNumber asks four (a stated difference).
        if ((identify.payload as { enteredNumber?: string }).enteredNumber !== NUMBER)
          return { refused: 'auth/oob/prove:numberMismatch' }
        step2 = answer(type, lock as string, {
          ...step1(),
          sessionKey: K_T,
          requester: {
            location: 'Somerville, US',
            browser: 'none',
            os: 'macOS',
            createdAt: iso(T0 - 5_000),
            sameNetwork: true,
          },
          identifiedAs: ADMIN,
          client: { consumerKind: { kind: 'service', serviceKind: 'aiAgent' }, displayName: 'Notes agent on a laptop' },
          requestedScope: {
            capabilities: [{ capability: 'memory-read' }, { capability: 'memory-write' }],
            purposes: { scope: 'listed', purposes: ['personalisation', 'taskExecution'] },
            keys: { scope: 'none' },
            maxLifetimeDays: 90,
          },
        })
        return { answer: step2 }
      }
      if (type === DEVICE_ENROL_TASK.respond) {
        const grant = payload.grant as Record<string, unknown>
        S.request(DEVICE_ENROL_TASK.grant)(grant.payload)
        expect(grant).toMatchObject({ type: DEVICE_ENROL_TASK.grant, issuer: ADMIN })
        expect(grant.proof).toMatchObject({ proofPurpose: 'assertionMethod' })
        const g = grant.payload as Record<string, unknown>
        if (g.contextDigest !== digestMultibase(step2)) return { refused: 'auth/oob/respond:contextMismatch' }
        decisions.push(g)
        return { answer: answer(type, lock as string, { status: g.decision === 'approve' ? 'approved' : 'declined' }) }
      }
      throw new Error(`unexpected ${type}`)
    },
  }
  return { port, sent, decisions }
}

/** A fake access port: the entry as the VTA lists it, and every write it was asked for. */
function fakeAccess(entry?: () => { entry: AccessEntry; deviceId?: string; kind?: string } | undefined) {
  const calls: { method: string; arg: unknown }[] = []
  const port: AgentAccessPort = {
    async grantApplication(grant) {
      calls.push({ method: 'grantApplication', arg: grant })
      return { entry: {} }
    },
    async findAgentEntries(query) {
      calls.push({ method: 'findAgentEntries', arg: query })
      const e = entry?.()
      return { complete: true, matches: e ? [e] : [] }
    },
    async narrowOrWidenCapabilities(change) {
      calls.push({ method: 'narrowOrWidenCapabilities', arg: change })
      return {}
    },
  }
  return { port, calls }
}

const choice = (memoryContexts = ['keyring-memory-aaaaaaaaaa']): AgentConnectChoice => ({
  name: 'Notes helper',
  ownerPersonaDid: PERSONA,
  memoryContexts,
  purposes: ['personalisation', 'taskExecution'],
})

const oobLink = (): PairingLink => ({ kind: 'oob', vtaDid: VTA, requestId: ID, exp: Math.floor(T0 / 1000) + 300 })

class Spent implements SpentRequestStore {
  public ids = new Set<string>()
  public async has(id: string) {
    return this.ids.has(id)
  }
  public async add(id: string) {
    this.ids.add(id)
  }
}

/** The real machine over the carriage, the fake VTA and a fake access port whose entry the test sets. */
function setup(vta = fakeVta()) {
  let now = T0
  const admin = administrator()
  let listed: { entry: AccessEntry; deviceId?: string; kind?: string } | undefined
  const access = fakeAccess(() => listed)
  const carriage = new PairingCarriage({
    oob: vta.port,
    verify: async (a, did) => a.issuer === did && !!a.proof,
    administrator: admin,
    access: access.port,
    newKey: () => newThrowawayKey(new Uint8Array(32).fill(7)),
  })
  const times: number[] = []
  const machine = new PairingMachine({
    clock: () => now,
    resolver: { administers: (d) => d === VTA, ownVta: () => VTA },
    transport: carriage,
    entries: accessEntryReader(access.port),
    spent: new Spent(),
    lockout: new PairingLockout(
      { load: async () => [...times], save: async (t) => void times.splice(0, times.length, ...t) },
      () => now
    ),
    takenHandles: () => [],
  })
  return {
    machine,
    vta,
    admin,
    access,
    times,
    list: (e: typeof listed) => (listed = e),
    advance: (ms: number) => (now += ms),
  }
}

/** The entry as the VTA lists it after the agent registered and swapped to K_a. */
const rotated = (contexts: string[], expiresAt: string): { entry: AccessEntry; deviceId: string; kind: string } => ({
  entry: {
    subject: K_A,
    role: 'application',
    act: { stated: 'contexts', contexts },
    capabilityScope: { stated: 'listed', capabilities: ['memory-read', 'memory-write'] },
    purposes: { scope: 'listed', purposes: ['personalisation', 'taskExecution'] },
    keys: { scope: 'none' },
    expiresAt,
  },
  deviceId: 'dev-1',
  kind: 'ai-agent',
})

describe(`DRAFT #1386 at ${DEVICE_ENROL_DRAFT_COMMIT.slice(0, 9)}: the deviceEnrol ceremony against a fake service`, () => {
  it('records the draft commit it was written against', () => {
    expect(readFileSync(join(DIR, 'DRAFT_COMMIT.sha'), 'utf8').trim()).toBe(DEVICE_ENROL_DRAFT_COMMIT)
  })

  it('claim, prove with identify, respond with the grant: every document in the draft shape, and the agent confirmed', async () => {
    const t = setup()
    await t.machine.start(choice())
    expect((await t.machine.scan(oobLink())).phase).toBe('awaitingNumber')
    await t.machine.enterNumber(NUMBER)
    expect(t.machine.state).toMatchObject({
      phase: 'awaitingApproval',
      disclosure: { starterDid: K_T, requester: 'Notes agent on a laptop', sameNetwork: true },
    })
    const s = await t.machine.approve()
    expect(s).toMatchObject({ phase: 'awaitingEnrolment', subject: K_T })
    expect(t.vta.sent.map((d) => d.type)).toEqual([
      DEVICE_ENROL_TASK.claim,
      DEVICE_ENROL_TASK.prove,
      DEVICE_ENROL_TASK.respond,
    ])
    expect(t.admin.signed).toEqual([
      { type: DEVICE_ENROL_TASK.identify, purpose: 'authentication' },
      { type: DEVICE_ENROL_TASK.grant, purpose: 'assertionMethod' },
    ])
    if (s.phase !== 'awaitingEnrolment') throw new Error(`not enrolling: ${s.phase}`)
    const expiresAt = s.scope.expiresAt
    expect(t.vta.decisions[0]).toMatchObject({
      purpose: 'deviceEnrol',
      decision: 'approve',
      sessionKey: K_T,
      aclScope: draftAclScope(s.scope).aclScope,
    })
    t.list(rotated(['keyring-memory-aaaaaaaaaa'], expiresAt))
    expect(await t.machine.checkEnrolment()).toMatchObject({
      phase: 'confirmed',
      agent: { agentDid: K_A, deviceId: 'dev-1', contexts: ['keyring-memory-aaaaaaaaaa'], contextsToAdd: [] },
    })
  })

  it('two memories chosen: the grant carries the first (the draft allows one), the second is left to add', async () => {
    const t = setup()
    await t.machine.start(choice(['keyring-memory-aaaaaaaaaa', 'keyring-memory-bbbbbbbbbb']))
    await t.machine.scan(oobLink())
    await t.machine.enterNumber(NUMBER)
    const s = (await t.machine.approve()) as { scope: { expiresAt: string } }
    expect((t.vta.decisions[0].aclScope as { contexts: string[] }).contexts).toEqual(['keyring-memory-aaaaaaaaaa'])
    // the entry holds the one granted context: that is what step 10 checks it against
    t.list(rotated(['keyring-memory-aaaaaaaaaa'], s.scope.expiresAt))
    expect(await t.machine.checkEnrolment()).toMatchObject({
      phase: 'confirmed',
      agent: { contexts: ['keyring-memory-aaaaaaaaaa'], contextsToAdd: ['keyring-memory-bbbbbbbbbb'] },
    })
  })

  it('a wrong number: declined by the service, no second try, counted toward the lockout', async () => {
    const t = setup()
    await t.machine.start(choice())
    await t.machine.scan(oobLink())
    await t.machine.enterNumber('43')
    expect(t.machine.state).toMatchObject({ phase: 'failed', reason: 'wrong-number' })
    expect(t.times).toHaveLength(1)
  })

  it("declining after the number: the draft's decline, a grant with no aclScope inside respond", async () => {
    const t = setup()
    await t.machine.start(choice())
    await t.machine.scan(oobLink())
    await t.machine.enterNumber(NUMBER)
    await t.machine.cancel()
    expect(t.vta.decisions).toHaveLength(1)
    expect(t.vta.decisions[0]).toMatchObject({ decision: 'decline' })
    expect(t.vta.decisions[0]).not.toHaveProperty('aclScope')
  })

  it('the grant is bound to the step 2 the owner saw: a different digest is refused', async () => {
    const t = setup()
    await t.machine.start(choice())
    await t.machine.scan(oobLink())
    await t.machine.enterNumber(NUMBER)
    // control on the binding: tamper with what the carriage stored from step 2
    const carriage = (
      t.machine as unknown as { deps: { transport: { requests: Map<string, { proved: { contextDigest: string } }> } } }
    ).deps.transport
    carriage.requests.get(ID)!.proved.contextDigest = 'zQmNotTheStep2Digest'
    expect(await t.machine.approve()).toMatchObject({ phase: 'failed', reason: 'grant-refused' })
  })

  it.each([
    ['unsupportedType', { phase: 'failed', reason: 'unsupported' }],
    ['auth/oob/claim:alreadyClaimed', { phase: 'failed', reason: 'spent' }],
  ])('a claim refused %s', async (code, expected) => {
    const t = setup(fakeVta({ refuse: { [DEVICE_ENROL_TASK.claim]: code } }))
    await t.machine.start(choice())
    expect(await t.machine.scan(oobLink())).toEqual(expected)
  })

  it('a VTA that serves no auth/oob is told as "We couldn\'t reach your VTA, so nothing changed."', () => {
    expect(PAIRING_FAILURE_COPY.unsupported).toBe("We couldn't reach your VTA, so nothing changed.")
  })

  it('an answer the VTA did not sign is not taken', async () => {
    const t = setup(fakeVta({ unsigned: true }))
    await t.machine.start(choice())
    expect(await t.machine.scan(oobLink())).toEqual({ phase: 'failed', reason: 'vta-unreachable' })
  })

  it('a login request scanned in Connect an agent is never enrolled, and nothing past the claim is sent', async () => {
    const t = setup(fakeVta({ purpose: 'login' }))
    await t.machine.start(choice())
    expect(await t.machine.scan(oobLink())).toMatchObject({ phase: 'failed', reason: 'not-a-pairing-code' })
    expect(t.vta.sent.map((d) => d.type)).toEqual([DEVICE_ENROL_TASK.claim])
  })

  it('control: the draft schema refuses an aclScope with two contexts, which is why the grant carries one', () => {
    const scope = draftAclScope({
      role: 'application',
      contexts: ['a'],
      capabilities: { scope: 'none' },
      keys: { scope: 'none' },
      purposes: ['personalisation'],
      expiresAt: iso(T0),
      label: 'x',
      consumerKind: 'ai-agent',
    }).aclScope
    const grantPayload = (contexts: string[]) => ({
      requestId: ID,
      purpose: 'deviceEnrol',
      decision: 'approve',
      sessionKey: K_T,
      approverKey: K_A,
      origin: 'https://vta.example.org',
      contextDigest: 'zQmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR',
      aclScope: { ...scope, contexts },
    })
    expect(() => S.request(DEVICE_ENROL_TASK.grant)(grantPayload(['a']))).not.toThrow()
    expect(() => S.request(DEVICE_ENROL_TASK.grant)(grantPayload(['a', 'b']))).toThrow()
  })
})

describe('the P0 fallback: acl/grant 0.3 for the agent did:key', () => {
  const scope = {
    role: 'application' as const,
    contexts: ['keyring-memory-aaaaaaaaaa', 'keyring-memory-bbbbbbbbbb'],
    capabilities: { scope: 'listed' as const, listed: ['memory-read', 'memory-write'] },
    keys: { scope: 'none' as const },
    purposes: ['personalisation' as const],
    expiresAt: iso(T0 + 4 * 3600_000),
    label: 'Notes helper',
    consumerKind: 'ai-agent' as const,
  }

  it('grants every chosen memory at once, for K_t', async () => {
    const t = setup()
    const carriage = new PairingCarriage({
      oob: t.vta.port,
      verify: async () => true,
      administrator: t.admin,
      access: t.access.port,
    })
    expect(await carriage.grantFallback(VTA, K_T, scope)).toEqual({ ok: true, subject: K_T })
    expect(t.access.calls).toEqual([
      {
        method: 'grantApplication',
        arg: {
          subject: K_T,
          contexts: scope.contexts,
          capabilities: ['memory-read', 'memory-write'],
          purposes: ['personalisation'],
          label: 'Notes helper',
          expiresAt: scope.expiresAt,
        },
      },
    ])
  })

  it.each([
    ['AgentAccessUnsupportedError', 'unreachable'],
    ['VtiRefusal', 'notAdministrator'],
  ])('%s is told as refused %s', async (name, refused) => {
    const access = fakeAccess()
    access.port.grantApplication = async () => {
      const e = new Error('no')
      e.name = name
      throw e
    }
    const carriage = new PairingCarriage({
      oob: fakeVta().port,
      verify: async () => true,
      administrator: administrator(),
      access: access.port,
    })
    expect(await carriage.grantFallback(VTA, K_T, scope)).toEqual({ ok: false, refused })
  })
})

describe('reading the entry back (step 10)', () => {
  it('maps an entry as VtaClient parses it, key scope included', () => {
    const [entry] = parseAclEntries([
      {
        subject: K_A,
        role: 'application',
        act: { scope: 'contexts', contexts: ['m'] },
        keys: { scope: 'none' },
        capabilities: { scope: 'listed', grants: [{ capability: 'memory-read' }] },
        purposes: { scope: 'listed', purposes: ['personalisation'] },
        expiresAt: iso(T0),
      },
    ])
    expect(entry.keys).toEqual({ scope: 'none' })
    const listed: ListedEntry = listedEntryFrom({ entry: entry as AccessEntry, deviceId: 'dev-1', kind: 'ai-agent' })
    expect(listed).toEqual({
      subject: K_A,
      deviceId: 'dev-1',
      consumerKind: 'ai-agent',
      role: 'application',
      contexts: ['m'],
      capabilities: { scope: 'listed', listed: ['memory-read'] },
      keys: { scope: 'none' },
      purposes: ['personalisation'],
      expiresAt: iso(T0),
    })
  })

  it('an entry whose key scope is not stated reads as unknown, which no limit check accepts', () => {
    expect(listedEntryFrom({ entry: { subject: K_A, role: 'application' } }).keys).toEqual({ scope: 'unknown' })
  })

  it('an empty listing that was not read to its end is "not reachable"; a complete empty one is "no entry"', async () => {
    const empty = (complete: boolean): AgentAccessPort => ({
      ...fakeAccess().port,
      findAgentEntries: async () => ({ complete, matches: [] }),
    })
    expect(await accessEntryReader(empty(false)).find({ subject: K_T })).toEqual({ reachable: false })
    expect(await accessEntryReader(empty(true)).find({ subject: K_T })).toEqual({ reachable: true })
  })
})

describe('completeEnrolment: the memories the draft grant could not carry', () => {
  const agent = { deviceId: 'dev-1', agentDid: K_A, contextsToAdd: ['b'] }
  const held = (contexts: string[]) => () => rotated(contexts, iso(T0))

  it('adds them with one acl/update, computed from the entry as read back', async () => {
    const a = fakeAccess(held(['a']))
    expect(await completeEnrolment(a.port, agent, ['a', 'b'])).toEqual({ complete: true })
    expect(a.calls.filter((c) => c.method === 'narrowOrWidenCapabilities')).toEqual([
      { method: 'narrowOrWidenCapabilities', arg: { subject: K_A, act: { from: ['a'], to: ['a', 'b'] } } },
    ])
  })

  it('is safe to re-send: an entry that already holds them is written nothing', async () => {
    const a = fakeAccess(held(['a', 'b']))
    expect(await completeEnrolment(a.port, agent, ['a', 'b'])).toEqual({ complete: true })
    expect(a.calls.some((c) => c.method === 'narrowOrWidenCapabilities')).toBe(false)
  })

  it('never re-adds a memory the owner removed since', async () => {
    const a = fakeAccess(held(['a']))
    expect(await completeEnrolment(a.port, agent, ['a'])).toEqual({ complete: true })
    expect(a.calls).toEqual([])
  })

  it('a failed write leaves the agent connected and says what is missing', async () => {
    const a = fakeAccess(held(['a']))
    a.port.narrowOrWidenCapabilities = async () => {
      throw new Error('offline')
    }
    expect(await completeEnrolment(a.port, agent, ['a', 'b'])).toEqual({ complete: false, missing: ['b'] })
  })
})
