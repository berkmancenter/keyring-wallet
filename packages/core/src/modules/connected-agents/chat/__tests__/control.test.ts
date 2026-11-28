/**
 * The control messages and the acceptance (backlog 2, fb-C3; plan §3.4, §3.9, §7.9): each of the vectors' six types
 * goes through fb-C2's envelope, Keyring's four out and the agent's two in; the acceptance is checked with
 * `verifyVdcPair` and stored only on `ok`; the revoked message and the grant write their intent before the send; and
 * the heartbeat moves the liveness state.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import { DidKey, TypedArrayEncoder, type Agent } from '@credo-ts/core'
import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'
import { ed25519 } from '@noble/curves/ed25519.js'

import { memoryGenericRecords } from '../../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'
import type { RevokeDeps } from '../../revoke'
import { AgentConnectionStore } from '../../store'
import { agentRecord, FIXTURE_NOW } from '../../testing/fixtures'
import type { AgentConnection } from '../../types'
import { buildVdcAcceptance, buildVdcGrant, type SignedVdc, vdcScopeFor } from '../../vdc'
import type { AgentChatHandler, AgentChatInbound, AgentChatPlaintext, CarrierResult } from '../carrier'
import {
  AgentControl,
  type AgentControlDeps,
  connectionState,
  type ControlReceipt,
  LIVENESS_WINDOW_MS,
  type LiveAgentConnection,
  VDC_ACCEPTANCE_TYPE,
} from '../control'
import {
  buildEnvelope,
  ENVELOPE_TYPE,
  type EnvelopeType,
  signEnvelope,
  type SignedEnvelope,
  verifyEnvelope,
} from '../envelope'
import { MemorySeenIdStore } from '../seenIds'

const logger = { info: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined }
const MINUTE = 60 * 1000

/** An agent that resolves any did:key locally and signs with one Ed25519 key (as fb-C2's tests). */
function didKeySigner() {
  const secret = ed25519.utils.randomSecretKey()
  const publicKey = ed25519.getPublicKey(secret)
  const did = `did:key:z${TypedArrayEncoder.toBase58(new Uint8Array([0xed, 0x01, ...publicKey]))}`
  const agent = {
    dids: {
      resolveDidDocument: async (d: string) => DidKey.fromDid(d).didDocument,
      getCreatedDids: async () => [],
    },
    dependencyManager: {
      resolve: () => ({
        sign: async ({ data }: { data: Uint8Array }) => ({ signature: ed25519.sign(data, secret) }),
      }),
    },
  }
  return { did, agent }
}

/** A VDC proof the test's verifier reads: who signed it. */
const signedBy = <T extends object>(vc: T, by: string) => ({ ...vc, proof: { by } }) as unknown as SignedVdc
const verifyVdc = async (credential: Record<string, unknown>, controller: string) =>
  (credential.proof as { by?: string } | undefined)?.by === controller

