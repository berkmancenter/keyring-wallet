/** The scanner's shared-connect session against a scripted fake inviter (plan WP6, WP7, WP10, WP13 local rung). */
import * as issue from '@openvtc/trust-tasks/vrc/relationships/issue/0.1/payload'
import * as propose from '@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload'

import { digestMultibase } from '../documentProof'
import { SharedConnectSession, type SharedConnectDeps } from '../module/sharedConnect'
import { SHARED_CONNECT_ANSWER_WAIT_MS, SHARED_CONNECT_EXP_GRACE_MS } from '../module/sharedConnectDecisions'
import type { EncounterRecord } from '../module/sharedConnectEncounter'

import { ENCOUNTER_ID, NOW } from './fixtures/sharedConnectFixtures'

jest.mock('../../vrc/witnessStatusStore', () => ({
  vrcFlowStore: { setDialect: jest.fn(), setStatus: jest.fn(), clearFlow: jest.fn() },
}))
jest.mock('../../vrc/vrc-manager', () => ({ getOrCreateRelationshipDid: jest.fn() }))
jest.mock('../services/TrustTaskDocumentRepository', () => ({ TrustTaskDocumentRepository: class {} }))

const THEIR_VID = 'did:peer:2.inviterVid'
const MY_VID = 'did:peer:2.myVid'
const THEIR_REL = 'did:peer:0inviterRel'
const MY_REL = 'did:peer:0myRel'

const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() }
const agent = { config: { logger } } as never

const encounter = (over: Partial<EncounterRecord> = {}): EncounterRecord => ({
  enactment: ENCOUNTER_ID,
  myVid: MY_VID,
  theirVid: THEIR_VID,
  carriage: 'tsp',
  relay: 'did:peer:2.mediator',
  exp: NOW + 600,
  state: 'confirmed',
  createdAt: new Date(NOW * 1000).toISOString(),
  ...over,
})

/** A signed-looking document: the fake "proof" names its signer, which the fake verifier checks. */
const signAs = (signer: string) => async (d: Record<string, unknown>) => ({ ...d, proof: { signer } })

const setup = (over: Partial<SharedConnectDeps> = {}, enc = encounter()) => {
  const sent: Record<string, unknown>[] = []
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = []
  let now = NOW * 1000
  const stored: Record<string, unknown>[] = []
  const deps: SharedConnectDeps = {
    now: () => now,
    randomBytes: () => new Uint8Array(16).fill(9),
    setTimer: (fn, ms) => {
      const t = { fn, ms, cleared: false }
      timers.push(t)
      return t
    },
    clearTimer: (h) => void ((h as { cleared: boolean }).cleared = true),
    relationshipDidFor: async () => MY_REL,
    recordTheirRelationshipDid: async () => undefined,
    issueVrc: async (mine, theirs) => ({
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      issuer: mine,
      credentialSubject: { id: theirs },
      proof: { cryptosuite: 'eddsa-jcs-2022' },
    }),
    verifyVrc: async () => true,
    verifyProof: async (d, signers) => signers.includes((d.proof as { signer: string }).signer),
    storeVrc: async (vc) => void stored.push(vc) === undefined,
    sign: signAs(MY_VID),
    validate: async () => true,
    retain: async () => undefined,
    persist: async () => undefined,
    ...over,
  }
  const session = new SharedConnectSession(agent, enc, { send: async (d) => void sent.push(d) }, deps)
  return { session, sent, timers, stored, advance: (ms: number) => void (now += ms), deps }
}

/** The inviter's documents, as it would send them. */
const fromInviter = (propose0: Record<string, unknown>) => {
  const threadId = propose0.id as string
  const base = (type: string, step: number, payload: unknown, id: string) => ({
    id,
    type,
    threadId,
    issuer: THEIR_VID,
    recipient: MY_VID,
    issuedAt: '2026-11-05T00:00:00Z',
    ceremony: { enactment: ENCOUNTER_ID, step, definition: 'https://trusttasks.org/ceremony/shared-connect/0.1' },
    payload,
    proof: { signer: THEIR_VID },
  })
  const vc = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    issuer: THEIR_REL,
    credentialSubject: { id: MY_REL },
    proof: { cryptosuite: 'eddsa-jcs-2022' },
  }
  return {
    response: base(`${propose.TYPE_URI}#response`, 2, { accept: true, relationshipDid: THEIR_REL }, 'r1'),
    issue: base(issue.TYPE_URI, 3, { vrc: vc, vrcDigestMultibase: digestMultibase(vc) }, 'i1'),
    receiptFor: (mine: Record<string, unknown>) =>
      base(
        `${issue.TYPE_URI}#response`,
        6,
        {
          vrcDigestMultibase:
            (mine.payload as { vrc: unknown }).vrc && digestMultibase((mine.payload as { vrc: unknown }).vrc),
        },
        'rc1'
      ),
    vc,
  }
}