function setup(overrides: Partial<AgentControlDeps> = {}) {
  const keyring = didKeySigner()
  const theAgent = didKeySigner()
  const agent = { ...keyring.agent, genericRecords: memoryGenericRecords(), config: { logger } } as unknown as Agent
  const store = new AgentConnectionStore(agent)
  const sent: { record: AgentConnection; plaintext: AgentChatPlaintext }[] = []
  const handlers = new Set<AgentChatHandler>()
  let answer: (plaintext: AgentChatPlaintext) => Promise<CarrierResult> = async (plaintext) => ({
    result: 'sent',
    id: plaintext.id!,
  })
  const carrier = {
    send: jest.fn(async (record: AgentConnection, plaintext: AgentChatPlaintext) => {
      sent.push({ record, plaintext })
      return answer(plaintext)
    }),
    onMessage: jest.fn((handler: AgentChatHandler) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    }),
  }
  let now = FIXTURE_NOW
  const seen = new MemorySeenIdStore()
  const deps: AgentControlDeps = {
    agent,
    store,
    kms: { createDidKey: jest.fn(async () => keyring.did) },
    carrier: carrier as unknown as AgentControlDeps['carrier'],
    seen,
    verifyVdc,
    now: () => now,
    ...overrides,
  }
  const control = new AgentControl(deps)
  const record = agentRecord({ id: theAgent.did, agentDid: theAgent.did })

  /** The agent's side: verify what Keyring sent, as the plugin does. */
  const agentReads = (plaintext: AgentChatPlaintext, agentSeen = new MemorySeenIdStore()) =>
    verifyEnvelope(theAgent.agent as never, plaintext.body, {
      receiver: theAgent.did,
      issuer: keyring.did,
      seen: agentSeen,
      now: new Date(now),
    })

  /** The agent sends Keyring a document of `type`, signed by `signer` (the agent's own key by default). */
  const fromAgent = async (
    type: EnvelopeType,
    payload: Record<string, unknown>,
    options: { at?: number; signer?: ReturnType<typeof didKeySigner>; id?: string } = {}
  ): Promise<AgentChatInbound> => {
    const signer = options.signer ?? theAgent
    const unsigned = buildEnvelope({
      type,
      recipient: keyring.did,
      payload,
      id: options.id,
      now: new Date(options.at ?? now),
    })
    const envelope = await signEnvelope(signer.agent as never, unsigned, signer.did)
    const stored = await store.get(record.id)
    return {
      chatDid: keyring.did,
      record: stored,
      plaintext: { id: envelope.id, type: envelope.type, body: envelope } as unknown as DidCommV2PlaintextMessage,
    }
  }

  return {
    control,
    store,
    sent,
    carrier,
    handlers,
    seen,
    record,
    keyring,
    theAgent,
    agentReads,
    fromAgent,
    deps,
    advance: (ms: number) => {
      now += ms
    },
    now: () => now,
    answerWith: (next: typeof answer) => {
      answer = next
    },
  }
}

/** A connected record with a chat identity and a grant from its persona. */
async function connectedWithGrant(t: ReturnType<typeof setup>, overrides: Partial<AgentConnection> = {}) {
  const base = { ...t.record, chatDid: t.keyring.did, chatConnectionId: `agent-chat:${t.record.id}`, ...overrides }
  const grant = signedBy(
    buildVdcGrant({
      personaDid: base.ownerPersonaDid,
      agentDid: base.agentDid,
      scope: vdcScopeFor({ memory: true, roomAdded: false }),
      now: t.now(),
      entryExpiresAt: base.expiresAt,
    }),
    base.ownerPersonaDid
  )
  const record: AgentConnection = { ...base, vdcGrant: grant as unknown as Record<string, unknown> }
  await t.store.put(record)
  return { record, grant }
}

const body = (plaintext: AgentChatPlaintext) => plaintext.body as unknown as SignedEnvelope

describe("Keyring's four types round-trip through the envelope", () => {
  it('settings: answersOthers and the handle, signed by chatDid to agentDid, and the agent accepts it', async () => {
    const t = setup()
    await connectedWithGrant(t, { answersOthers: true })
    const result = await t.control.sendSettings(t.record.id, { locale: 'en' })
    expect(result).toMatchObject({ result: 'sent' })
    const [{ plaintext }] = t.sent
    expect(plaintext.type).toBe(ENVELOPE_TYPE.settings)
    expect(plaintext.id).toBe(body(plaintext).id)
    const check = await t.agentReads(plaintext)
    expect(check.result).toBe('ok')
    expect(body(plaintext).payload).toEqual({
      version: '1.0',
      answersOthers: true,
      handle: t.record.handle,
      locale: 'en',
    })
  })

  it('room offer: the offer as given (P1, no caller yet)', async () => {
    const t = setup()
    await connectedWithGrant(t)
    const offer = {
      roomId: 'did:webvh:QmRoom:rooms.example',
      hostDid: 'did:webvh:QmHost:h.example',
      tier: 'attributed',
    }
    expect(await t.control.sendRoomOffer(t.record.id, offer)).toMatchObject({ result: 'sent' })
    const [{ plaintext }] = t.sent
    expect((await t.agentReads(plaintext)).result).toBe('ok')
    expect(body(plaintext)).toMatchObject({ type: ENVELOPE_TYPE.roomOffer, payload: { ...offer, version: '1.0' } })
  })

  it('revoked: revokedAt, and the agent accepts it', async () => {
    const t = setup()
    await connectedWithGrant(t, { state: 'revoking' })
    await t.control.tellAgent({ id: t.record.id })
    const [{ plaintext }] = t.sent
    expect((await t.agentReads(plaintext)).result).toBe('ok')
    expect(body(plaintext)).toMatchObject({
      type: ENVELOPE_TYPE.revoked,
      payload: { revokedAt: new Date(FIXTURE_NOW).toISOString() },
    })
  })

  it('the grant: the stored vdcGrant, and the agent accepts it', async () => {
    const t = setup()
    const { grant } = await connectedWithGrant(t)
    expect(await t.control.sendVdcGrant(t.record.id)).toMatchObject({ result: 'sent' })
    const [{ plaintext }] = t.sent
    expect((await t.agentReads(plaintext)).result).toBe('ok')
    expect(body(plaintext)).toMatchObject({ type: ENVELOPE_TYPE.vdcGrant, payload: { vdc: grant } })
  })

  it('makes the chat identity when the record has none, and signs with it', async () => {
    const t = setup()
    await t.store.put(t.record)
    await t.control.sendSettings(t.record.id)
    expect(t.deps.kms.createDidKey).toHaveBeenCalledTimes(1)
    expect((await t.store.get(t.record.id))?.chatDid).toBe(t.keyring.did)
    expect(body(t.sent[0].plaintext).issuer).toBe(t.keyring.did)
  })

  it('tellAgent fits revokeAgentConnection’s deps', () => {
    const t = setup()
    const deps: RevokeDeps = { store: t.store as never, vta: {} as never, tellAgent: t.control.tellAgent }
    expect(deps.tellAgent).toBe(t.control.tellAgent)
  })
})

describe("settings and the room offer: newest wins at the agent's side", () => {
  it('two settings sent within one second are stamped a second apart, so the second is not olderState', async () => {
    const t = setup()
    await connectedWithGrant(t)
    await t.control.sendSettings(t.record.id)
    await t.store.update(t.record.id, (r) => ({ ...r, answersOthers: true }))
    t.advance(200)
    await t.control.sendSettings(t.record.id)
    const [first, second] = t.sent.map((s) => body(s.plaintext))
    expect(Date.parse(second.issuedAt) - Date.parse(first.issuedAt)).toBe(1000)

    // The agent applies them in order, as fb-C2's receiver does.
    const agentSeen = new MemorySeenIdStore()
    const apply = async (plaintext: AgentChatPlaintext) => {
      const check = await t.agentReads(plaintext, agentSeen)
      if (check.result === 'ok')
        await agentSeen.markApplied(t.theAgent.did, 'keyring/agent/settings', check.envelope.issuedAt)
      return check.result
    }
    expect(await apply(t.sent[0].plaintext)).toBe('ok')
    expect(await apply(t.sent[1].plaintext)).toBe('ok')
    expect(second.payload.answersOthers).toBe(true)
  })

  it('control: settings sent a minute apart keep their own times', async () => {
    const t = setup()
    await connectedWithGrant(t)
    await t.control.sendSettings(t.record.id)
    t.advance(MINUTE)
    await t.control.sendSettings(t.record.id)
    const [first, second] = t.sent.map((s) => body(s.plaintext))
    expect(Date.parse(second.issuedAt) - Date.parse(first.issuedAt)).toBe(MINUTE)
  })

  it('a send for a record that is gone is noRecord and sends nothing', async () => {
    const t = setup()
    expect(await t.control.sendSettings('did:key:z6MkGone')).toEqual({ result: 'noRecord' })
    expect(t.sent).toHaveLength(0)
  })
})