describe('the scanner session', () => {
  it('proposes first, with a challenge-shaped id, the ceremony member and a proof', async () => {
    const { session, sent } = setup()
    await session.start()
    expect(sent).toHaveLength(1)
    const doc = sent[0] as Record<string, any>
    expect(doc.type).toBe(propose.TYPE_URI)
    expect(doc.id).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(doc.threadId).toBe(doc.id)
    expect(doc.issuer).toBe(MY_VID)
    expect(doc.recipient).toBe(THEIR_VID)
    // {enactment, step}: a string step and no `definition`, as the registry envelope requires.
    expect(doc.ceremony).toEqual({ enactment: ENCOUNTER_ID, step: 'propose' })
    expect(doc.proof).toBeDefined()
    expect(doc.payload).toEqual({ relationshipDid: MY_REL, witnessed: false })
  })

  it('runs the six documents to completion', async () => {
    const { session, sent, stored } = setup()
    await session.start()
    const inviter = fromInviter(sent[0])
    await session.handle(inviter.response)
    await session.handle(inviter.issue)
    // step 4 receipt then step 5 issue
    expect(sent.map((d) => [d.type, (d.ceremony as { step: string }).step])).toEqual([
      [propose.TYPE_URI, 'propose'],
      [`${issue.TYPE_URI}#response`, 'issue-inviter'],
      [issue.TYPE_URI, 'issue-responder'],
    ])
    expect(sent.every((d) => d.threadId === sent[0].id && d.proof)).toBe(true)
    expect((sent[1].payload as { vrcDigestMultibase: string }).vrcDigestMultibase).toBe(digestMultibase(inviter.vc))
    expect(stored).toEqual([inviter.vc])
    await session.handle(inviter.receiptFor(sent[2]))
    await expect(session.finished).resolves.toBe('completed')
  })

  it('takes an issue that overtook the propose response', async () => {
    const { session, sent } = setup()
    await session.start()
    const inviter = fromInviter(sent[0])
    await session.handle(inviter.issue)
    expect(sent).toHaveLength(1)
    await session.handle(inviter.response)
    expect(sent).toHaveLength(3)
  })

  it('drops documents from another enactment, thread, or without a valid proof', async () => {
    const { session, sent } = setup()
    await session.start()
    const inviter = fromInviter(sent[0])
    await session.handle({ ...inviter.response, ceremony: { ...inviter.response.ceremony, enactment: 'other' } })
    await session.handle({ ...inviter.response, threadId: 'other' })
    await session.handle({ ...inviter.response, proof: undefined })
    await session.handle({ ...inviter.response, proof: { signer: 'did:peer:2.mallory' } })
    await session.handle(inviter.issue)
    expect(sent).toHaveLength(1)
    expect(session.outcome).toBeUndefined()
  })

  it('drops a document the framework pipeline rejects', async () => {
    const { session, sent } = setup({ validate: async () => false })
    await session.start()
    const inviter = fromInviter(sent[0])
    await session.handle(inviter.response)
    await session.handle(inviter.issue)
    expect(sent).toHaveLength(1)
    expect(session.outcome).toBeUndefined()
  })

  it('refuses an issue whose subject is not us, with a signed notAccepted error', async () => {
    const { session, sent } = setup()
    await session.start()
    const inviter = fromInviter(sent[0])
    await session.handle(inviter.response)
    const bad = {
      ...inviter.issue,
      payload: { vrc: { ...inviter.vc, credentialSubject: { id: 'did:peer:0someoneElse' } } },
    }
    await session.handle(bad)
    const error = sent[1] as Record<string, any>
    expect(error.type).toContain('trust-task-error')
    expect(error.payload.code).toContain('notAccepted')
    expect(error.proof).toBeDefined()
    expect(error.ceremony).toMatchObject({ enactment: ENCOUNTER_ID })
    await expect(session.finished).resolves.toBe('refused')
  })

  it('refuses a credential whose proof does not verify', async () => {
    const { session, sent } = setup({ verifyVrc: async () => false })
    await session.start()
    const inviter = fromInviter(sent[0])
    await session.handle(inviter.response)
    await session.handle(inviter.issue)
    await expect(session.finished).resolves.toBe('refused')
  })

  it('ends declined on a propose:declined error', async () => {
    const { session, sent } = setup()
    await session.start()
    const inviter = fromInviter(sent[0])
    await session.handle({
      ...inviter.response,
      type: 'https://trusttasks.org/spec/trust-task-error/0.1',
      payload: {
        code: 'https://trusttasks.org/spec/vrc/relationships/propose/0.1#declined',
        message: 'no',
        retryable: false,
      },
    })
    await expect(session.finished).resolves.toBe('declined')
  })

  it('repeats its receipt when the same issue is delivered again, without storing twice', async () => {
    const { session, sent, stored } = setup()
    await session.start()
    const inviter = fromInviter(sent[0])
    await session.handle(inviter.response)
    await session.handle(inviter.issue)
    const before = sent.length
    await session.handle(inviter.issue)
    expect(sent).toHaveLength(before + 1)
    expect(sent[sent.length - 1].type).toBe(`${issue.TYPE_URI}#response`)
    expect(stored).toHaveLength(1)
  })

  it('ignores a receipt whose digest matches no delivery of ours', async () => {
    const { session, sent } = setup()
    await session.start()
    const inviter = fromInviter(sent[0])
    await session.handle(inviter.response)
    await session.handle(inviter.issue)
    const receipt = inviter.receiptFor(sent[2]) as Record<string, any>
    await session.handle({ ...receipt, id: 'rc2', payload: { vrcDigestMultibase: 'zWrong' } })
    expect(session.outcome).toBeUndefined()
  })

  describe('timeouts and expiry', () => {
    it('re-sends the same propose once, then reports unanswered, not failed', async () => {
      const { session, sent, timers } = setup()
      await session.start()
      timers[1].fn() // answer wait elapsed (timers[0] is the expiry)
      await Promise.resolve()
      await Promise.resolve()
      expect(sent).toHaveLength(2)
      expect(sent[1]).toBe(sent[0])
      const wait = timers.filter((t) => !t.cleared && t.ms === SHARED_CONNECT_ANSWER_WAIT_MS).pop()
      wait?.fn()
      await new Promise((r) => setImmediate(r))
      expect(session.outcome).toBe('unanswered')
    })

    it('takes a late answer after unanswered', async () => {
      const { session, sent, timers } = setup()
      await session.start()
      timers[1].fn()
      await new Promise((r) => setImmediate(r))
      timers
        .filter((t) => !t.cleared && t.ms === SHARED_CONNECT_ANSWER_WAIT_MS)
        .pop()
        ?.fn()
      await new Promise((r) => setImmediate(r))
      expect(session.outcome).toBe('unanswered')
      const inviter = fromInviter(sent[0])
      await session.handle(inviter.response)
      await session.handle(inviter.issue)
      await session.handle(inviter.receiptFor(sent[sent.length - 1]))
      await expect(session.finished).resolves.toBe('completed')
    })

    it('tells a watcher about unanswered, the retry (waiting again) and a stop', async () => {
      const { session, sent, timers } = setup()
      const seen: string[] = []
      const stop = session.subscribe((state) => seen.push(state))
      await session.start()
      timers[1].fn()
      await new Promise((r) => setImmediate(r))
      timers
        .filter((t) => !t.cleared && t.ms === SHARED_CONNECT_ANSWER_WAIT_MS)
        .pop()
        ?.fn()
      await new Promise((r) => setImmediate(r))
      await session.retry()
      expect(sent[sent.length - 1]).toBe(sent[0])
      await session.cancel()
      expect(seen).toEqual(['unanswered', 'waiting', 'failed'])
      stop()
    })

    it('does not start on an expired link', async () => {
      const { session, sent } = setup({}, encounter({ exp: NOW - 1 }))
      await session.start()
      expect(sent).toHaveLength(0)
      await expect(session.finished).resolves.toBe('expired')
    })

    it('expires after _exp plus the grace period', async () => {
      const { session, timers, advance } = setup()
      await session.start()
      expect(timers[0].ms).toBe(600_000 + SHARED_CONNECT_EXP_GRACE_MS)
      advance(900_001 + 1)
      timers[0].fn()
      await expect(session.finished).resolves.toBe('expired')
    })

    it('keeps trying to send when the carriage throws, and does not fail', async () => {
      const calls: number[] = []
      const { deps } = setup()
      const session = new SharedConnectSession(
        agent,
        encounter(),
        {
          send: async () => {
            calls.push(1)
            throw new Error('relay down')
          },
        },
        deps
      )
      await session.start()
      expect(calls).toHaveLength(1)
      expect(session.outcome).toBeUndefined()
    })
  })

  it('never logs a label or reason', async () => {
    const { session, sent } = setup()
    await session.start()
    const inviter = fromInviter(sent[0])
    await session.handle({
      ...inviter.response,
      payload: { accept: true, relationshipDid: THEIR_REL, reason: 'SENTINEL-REASON' },
    })
    const logged = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls])
    expect(logged).not.toContain('SENTINEL-REASON')
  })
})