describe('the intent before an irreversible send', () => {
  it('revoked writes its intent before sending, and marks it sent after', async () => {
    const t = setup()
    await connectedWithGrant(t, { state: 'revoking' })
    let intentAtSend: unknown
    t.answerWith(async (plaintext) => {
      intentAtSend = await t.control.intentFor(t.record.id, ENVELOPE_TYPE.revoked)
      return { result: 'sent', id: plaintext.id! }
    })
    await t.control.tellAgent({ id: t.record.id })
    const id = body(t.sent[0].plaintext).id
    expect(intentAtSend).toMatchObject({ agentId: t.record.id, type: ENVELOPE_TYPE.revoked, id })
    expect(intentAtSend).not.toHaveProperty('sentAt')
    expect(await t.control.intentFor(t.record.id, ENVELOPE_TYPE.revoked)).toMatchObject({
      id,
      sentAt: expect.any(String),
    })
  })

  it('a revoked message the carrier did not take is resent by the repair, with the same id and revokedAt', async () => {
    const t = setup()
    await connectedWithGrant(t, { state: 'revoking' })
    t.answerWith(async () => ({ result: 'unreachable', reason: 'transport' }))
    await t.control.tellAgent({ id: t.record.id })
    // revokeAgentConnection moves on to revoked; the record is still there.
    await t.store.update(t.record.id, (r) => ({ ...r, state: 'revoked' }))

    t.answerWith(async (plaintext) => ({ result: 'sent', id: plaintext.id! }))
    t.advance(5 * MINUTE)
    expect(await t.control.resendPending()).toEqual({
      sent: [`${t.record.id} ${ENVELOPE_TYPE.revoked}`],
      pending: [],
      dropped: [],
    })
    const [first, again] = t.sent.map((s) => body(s.plaintext))
    expect(again.id).toBe(first.id)
    expect(again.payload.revokedAt).toBe(first.payload.revokedAt)
    // Once sent, the repair has nothing left.
    expect(await t.control.resendPending()).toEqual({ sent: [], pending: [], dropped: [] })
  })

  it('a send that throws (a crash in the send) leaves the intent for the repair', async () => {
    const t = setup()
    await connectedWithGrant(t)
    t.answerWith(async () => {
      throw new Error('crashed mid-send')
    })
    await expect(t.control.sendVdcGrant(t.record.id)).rejects.toThrow('crashed mid-send')
    const intent = await t.control.intentFor(t.record.id, ENVELOPE_TYPE.vdcGrant)
    expect(intent).toBeDefined()
    expect(intent).not.toHaveProperty('sentAt')

    t.answerWith(async (plaintext) => ({ result: 'sent', id: plaintext.id! }))
    expect((await t.control.resendPending()).sent).toEqual([`${t.record.id} ${ENVELOPE_TYPE.vdcGrant}`])
    expect(body(t.sent[1].plaintext).id).toBe(intent!.id)
  })

  it('the grant re-sent after a re-issue keeps its new id', async () => {
    const t = setup()
    const { record } = await connectedWithGrant(t)
    await t.control.sendVdcGrant(record.id)
    await t.control.sendVdcGrant(record.id) // a resend of the same grant
    const [first, resend] = t.sent.map((s) => body(s.plaintext))
    expect(resend.id).toBe(first.id)

    // The re-issue: a new grant, stored as reissueDueGrants stores it.
    t.advance(6 * 24 * 60 * MINUTE)
    const reissued = signedBy(
      buildVdcGrant({
        personaDid: record.ownerPersonaDid,
        agentDid: record.agentDid,
        scope: vdcScopeFor({ memory: true, roomAdded: false }),
        now: t.now(),
      }),
      record.ownerPersonaDid
    )
    await t.store.update(record.id, (r) => ({ ...r, vdcGrant: reissued as unknown as Record<string, unknown> }))
    await t.control.sendVdcGrant(record.id)
    await t.control.sendVdcGrant(record.id)
    const [, , afterReissue, resendAfter] = t.sent.map((s) => body(s.plaintext))
    expect(afterReissue.id).not.toBe(first.id)
    expect(afterReissue.payload.vdc).toEqual(reissued)
    expect(resendAfter.id).toBe(afterReissue.id)
  })

  it('a pending grant intent whose grant was re-issued since sends the current grant, under a new id', async () => {
    const t = setup()
    const { record } = await connectedWithGrant(t)
    t.answerWith(async () => ({ result: 'paced', retryAt: t.now() + 30_000, retryAfterMs: 30_000 }))
    await t.control.sendVdcGrant(record.id)
    const reissued = signedBy({ ...(record.vdcGrant as object), validFrom: '2026-11-27T00:00:00Z' }, 'x')
    await t.store.update(record.id, (r) => ({ ...r, vdcGrant: reissued as unknown as Record<string, unknown> }))
    t.answerWith(async (plaintext) => ({ result: 'sent', id: plaintext.id! }))
    await t.control.resendPending()
    const [first, current] = t.sent.map((s) => body(s.plaintext))
    expect(current.payload.vdc).toEqual(reissued)
    expect(current.id).not.toBe(first.id)
  })

  it('no grant goes to an agent that is not active, and the repair drops its intent', async () => {
    const t = setup()
    const { record } = await connectedWithGrant(t)
    t.answerWith(async () => ({ result: 'unreachable', reason: 'transport' }))
    await t.control.sendVdcGrant(record.id)
    await t.store.update(record.id, (r) => ({ ...r, state: 'revoking' }))
    expect(await t.control.sendVdcGrant(record.id)).toEqual({ result: 'notActive' })
    expect((await t.control.resendPending()).dropped).toEqual([`${record.id} ${ENVELOPE_TYPE.vdcGrant}`])
    expect(t.sent).toHaveLength(1)
    expect(await t.control.intentFor(record.id, ENVELOPE_TYPE.vdcGrant)).toBeUndefined()
  })

  it('control: a record with no grant has nothing to send', async () => {
    const t = setup()
    await t.store.put(t.record)
    expect(await t.control.sendVdcGrant(t.record.id)).toEqual({ result: 'noGrant' })
    expect(t.sent).toHaveLength(0)
  })
})

describe('the acceptance (step 7.9)', () => {
  it("is what the release gate's 7.9 condition reads: the type, in code, and a verifyVdcPair( call", () => {
    expect(VDC_ACCEPTANCE_TYPE).toBe(ENVELOPE_TYPE.vdcAcceptance)
    // The gate blanks comments before it looks; this strips them roughly, the same way round.
    const code = readFileSync(join(__dirname, '..', 'control.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(code).toContain(`'${ENVELOPE_TYPE.vdcAcceptance}'`)
    expect(code).toMatch(/\bverifyVdcPair\s*\(/)
  })

  it('a valid acceptance of the stored grant is verified as a pair and stored with store.update', async () => {
    const t = setup()
    const { grant } = await connectedWithGrant(t)
    const acceptance = signedBy(buildVdcAcceptance(grant, t.now()), t.theAgent.did)
    const receipt = await t.control.receive(await t.fromAgent(ENVELOPE_TYPE.vdcAcceptance, { vdc: acceptance }))
    expect(receipt).toEqual({ result: 'accepted', agentId: t.record.id })
    const stored = (await t.store.get(t.record.id)) as LiveAgentConnection
    expect(stored.vdcAcceptance).toEqual(acceptance)
    expect(stored.lastReplyAt).toBe(new Date(FIXTURE_NOW).toISOString())
    expect(await t.control.lastAcceptanceRefusal(t.record.id)).toBeUndefined()
  })

  it('a forged acceptance is refused, recorded as its reason, and leaves the record as it was', async () => {
    const t = setup()
    const { grant } = await connectedWithGrant(t)
    const forged = signedBy(buildVdcAcceptance(grant, t.now()), 'did:key:z6MkSomeoneElse')
    const before = await t.store.get(t.record.id)
    const receipt = await t.control.receive(await t.fromAgent(ENVELOPE_TYPE.vdcAcceptance, { vdc: forged }))
    expect(receipt).toEqual({ result: 'acceptanceRefused', agentId: t.record.id, reason: 'acceptance-proof' })
    const after = (await t.store.get(t.record.id)) as LiveAgentConnection
    expect(after.vdcAcceptance).toBeUndefined()
    expect(after).toEqual(before)
    expect(await t.control.lastAcceptanceRefusal(t.record.id)).toMatchObject({ reason: 'acceptance-proof' })
  })

  it('an envelope not signed by the agent is refused before anything acts', async () => {
    const t = setup()
    const { grant } = await connectedWithGrant(t)
    const acceptance = signedBy(buildVdcAcceptance(grant, t.now()), t.theAgent.did)
    const intruder = didKeySigner()
    const inbound = await t.fromAgent(ENVELOPE_TYPE.vdcAcceptance, { vdc: acceptance }, { signer: intruder })
    expect(await t.control.receive(inbound)).toMatchObject({ result: 'refused', refusal: 'proof' })
    expect((await t.store.get(t.record.id))?.vdcAcceptance).toBeUndefined()
  })

  it('control: an acceptance for another agent’s grant is refused', async () => {
    const t = setup()
    const { grant, record } = await connectedWithGrant(t)
    // The same persona's grant to another agent, to the same end.
    const otherGrant = signedBy(
      buildVdcGrant({
        personaDid: record.ownerPersonaDid,
        agentDid: 'did:key:z6MkAnotherAgent',
        scope: vdcScopeFor({ memory: true, roomAdded: false }),
        now: t.now(),
        entryExpiresAt: record.expiresAt,
      }),
      t.record.ownerPersonaDid
    )
    // Signed by this agent and naming the persona, as its own acceptance would, but accepting the other agent's grant.
    const ours = buildVdcAcceptance(grant, t.now())
    ours.credentialSubject.delegation.accepts = buildVdcAcceptance(
      otherGrant,
      t.now()
    ).credentialSubject.delegation.accepts
    const acceptance = signedBy(ours, t.theAgent.did)
    const receipt = await t.control.receive(await t.fromAgent(ENVELOPE_TYPE.vdcAcceptance, { vdc: acceptance }))
    expect(receipt).toMatchObject({ result: 'acceptanceRefused', reason: 'accepts-other-grant' })
    expect((await t.store.get(t.record.id))?.vdcAcceptance).toBeUndefined()
  })

  it('an acceptance for a record that is not active is refused as notActive', async () => {
    const t = setup()
    const { grant } = await connectedWithGrant(t, { state: 'revoking' })
    const acceptance = signedBy(buildVdcAcceptance(grant, t.now()), t.theAgent.did)
    const receipt = await t.control.receive(await t.fromAgent(ENVELOPE_TYPE.vdcAcceptance, { vdc: acceptance }))
    expect(receipt).toMatchObject({ result: 'acceptanceRefused', reason: 'notActive' })
    expect((await t.store.get(t.record.id))?.vdcAcceptance).toBeUndefined()
  })

  it('an acceptance with no grant stored is refused as noGrant', async () => {
    const t = setup()
    await t.store.put({ ...t.record, chatDid: t.keyring.did, chatConnectionId: `agent-chat:${t.record.id}` })
    const receipt = await t.control.receive(await t.fromAgent(ENVELOPE_TYPE.vdcAcceptance, { vdc: {} }))
    expect(receipt).toMatchObject({ result: 'acceptanceRefused', reason: 'noGrant' })
  })

  it('a refusal is not a throw: the same document again is repeated, not acted on', async () => {
    const t = setup()
    const { grant } = await connectedWithGrant(t)
    const forged = signedBy(buildVdcAcceptance(grant, t.now()), 'did:key:z6MkSomeoneElse')
    const inbound = await t.fromAgent(ENVELOPE_TYPE.vdcAcceptance, { vdc: forged })
    await t.control.receive(inbound)
    expect(await t.control.receive(inbound)).toMatchObject({ result: 'refused', refusal: 'repeated' })
  })
})

describe('the heartbeat and liveness (20 minutes)', () => {
  it('the heartbeat moves the state from notConnected to connected, and 20 minutes of silence back', async () => {
    const t = setup()
    await connectedWithGrant(t)
    expect(connectionState((await t.store.get(t.record.id))!, t.now())).toBe('notConnected')
    const receipt = await t.control.receive(
      await t.fromAgent(ENVELOPE_TYPE.heartbeat, { at: new Date(t.now()).toISOString() })
    )
    expect(receipt).toMatchObject({ result: 'heartbeat', agentId: t.record.id })
    const live = (await t.store.get(t.record.id)) as LiveAgentConnection
    expect(live.lastHeartbeatAt).toBe(new Date(FIXTURE_NOW).toISOString())
    expect(connectionState(live, t.now())).toBe('connected')
    expect(connectionState(live, t.now() + LIVENESS_WINDOW_MS)).toBe('connected')
    expect(connectionState(live, t.now() + LIVENESS_WINDOW_MS + 1000)).toBe('notConnected')
  })

  it('a heartbeat drained late counts from when it was issued, and never moves the time back', async () => {
    const t = setup()
    await connectedWithGrant(t)
    await t.control.receive(await t.fromAgent(ENVELOPE_TYPE.heartbeat, { at: 'x' }, { at: t.now() - 30 * MINUTE }))
    const late = (await t.store.get(t.record.id)) as LiveAgentConnection
    expect(late.lastHeartbeatAt).toBe(new Date(FIXTURE_NOW - 30 * MINUTE).toISOString())
    expect(connectionState(late, t.now())).toBe('notConnected')

    await t.control.receive(await t.fromAgent(ENVELOPE_TYPE.heartbeat, { at: 'x' }))
    await t.control.receive(await t.fromAgent(ENVELOPE_TYPE.heartbeat, { at: 'x' }, { at: t.now() - 40 * MINUTE }))
    expect(((await t.store.get(t.record.id)) as LiveAgentConnection).lastHeartbeatAt).toBe(
      new Date(FIXTURE_NOW).toISOString()
    )
  })

  it('a reply counts as much as a heartbeat; a time ahead of now counts as now', () => {
    const record = agentRecord()
    expect(
      connectionState({ ...record, lastReplyAt: new Date(FIXTURE_NOW - 5 * MINUTE).toISOString() }, FIXTURE_NOW)
    ).toBe('connected')
    expect(
      connectionState(
        { ...record, lastHeartbeatAt: new Date(FIXTURE_NOW + MINUTE).toISOString() },
        new Date(FIXTURE_NOW)
      )
    ).toBe('connected')
    expect(connectionState({ ...record, lastHeartbeatAt: 'not a date' }, FIXTURE_NOW)).toBe('notConnected')
  })

  it('control: the other writers of the record keep the liveness times', async () => {
    const t = setup()
    await connectedWithGrant(t)
    await t.control.receive(await t.fromAgent(ENVELOPE_TYPE.heartbeat, { at: 'x' }))
    await t.store.update(t.record.id, (r) => ({ ...r, answersOthers: true }))
    expect(((await t.store.get(t.record.id)) as LiveAgentConnection).lastHeartbeatAt).toBeDefined()
  })
})

describe('receiving', () => {
  it('start listens on the carrier once, and stop ends it', async () => {
    const t = setup()
    t.control.start()
    t.control.start()
    expect(t.handlers.size).toBe(1)
    await connectedWithGrant(t)
    const [handler] = [...t.handlers]
    await handler(await t.fromAgent(ENVELOPE_TYPE.heartbeat, { at: 'x' }))
    expect(((await t.store.get(t.record.id)) as LiveAgentConnection).lastHeartbeatAt).toBeDefined()
    t.control.stop()
    expect(t.handlers.size).toBe(0)
  })

  it('chat goes to the chat listeners and counts as a reply', async () => {
    const t = setup()
    await connectedWithGrant(t)
    const heard: string[] = []
    t.control.onChat(({ agentId, envelope }) => {
      heard.push(`${agentId} ${String(envelope.payload.eventId)}`)
    })
    const receipt = await t.control.receive(
      await t.fromAgent(ENVELOPE_TYPE.chat, { profile: 'keyring.chat/1', eventId: 'e1', type: 'message' })
    )
    expect(receipt).toEqual({ result: 'chat', agentId: t.record.id })
    expect(heard).toEqual([`${t.record.id} e1`])
    expect(((await t.store.get(t.record.id)) as LiveAgentConnection).lastReplyAt).toBeDefined()
  })

  it('chat with no listener throws, so it stays queued, and its next copy is acted on', async () => {
    const t = setup()
    await connectedWithGrant(t)
    const inbound = await t.fromAgent(ENVELOPE_TYPE.chat, { profile: 'keyring.chat/1', eventId: 'e1', type: 'message' })
    await expect(t.control.receive(inbound)).rejects.toThrow(/no chat listener/)
    t.control.onChat(() => undefined)
    expect(await t.control.receive(inbound)).toMatchObject({ result: 'chat' })
  })

  it('a type Keyring only sends is notForKeyring, and acts on nothing', async () => {
    const t = setup()
    await connectedWithGrant(t)
    const before = await t.store.get(t.record.id)
    const receipt = await t.control.receive(await t.fromAgent(ENVELOPE_TYPE.revoked, { revokedAt: 'x' }))
    expect(receipt).toEqual({ result: 'notForKeyring', agentId: t.record.id, type: ENVELOPE_TYPE.revoked })
    expect(await t.store.get(t.record.id)).toEqual(before)
  })

  it('another major is a versionMismatch receipt, and is never acted on', async () => {
    const t = setup()
    await connectedWithGrant(t)
    const receipts: ControlReceipt[] = []
    t.control.onReceipt((r) => receipts.push(r))
    const inbound = await t.fromAgent(ENVELOPE_TYPE.heartbeat, { at: 'x' })
    const envelope = inbound.plaintext.body as unknown as SignedEnvelope
    const v2 = await signEnvelope(
      t.theAgent.agent as never,
      { ...envelope, payload: { ...envelope.payload, version: '2.0' } },
      t.theAgent.did
    )
    await t.control.receive({ ...inbound, plaintext: { ...inbound.plaintext, body: v2 as never } })
    expect(receipts).toEqual([
      expect.objectContaining({ result: 'refused', refusal: 'versionMismatch', agentId: t.record.id }),
    ])
    expect(((await t.store.get(t.record.id)) as LiveAgentConnection).lastHeartbeatAt).toBeUndefined()
  })

  it('a message for a chatDid no record holds is dropped, never acted on', async () => {
    const t = setup()
    const inbound = await t.fromAgent(ENVELOPE_TYPE.heartbeat, { at: 'x' })
    expect(await t.control.receive({ ...inbound, record: undefined })).toEqual({
      result: 'noRecord',
      chatDid: t.keyring.did,
    })
  })
})
