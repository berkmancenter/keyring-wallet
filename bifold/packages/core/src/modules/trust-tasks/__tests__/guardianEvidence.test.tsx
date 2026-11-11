/**
 * A state Guardian card carried from the approver's phone to the person's (approver/guardian-evidence/0.1) and checked
 * there with sedi/guardian's verifyGuardian, over the K0 kit's real chain (sedi/__tests__/fixtures/k0-utah-v2). Each
 * refusal has a control that differs from it in the one thing refused; the screen rows render the real Who approves
 * over the same stored records.
 *
 * The K0 Guardian credential expires 2030-11-10; these rows read the real clock.
 */
import { useFocusEffect } from '@react-navigation/native'
import { act, fireEvent, render } from '@testing-library/react-native'
import { readFileSync } from 'fs'
import { join } from 'path'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'
import { trustTaskPayloadValidator } from '@bifold/trust-tasks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import * as guardianModule from '../../sedi/guardian'
import * as stateRoots from '../../sedi/guardian/stateRoots'
import * as approverRole from '../approverRole'
import {
  GUARDIAN_EVIDENCE_MAX_BYTES,
  GUARDIAN_EVIDENCE_SPEC,
  GUARDIAN_EVIDENCE_TYPE_URI,
  TYPE_URI,
  type GuardianEvidencePayload,
} from '../approverRoleSpec'
import {
  GUARDIAN_CARD_CONSENT,
  GUARDIAN_EVIDENCE_HELD,
  becomeK0TestWard,
  cardConsentOn,
  cardQuestions,
  guardianCardAfterYes,
  setCardConsent,
  shareGuardianCard,
  checkGuardianEvidence,
  heldGuardianEvidence,
  holdK0TestGuardianCard,
  stateWardOf,
  evidenceBytes,
  resetGuardianCheckMemo,
  guardianStandings,
  handleGuardianEvidence,
  holdGuardianEvidence,
  sendGuardianEvidence,
  setStateWard,
  type GuardianEvidence,
  type GuardianOnAsk,
} from '../guardianEvidence'
import { SEDI_KERI_REMOTE_OFF } from '../module/sediKeriRemoteOff'
import {
  STATE_VERIFIED_APPROVERS_REMOTE_OFF,
  setStateVerifiedApproversEnabled,
} from '../module/stateVerifiedApproversFlag'
import { TRUSTED_APPROVERS_REMOTE_OFF, setTrustedApproversEnabled } from '../module/trustedApproversFlag'
import { setTrustTestStateEnabled } from '../module/trustTestStateFlag'
import { vtaAgent, type TrustedApproversState } from '../module/vtaAgent'
import ApproverOfferModal, { ApproverOfferIds } from '../components/ApproverOfferModal'
import VtaTrustedApprovers, { TrustedApproversIds } from '../screens/VtaTrustedApprovers'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('../documentProof', () => ({
  signDocumentProof: jest.fn(async (_agent: unknown, doc: Record<string, unknown>) => ({ ...doc, proof: { p: 1 } })),
  verifyDocumentProof: jest.fn(async () => true),
}))
const sent: Record<string, unknown>[] = []
jest.mock('../ceremony', () => ({
  getTrustTasksService: () => ({ retain: jest.fn(async () => undefined) }),
  sendTrustTaskDocument: jest.fn(async (_agent: unknown, _conn: string, doc: Record<string, unknown>) => {
    sent.push(doc)
  }),
}))

// ---------------------------------------------------------------------------------------------------------------
// The K0 chain

const FX = join(__dirname, '..', '..', 'sedi', '__tests__', 'fixtures', 'k0-utah-v2')
const text = (f: string) => readFileSync(join(FX, f), 'utf8')
const prov = JSON.parse(text('PROVENANCE.json')) as {
  aids: Record<string, string>
  creds: Record<string, { said: string }>
}
const SAM_WARD = prov.aids.sam
const OTHER_WARD = prov.aids['other-ward']
const JORDAN_AID = prov.aids.jordan

const tel = (stem: string, states: string[]) => ({
  ripText: text(`tel-${stem}-rip.json`),
  updateTexts: states.map((s) => text(`tel-${stem}-${s}.json`)),
})
/** The card for one of K0's Guardian credentials, with exactly the chain it needs. */
function card(name: 'G-ok' | 'G-revoked' | 'G-untrusted'): GuardianEvidence {
  const mal = name === 'G-untrusted'
  const [unit, agent] = mal ? ['mal-unit', 'mal-agent'] : ['unit', 'agent']
  const states = name === 'G-revoked' ? ['issued', 'revoked'] : ['issued']
  return {
    guardianSaid: prov.creds[name].said,
    holder: JORDAN_AID,
    kels: (mal ? ['mal-root', 'mal-org', 'mal-agent', 'jordan'] : ['roy', 'deb', 'sue', 'jordan']).map((k) =>
      text(`kel-${k}.cesr`)
    ),
    tels: [tel(unit, ['issued']), tel(agent, ['issued']), tel(name, states)],
    creds: [
      text(`acdc-${unit}-issued-proofed.cesr`),
      text(`acdc-${agent}-issued-proofed.cesr`),
      text(`acdc-${name}-${states[states.length - 1]}-proofed.cesr`),
    ],
  }
}

// ---------------------------------------------------------------------------------------------------------------
// A phone

const SAM_AGENT = 'did:webvh:sams-agent.example'
const JORDAN = 'did:peer:2.jordans-phone'
const AMY = 'did:peer:2.amys-phone'
const CONN = 'c-jordan'
/** A second person on the same phone (Amy), on her own connection. */
const CONN2 = 'c-amy'

type Row = { id: string; content: Record<string, unknown>; tags: Record<string, string> }

function phone() {
  const rows: Row[] = []
  /** The relationships this phone has, by connection; a test may rotate a DID in place. */
  const relationships = [
    { connectionId: CONN, myRelationshipDid: 'did:peer:2.mine', counterpartyRelationshipDid: 'did:peer:2.theirs' },
    { connectionId: CONN2, myRelationshipDid: 'did:peer:2.mine-amy', counterpartyRelationshipDid: 'did:peer:2.amy' },
  ]
  let n = 0
  const warn = jest.fn()
  const update = jest.fn(async (record: Row) => {
    const i = rows.findIndex((r) => r.id === record.id)
    rows[i] = { ...record, content: JSON.parse(JSON.stringify(record.content)) }
  })
  const consume = jest.fn(async (_ctx: unknown, _opts: { document: Record<string, unknown> }) => ({
    kind: 'handled' as const,
  }))
  const agent = {
    context: {},
    config: { logger: { warn, info: jest.fn() } },
    genericRecords: {
      findAllByQuery: jest.fn(async (query: Record<string, string>) =>
        rows
          .filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v))
          .map((r) => ({ ...r, content: JSON.parse(JSON.stringify(r.content)) }))
      ),
      save: jest.fn(async ({ content, tags }: { content: Record<string, unknown>; tags: Record<string, string> }) => {
        rows.push({ id: `r${++n}`, content: JSON.parse(JSON.stringify(content)), tags })
      }),
      update,
      deleteById: jest.fn(),
      delete: jest.fn(),
    },
    dependencyManager: {
      resolve: () => ({ getAll: async () => relationships.map((r) => ({ ...r })) }),
    },
    modules: { didcomm: { connections: { getById: async () => ({ did: 'did:peer:me', theirDid: 'did:peer:them' }) } } },
    kms: { randomBytes: ({ length }: { length: number }) => new Uint8Array(length).fill(7) },
  }
  const service = { consume } as never
  const ask = (over: Partial<approverRole.RoleOfferAsk> = {}) =>
    rows.push({
      id: `r${++n}`,
      tags: { recordType: approverRole.ROLE_OFFER_ASK, connectionId: CONN },
      content: {
        state: 'accepted',
        connectionId: CONN,
        threadId: 't-1',
        agentDid: SAM_AGENT,
        actions: ['joinCommunity'],
        challenge: 'c'.repeat(43),
        askedAt: new Date().toISOString(),
        acceptedAs: JORDAN,
        ...over,
      },
    })
  const askRecord = () =>
    rows.find((r) => r.tags.recordType === approverRole.ROLE_OFFER_ASK)?.content as unknown as approverRole.RoleOfferAsk
  return { agent: agent as never, rows, warn, update, consume, service, ask, askRecord, raw: agent, relationships }
}

const documentOf = (evidence: GuardianEvidence, over: Partial<GuardianEvidencePayload> = {}) => ({
  id: 'doc-1',
  type: GUARDIAN_EVIDENCE_TYPE_URI,
  threadId: 'doc-1',
  issuer: 'did:peer:them',
  recipient: 'did:peer:me',
  issuedAt: new Date().toISOString(),
  payload: { agent: SAM_AGENT, approver: JORDAN, ...evidence, sentAt: new Date().toISOString(), ...over },
})
const schemaTakes = (payload: unknown) =>
  trustTaskPayloadValidator.validate(GUARDIAN_EVIDENCE_SPEC.payloadSchema, payload) === true
const context = { connectionId: CONN, recipientDid: 'did:peer:me', senderDid: 'did:peer:them' } as never

/** Sam's phone, its ward set to `ward` (null: none set), an accepted ask from Jordan, and `evidence` arriving. */
async function arrives(evidence: GuardianEvidence, ward: string | null = SAM_WARD, over = {}) {
  const sam = phone()
  if (ward !== null) await setStateWard(sam.agent, ward)
  sam.ask()
  await handleGuardianEvidence(sam.agent, sam.service, documentOf(evidence, over), context)
  return sam
}

const allOn = () => {
  setTrustedApproversEnabled(true)
  setStateVerifiedApproversEnabled(true)
  TRUSTED_APPROVERS_REMOTE_OFF.off = false
  STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
}

beforeEach(() => {
  jest.restoreAllMocks()
  sent.length = 0
  cardQuestions.reset()
  approverRole.roleOfferPromptStore.clear()
  allOn()
  // Each row is a fresh run of the app: record ids repeat across rows (r1, r2, …), so nothing memoised carries over.
  resetGuardianCheckMemo()
})
afterAll(() => {
  setTrustedApproversEnabled(false)
  setStateVerifiedApproversEnabled(false)
})

// ---------------------------------------------------------------------------------------------------------------

describe('the card and its cap', () => {
  test('the K0 chain is 13,234 bytes of raw text and well under the cap', () => {
    const c = card('G-ok')
    const raw = [...c.kels, ...c.tels.flatMap((t) => [t.ripText, ...t.updateTexts]), ...c.creds]
    expect(raw.reduce((sum, s) => sum + Buffer.byteLength(s, 'utf8'), 0)).toBe(13234)
    expect(evidenceBytes(c)).toBeLessThan(GUARDIAN_EVIDENCE_MAX_BYTES / 2)
  })

  test("the schema takes the K0 card and refuses one text over the cap or an extra field (control: K0's passes)", () => {
    expect(schemaTakes(documentOf(card('G-ok')).payload)).toBe(true)
    const big = { ...card('G-ok'), creds: ['x'.repeat(GUARDIAN_EVIDENCE_MAX_BYTES + 1)] }
    expect(schemaTakes(documentOf(big).payload)).toBe(false)
    expect(schemaTakes({ ...documentOf(card('G-ok')).payload, state: 'Utah' })).toBe(false)
  })

  test('a release trusts no root; a Developer build, or the test-state setting, only the K0 test root', () => {
    expect(stateRoots.stateRootsFor(false, false)).toEqual([])
    expect(stateRoots.stateRootsFor(true, false)).toEqual([stateRoots.K0_TEST_ROOT])
    expect(stateRoots.stateRootsFor(false, true)).toEqual([stateRoots.K0_TEST_ROOT])
    expect(stateRoots.stateRootsFor(true, true)).toEqual([stateRoots.K0_TEST_ROOT])
    expect(stateRoots.K0_TEST_ROOT.aid).toBe(JSON.parse(text('PROVENANCE.json')).trustedRoot)
    expect(stateRoots.K0_TEST_WARD).toBe(SAM_WARD)
  })
})

describe("on the person's phone: a card arrives", () => {
  test('a valid K0 card is kept on the ask in place, valid, named by our list', async () => {
    const sam = await arrives(card('G-ok'))
    expect(sam.consume).toHaveBeenCalledTimes(1)
    expect(sam.askRecord().guardian?.verdict).toMatchObject({ ok: true, state: 'Test state (K0)' })
    expect(sam.askRecord().guardian?.approver).toBe(JORDAN)
    expect(sam.raw.genericRecords.deleteById).not.toHaveBeenCalled()
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'verified', state: 'Test state (K0)' } })
  })

  test("the wrong ward: kept, couldn't verify as wardMismatch (control: the same card, Sam's ward, is valid)", async () => {
    const sam = await arrives(card('G-ok'), OTHER_WARD)
    expect(sam.askRecord().guardian?.verdict).toMatchObject({ ok: false, reason: 'wardMismatch' })
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'unverified', outcome: 'wardMismatch' } })
  })

  test("no ward set on this phone: couldn't verify as noWard, never valid", async () => {
    const sam = await arrives(card('G-ok'), null)
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'unverified', outcome: 'noWard' } })
  })

  test("a root not on our list: couldn't verify as untrustedRoot (control: the same card with its root listed is valid)", async () => {
    const sam = await arrives(card('G-untrusted'))
    expect(await guardianStandings(sam.agent)).toEqual({
      [JORDAN]: { kind: 'unverified', outcome: 'untrustedRoot' },
    })
    jest
      .spyOn(stateRoots, 'trustedStateRoots')
      .mockReturnValue([stateRoots.K0_TEST_ROOT, { aid: prov.aids['mal-root'], name: 'Another state' }])
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'verified', state: 'Another state' } })
  })

  test("a release's empty list verifies nothing: the valid K0 card reads couldn't verify", async () => {
    jest.spyOn(stateRoots, 'trustedStateRoots').mockReturnValue(stateRoots.stateRootsFor(false, false))
    const sam = await arrives(card('G-ok'))
    expect(await guardianStandings(sam.agent)).toEqual({
      [JORDAN]: { kind: 'unverified', outcome: 'untrustedRoot' },
    })
  })

  test("a revoked card: couldn't verify as revoked (control: G-ok on the same chain is valid)", async () => {
    const sam = await arrives(card('G-revoked'))
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'unverified', outcome: 'revoked' } })
  })

  test('over the cap: refused before its check, nothing kept, and logged (control: the K0 card above is taken)', async () => {
    const padded = { ...card('G-ok'), creds: [...card('G-ok').creds, 'x'.repeat(GUARDIAN_EVIDENCE_MAX_BYTES)] }
    const sam = await arrives(padded)
    expect(sam.consume).not.toHaveBeenCalled()
    expect(sam.askRecord().guardian).toBeUndefined()
    expect(sam.warn.mock.calls.map(String).join()).toMatch(/over the 65536 cap/)
  })

  test('a card that names another agent, or comes with no offer on the connection, is not kept', async () => {
    const sam = await arrives(card('G-ok'), SAM_WARD, { agent: 'did:webvh:someone-else.example' })
    expect(sam.askRecord().guardian).toBeUndefined()
    const none = phone()
    await handleGuardianEvidence(none.agent, none.service, documentOf(card('G-ok')), context)
    expect(none.rows.filter((r) => r.tags.recordType === approverRole.ROLE_OFFER_ASK)).toHaveLength(0)
  })

  test('a card that fails its proof check is not kept (control: handled, it is)', async () => {
    const sam = phone()
    sam.ask()
    sam.consume.mockResolvedValueOnce({ kind: 'rejected' } as never)
    await handleGuardianEvidence(sam.agent, sam.service, documentOf(card('G-ok')), context)
    expect(sam.askRecord().guardian).toBeUndefined()
  })

  test.each([
    ['trusted approvers off', () => setTrustedApproversEnabled(false)],
    ['state-verified approvers off', () => setStateVerifiedApproversEnabled(false)],
    ['state-verified approvers turned off remotely', () => (STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = true)],
    ['the SEDI/KERI umbrella off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
  ])('%s: nothing is read or kept, and nothing is shown for a card kept earlier', async (_, off) => {
    const earlier = await arrives(card('G-ok'))
    expect(await guardianStandings(earlier.agent)).not.toEqual({})
    off()
    expect(await guardianStandings(earlier.agent)).toEqual({})
    const sam = phone()
    sam.ask()
    await handleGuardianEvidence(sam.agent, sam.service, documentOf(card('G-ok')), context)
    expect(sam.consume).not.toHaveBeenCalled()
    expect(sam.askRecord().guardian).toBeUndefined()
  })
})

describe('tester builds: the Developer setting "Trust the test state (K0)"', () => {
  // jest runs as a Developer build (__DEV__ true); a TestFlight or OTA build is not one. Each row sets it.
  const g = globalThis as { __DEV__?: boolean }
  const wasDev = g.__DEV__
  const asBuild = (developer: boolean) => {
    g.__DEV__ = developer
  }
  afterEach(() => {
    g.__DEV__ = wasDev
    setTrustTestStateEnabled(false)
  })

  test('a release with the setting off verifies nothing (control: a Developer build verifies the same card)', async () => {
    asBuild(false)
    const sam = await arrives(card('G-ok'))
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'unverified', outcome: 'untrustedRoot' } })
    asBuild(true)
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'verified', state: 'Test state (K0)' } })
  })

  test('a release with the setting on verifies the K0 card as "Test state (K0)" (control: switched off again, it does not)', async () => {
    asBuild(false)
    setTrustTestStateEnabled(true)
    const sam = await arrives(card('G-ok'))
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'verified', state: 'Test state (K0)' } })
    setTrustTestStateEnabled(false)
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'unverified', outcome: 'untrustedRoot' } })
  })

  test.each([
    ['trusted approvers off', () => setTrustedApproversEnabled(false)],
    ['trusted approvers turned off remotely', () => (TRUSTED_APPROVERS_REMOTE_OFF.off = true)],
    ['state-verified approvers off', () => setStateVerifiedApproversEnabled(false)],
    ['state-verified approvers turned off remotely', () => (STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = true)],
    ['the SEDI/KERI umbrella off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
  ])('%s: a release trusts no root even with the setting on (control: all on, the K0 root)', (_, off) => {
    asBuild(false)
    setTrustTestStateEnabled(true)
    expect(stateRoots.trustedStateRoots()).toEqual([stateRoots.K0_TEST_ROOT])
    off()
    expect(stateRoots.trustedStateRoots()).toEqual([])
  })

  test('it adds the K0 root only: a card from another root still reads untrustedRoot (control: the K0 card verifies)', async () => {
    asBuild(false)
    setTrustTestStateEnabled(true)
    const other = await arrives(card('G-untrusted'))
    expect(await guardianStandings(other.agent)).toEqual({ [JORDAN]: { kind: 'unverified', outcome: 'untrustedRoot' } })
    const sam = await arrives(card('G-ok'))
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'verified', state: 'Test state (K0)' } })
  })

  test('the name shown is the test state, never one the card claims (control: the K0 root is named so)', () => {
    asBuild(false)
    setTrustTestStateEnabled(true)
    expect(stateRoots.K0_TEST_ROOT.name).toBe('Test state (K0)')
    const claims = { ...card('G-ok'), state: 'Utah', name: 'Utah' } as unknown as GuardianEvidence
    const verdict = checkGuardianEvidence(claims, SAM_WARD, new Date(), () => undefined)
    expect(verdict).toMatchObject({ ok: true, state: 'Test state (K0)', root: stateRoots.K0_TEST_ROOT.aid })
  })
})

describe('Developer actions: "Hold the test Guardian card (K0)" and "I\'m the test ward (K0)"', () => {
  const g = globalThis as { __DEV__?: boolean }
  const wasDev = g.__DEV__
  beforeEach(() => setTrustTestStateEnabled(true))
  afterEach(() => {
    g.__DEV__ = wasDev
    setTrustTestStateEnabled(false)
  })

  test("the card held is the K0 Guardian card, and the ward set is K0's (Sam)", async () => {
    const jordan = phone()
    expect(await holdK0TestGuardianCard(jordan.agent)).toBe('done')
    expect(await heldGuardianEvidence(jordan.agent)).toEqual(card('G-ok'))
    const sam = phone()
    expect(await becomeK0TestWard(sam.agent)).toBe('done')
    expect(await stateWardOf(sam.agent)).toBe(SAM_WARD)
  })

  test.each([
    ['the test-state setting off', () => setTrustTestStateEnabled(false)],
    ['trusted approvers off', () => setTrustedApproversEnabled(false)],
    ['trusted approvers turned off remotely', () => (TRUSTED_APPROVERS_REMOTE_OFF.off = true)],
    ['state-verified approvers off', () => setStateVerifiedApproversEnabled(false)],
    ['state-verified approvers turned off remotely', () => (STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = true)],
    ['the SEDI/KERI umbrella off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
  ])('%s: neither action does anything (control: all on, both do)', async (_, off) => {
    off()
    const jordan = phone()
    expect(await holdK0TestGuardianCard(jordan.agent)).toBe('off')
    expect(await heldGuardianEvidence(jordan.agent)).toBeUndefined()
    const sam = phone()
    expect(await becomeK0TestWard(sam.agent)).toBe('off')
    expect(await stateWardOf(sam.agent)).toBeNull()
    allOn()
    setTrustTestStateEnabled(true)
    expect(await holdK0TestGuardianCard(jordan.agent)).toBe('done')
    expect(await becomeK0TestWard(sam.agent)).toBe('done')
    expect(await heldGuardianEvidence(jordan.agent)).toEqual(card('G-ok'))
    expect(await stateWardOf(sam.agent)).toBe(SAM_WARD)
  })

  test('as the package exports them, the actions are the same and gated the same (control: on, they act)', async () => {
    const exported = jest.requireActual('../developerTestState') as typeof import('../developerTestState')
    setTrustTestStateEnabled(false)
    const jordan = phone()
    const sam = phone()
    expect(await exported.holdK0TestGuardianCard(jordan.agent)).toBe('off')
    expect(await exported.becomeK0TestWard(sam.agent)).toBe('off')
    setTrustTestStateEnabled(true)
    expect(await exported.holdK0TestGuardianCard(jordan.agent)).toBe('done')
    expect(await exported.becomeK0TestWard(sam.agent)).toBe('done')
    expect(await heldGuardianEvidence(jordan.agent)).toEqual(card('G-ok'))
    expect(await stateWardOf(sam.agent)).toBe(SAM_WARD)
  })

  test('a tester build, end to end: Jordan holds the test card, Sam is the test ward, and it verifies as "Test state (K0)"', async () => {
    g.__DEV__ = false
    const jordan = phone()
    await holdK0TestGuardianCard(jordan.agent)
    const held = (await heldGuardianEvidence(jordan.agent)) as GuardianEvidence
    const sam = phone()
    await becomeK0TestWard(sam.agent)
    sam.ask()
    await handleGuardianEvidence(sam.agent, sam.service, documentOf(held), context)
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'verified', state: 'Test state (K0)' } })
  })
})

describe('shown only beside the DID it was sent as, and checked again on open', () => {
  test('a card that overtakes the yes is kept and shown once the yes is in (control: before it, nothing)', async () => {
    const sam = phone()
    await setStateWard(sam.agent, SAM_WARD)
    sam.ask({ state: 'open', acceptedAs: undefined })
    await handleGuardianEvidence(sam.agent, sam.service, documentOf(card('G-ok')), context)
    expect(sam.askRecord().guardian?.verdict.ok).toBe(true)
    expect(await guardianStandings(sam.agent)).toEqual({})
    const record = sam.rows.find((r) => r.tags.recordType === approverRole.ROLE_OFFER_ASK) as Row
    record.content = { ...record.content, state: 'accepted', acceptedAs: JORDAN }
    expect(Object.keys(await guardianStandings(sam.agent))).toEqual([JORDAN])
  })

  test('a valid card sent as one DID is never shown beside another (control: sent as the yes, it is)', async () => {
    const sam = await arrives(card('G-ok'), SAM_WARD, { approver: AMY })
    expect(sam.askRecord().guardian?.verdict.ok).toBe(true)
    expect(await guardianStandings(sam.agent)).toEqual({})
  })

  test('once written on the agent, it is shown beside the written DID', async () => {
    const sam = phone()
    await setStateWard(sam.agent, SAM_WARD)
    sam.ask({ state: 'closed', written: true, writtenAs: JORDAN })
    await handleGuardianEvidence(sam.agent, sam.service, documentOf(card('G-ok')), context)
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'verified', state: 'Test state (K0)' } })
  })

  test("on open the card is checked again: a changed ward turns a kept valid into couldn't verify, written in place", async () => {
    const sam = await arrives(card('G-ok'))
    expect(sam.askRecord().guardian?.verdict.ok).toBe(true)
    sam.update.mockClear()
    await setStateWard(sam.agent, OTHER_WARD)
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'unverified', outcome: 'wardMismatch' } })
    expect(sam.askRecord().guardian?.verdict).toMatchObject({ ok: false, reason: 'wardMismatch' })
    expect(sam.raw.genericRecords.deleteById).not.toHaveBeenCalled()
    // Control: unchanged, nothing is written.
    sam.update.mockClear()
    await guardianStandings(sam.agent)
    expect(sam.update).not.toHaveBeenCalled()
  })

  test("verifyGuardian throwing reads couldn't verify, is logged, and replaces a kept valid (control: no throw, valid)", async () => {
    const sam = await arrives(card('G-ok'))
    expect(sam.askRecord().guardian?.verdict.ok).toBe(true)
    jest.spyOn(guardianModule, 'verifyGuardian').mockImplementation(() => {
      throw new Error('boom')
    })
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'unverified', outcome: 'checkFailed' } })
    expect(sam.askRecord().guardian?.verdict).toMatchObject({ ok: false, reason: 'checkFailed' })
    expect(sam.warn.mock.calls.map(String).join()).toMatch(/the check stopped on an error: boom/)
  })

  test('a re-offer keeps the card of the approver in force (control: a card sent as another DID does not stay)', async () => {
    const sam = phone()
    await setStateWard(sam.agent, SAM_WARD)
    sam.ask({ state: 'closed', written: true, writtenAs: JORDAN })
    await handleGuardianEvidence(sam.agent, sam.service, documentOf(card('G-ok')), context)
    await approverRole.offerApproverRole(sam.agent, CONN, SAM_AGENT, ['joinCommunity', 'addDevice'])
    expect(sam.askRecord().state).toBe('open')
    expect(sam.askRecord().guardian?.approver).toBe(JORDAN)
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'verified', state: 'Test state (K0)' } })

    const other = phone()
    other.ask({ state: 'closed', written: true, writtenAs: JORDAN })
    await handleGuardianEvidence(other.agent, other.service, documentOf(card('G-ok'), { approver: AMY }), context)
    expect(other.askRecord().guardian?.approver).toBe(AMY)
    await approverRole.offerApproverRole(other.agent, CONN, SAM_AGENT, ['joinCommunity'])
    expect(other.askRecord().guardian).toBeUndefined()
  })

  test('verifyGuardian throwing on arrival keeps it as checkFailed, never valid', async () => {
    jest.spyOn(guardianModule, 'verifyGuardian').mockImplementation(() => {
      throw new Error('boom')
    })
    const sam = await arrives(card('G-ok'))
    expect(sam.askRecord().guardian?.verdict).toMatchObject({ ok: false, reason: 'checkFailed' })
  })
})

describe('Who approves on open: the check runs again only when something it reads moved', () => {
  const checks = () => jest.spyOn(guardianModule, 'verifyGuardian')
  const K0 = stateRoots.K0_TEST_ROOT
  const validUntil = (expires: string) => ({
    ok: true as const,
    guardian: JORDAN_AID,
    ward: SAM_WARD,
    role: 'parent',
    root: K0.aid,
    expires,
  })
  const askRow = (sam: ReturnType<typeof phone>) =>
    sam.rows.find((r) => r.tags.recordType === approverRole.ROLE_OFFER_ASK) as Row

  test('nothing moved: the second open shows the kept verdict without checking (control: after a restart it checks)', async () => {
    const sam = await arrives(card('G-ok'))
    const spy = checks()
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'verified', state: 'Test state (K0)' } })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'verified', state: 'Test state (K0)' } })
    expect(spy).toHaveBeenCalledTimes(1)
    resetGuardianCheckMemo()
    await guardianStandings(sam.agent)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  test.each([
    [
      'the ward',
      async (sam: ReturnType<typeof phone>) => setStateWard(sam.agent, OTHER_WARD),
      { kind: 'unverified', outcome: 'wardMismatch' },
    ],
    [
      'the roots this build trusts',
      async () => {
        jest
          .spyOn(stateRoots, 'trustedStateRoots')
          .mockReturnValue([K0, { aid: prov.aids['mal-root'], name: 'Another state' }])
      },
      { kind: 'verified', state: 'Test state (K0)' },
    ],
    [
      'the name we show for a trusted root',
      async () => {
        jest.spyOn(stateRoots, 'trustedStateRoots').mockReturnValue([{ aid: K0.aid, name: 'Renamed state' }])
      },
      { kind: 'verified', state: 'Renamed state' },
    ],
    [
      "the card's stored text",
      async (sam: ReturnType<typeof phone>) => {
        const record = askRow(sam)
        const ask = record.content as unknown as approverRole.RoleOfferAsk
        record.content = { ...ask, guardian: { ...ask.guardian, evidence: card('G-revoked') } } as never
      },
      { kind: 'unverified', outcome: 'revoked' },
    ],
  ])('%s moved: the next open checks again (control: unmoved, it did not)', async (_, move, shown) => {
    const sam = await arrives(card('G-ok'))
    const spy = checks()
    await guardianStandings(sam.agent)
    await guardianStandings(sam.agent)
    expect(spy).toHaveBeenCalledTimes(1)
    await move(sam)
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: shown })
    expect(spy).toHaveBeenCalledTimes(2)
  })

  describe('a valid verdict that expires', () => {
    afterEach(() => jest.useRealTimers())
    const at = (iso: string) => jest.setSystemTime(new Date(iso))
    const datesOnly = () =>
      jest.useFakeTimers({
        doNotFake: [
          'nextTick',
          'setImmediate',
          'clearImmediate',
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          'queueMicrotask',
          'requestAnimationFrame',
          'cancelAnimationFrame',
          'requestIdleCallback',
          'cancelIdleCallback',
          'performance',
          'hrtime',
        ],
      })

    // K0's Guardian expires 2030-11-10; the check is stubbed to return a nearer expiry the faked clock (Date only) can cross.
    test.each([
      ['in the past', '2029-07-01T00:00:00Z', 2],
      ['exactly now (expiry <= now)', '2029-06-01T00:00:00Z', 2],
      ['still ahead', '2029-05-31T23:59:59Z', 1],
    ])('a kept valid verdict expiring 2029-06-01 is %s (now %s): checked %i time(s) in all', async (_, now, runs) => {
      const sam = await arrives(card('G-ok'))
      datesOnly()
      at('2029-01-01T00:00:00Z')
      const spy = checks().mockReturnValue(validUntil('2029-06-01T00:00:00Z'))
      await guardianStandings(sam.agent)
      expect(spy).toHaveBeenCalledTimes(1)
      at(now)
      await guardianStandings(sam.agent)
      expect(spy).toHaveBeenCalledTimes(runs)
    })

    test('an expiry that cannot be read is never reused (control: a readable one ahead is)', async () => {
      const sam = await arrives(card('G-ok'))
      const spy = checks().mockReturnValue(validUntil('not a date'))
      await guardianStandings(sam.agent)
      await guardianStandings(sam.agent)
      expect(spy).toHaveBeenCalledTimes(2)
      resetGuardianCheckMemo()
      spy.mockClear().mockReturnValue(validUntil('2999-01-01T00:00:00Z'))
      await guardianStandings(sam.agent)
      await guardianStandings(sam.agent)
      expect(spy).toHaveBeenCalledTimes(1)
    })
  })

  test('a kept refusal stays a refusal: reuse never shows valid (control: checked again, the same stub would)', async () => {
    const sam = await arrives(card('G-revoked'))
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'unverified', outcome: 'revoked' } })
    const spy = checks().mockReturnValue(validUntil('2999-01-01T00:00:00Z'))
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'unverified', outcome: 'revoked' } })
    expect(spy).not.toHaveBeenCalled()
    resetGuardianCheckMemo()
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'verified', state: 'Test state (K0)' } })
  })

  test('a verdict stored by an earlier run is not reused: the first open checks (control: it was stored valid)', async () => {
    const sam = await arrives(card('G-ok'))
    expect(sam.askRecord().guardian?.verdict.ok).toBe(true)
    const spy = checks().mockReturnValue({ ok: false, reason: 'revoked', detail: 'newer code refuses it' } as never)
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'unverified', outcome: 'revoked' } })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(sam.askRecord().guardian?.verdict).toMatchObject({ ok: false, reason: 'revoked' })
  })

  test("a throw when it checks again reads couldn't verify, never the kept valid (control: unmoved, valid without a check)", async () => {
    const sam = await arrives(card('G-ok'))
    await guardianStandings(sam.agent)
    const spy = checks().mockImplementation(() => {
      throw new Error('boom')
    })
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'verified', state: 'Test state (K0)' } })
    expect(spy).not.toHaveBeenCalled()
    await setStateWard(sam.agent, OTHER_WARD)
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'unverified', outcome: 'checkFailed' } })
    expect(sam.askRecord().guardian?.verdict).toMatchObject({ ok: false, reason: 'checkFailed' })
  })

  test('report only: how long an open takes for the K0 card, checked and reused (no threshold)', async () => {
    const sam = await arrives(card('G-ok'))
    const t0 = performance.now()
    await guardianStandings(sam.agent)
    const checked = performance.now() - t0
    const t1 = performance.now()
    await guardianStandings(sam.agent)
    const reused = performance.now() - t1
    // eslint-disable-next-line no-console
    console.log(`[guardian open timing] K0 card: checked ${checked.toFixed(1)} ms, reused ${reused.toFixed(2)} ms`)
    expect(checked).toBeGreaterThan(0)
  })
})

describe("on the approver's phone: sending the card after a yes", () => {
  const prompt = (): approverRole.RoleOfferPrompt => ({
    open: true,
    connectionId: CONN,
    asker: 'Sam',
    agentDid: SAM_AGENT,
    actions: ['joinCommunity'],
    request: {
      id: 'req-1',
      type: TYPE_URI,
      threadId: 'req-1',
      issuer: 'did:peer:them',
      recipient: 'did:peer:me',
      issuedAt: new Date().toISOString(),
      payload: { agent: SAM_AGENT, actions: ['joinCommunity'], challenge: 'c'.repeat(43) },
    },
    receivedAt: new Date().toISOString(),
  })
  const sayYes = async (jordan: ReturnType<typeof phone>) => {
    approverRole.roleOfferPromptStore.set(prompt())
    await approverRole.respondToRoleOffer(jordan.agent, CONN, true, JORDAN)
  }

  test('with a card held and its sending said yes to, the yes goes and then the card, for that agent and as that DID', async () => {
    const jordan = phone()
    expect(await holdGuardianEvidence(jordan.agent, card('G-ok'))).toBe('held')
    await setCardConsent(jordan.agent, CONN, 'yes')
    await sayYes(jordan)
    expect(sent.map((d) => d.type)).toEqual([expect.stringContaining('role-offer'), GUARDIAN_EVIDENCE_TYPE_URI])
    const payload = sent[1].payload as GuardianEvidencePayload
    expect(payload).toMatchObject({ agent: SAM_AGENT, approver: JORDAN, guardianSaid: prov.creds['G-ok'].said })
    expect(schemaTakes(payload)).toBe(true)
  })

  test('with no card held, only the yes goes (control: the row above)', async () => {
    const jordan = phone()
    await sayYes(jordan)
    expect(sent.map((d) => d.type)).toEqual([expect.stringContaining('role-offer')])
  })

  test('a no sends no card', async () => {
    const jordan = phone()
    await holdGuardianEvidence(jordan.agent, card('G-ok'))
    approverRole.roleOfferPromptStore.set(prompt())
    await approverRole.respondToRoleOffer(jordan.agent, CONN, false)
    expect(sent.map((d) => d.type)).toEqual([expect.stringContaining('role-offer')])
  })

  test.each([
    ['state-verified approvers off', () => setStateVerifiedApproversEnabled(false)],
    ['state-verified approvers turned off remotely', () => (STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = true)],
    ['the SEDI/KERI umbrella off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
    ['trusted approvers off', () => setTrustedApproversEnabled(false)],
  ])('%s: no card is sent', async (_, off) => {
    const jordan = phone()
    await holdGuardianEvidence(jordan.agent, card('G-ok'))
    off()
    expect(await sendGuardianEvidence(jordan.agent, CONN, SAM_AGENT, JORDAN)).toBe('off')
    expect(sent).toHaveLength(0)
  })

  test('over the cap: never held, and one held anyway is never sent (control: K0 is held and sent)', async () => {
    const jordan = phone()
    const padded = { ...card('G-ok'), creds: [...card('G-ok').creds, 'x'.repeat(GUARDIAN_EVIDENCE_MAX_BYTES)] }
    expect(await holdGuardianEvidence(jordan.agent, padded)).toBe('tooLarge')
    expect(jordan.rows.filter((r) => r.tags.recordType === GUARDIAN_EVIDENCE_HELD)).toHaveLength(0)
    await jordan.raw.genericRecords.save({ content: { ...padded }, tags: { recordType: GUARDIAN_EVIDENCE_HELD } })
    expect(await sendGuardianEvidence(jordan.agent, CONN, SAM_AGENT, JORDAN)).toBe('tooLarge')
    expect(sent).toHaveLength(0)
    const ok = phone()
    await holdGuardianEvidence(ok.agent, card('G-ok'))
    expect(await sendGuardianEvidence(ok.agent, CONN, SAM_AGENT, JORDAN)).toBe('sent')
  })

  test('a card that fails to send leaves the yes standing', async () => {
    const jordan = phone()
    await holdGuardianEvidence(jordan.agent, card('G-ok'))
    await setCardConsent(jordan.agent, CONN, 'yes')
    const ceremony = jest.requireMock('../ceremony') as { sendTrustTaskDocument: jest.Mock }
    ceremony.sendTrustTaskDocument
      .mockImplementationOnce(async (_a: unknown, _c: string, doc: Record<string, unknown>) => {
        sent.push(doc)
      })
      .mockRejectedValueOnce(new Error('mediator down'))
    await expect(sayYes(jordan)).resolves.toBeUndefined()
    expect(sent.map((d) => d.type)).toEqual([expect.stringContaining('role-offer')])
    expect(jordan.warn.mock.calls.map(String).join()).toMatch(/could not send the guardian card: mediator down/)
  })
})

describe('Who approves: the state card line', () => {
  const id = (key: string) => testIdWithKey(key)

  const showFor = async (sam: ReturnType<typeof phone>) => {
    ;(useFocusEffect as jest.Mock).mockImplementation((effect: () => void) => require('react').useEffect(effect, []))
    ;(useAgent as jest.Mock).mockReturnValue({ agent: sam.agent })
    jest.spyOn(approverRole, 'approverNames').mockResolvedValue({ [JORDAN]: 'Jordan' })
    jest.spyOn(vtaAgent, 'trustedApprovers').mockResolvedValue({
      view: { approvers: [JORDAN], keys: ['joinCommunity'], heldElsewhere: [] },
      version: 2,
    } as TrustedApproversState)
    const tree = render(
      <BasicAppContext>
        <VtaTrustedApprovers />
      </BasicAppContext>
    )
    await act(async () => undefined)
    return tree
  }
  const writtenWith = async (evidence: GuardianEvidence | null) => {
    const sam = phone()
    await setStateWard(sam.agent, SAM_WARD)
    sam.ask({ state: 'closed', written: true, writtenAs: JORDAN })
    if (evidence !== null) await handleGuardianEvidence(sam.agent, sam.service, documentOf(evidence), context)
    return sam
  }

  test('a valid card: "Has a Guardian card from" beside the approver, with "As shown by … Not yet linked" under it', async () => {
    const tree = await showFor(await writtenWith(card('G-ok')))
    expect(tree.getByTestId(id(TrustedApproversIds.guardianVerified(JORDAN))).props.children).toBe(
      'Approver.GuardianHas'
    )
    expect(tree.getByText('Approver.GuardianAsShown')).toBeTruthy()
    expect(tree.queryByText('Approver.GuardianVerified')).toBeNull()
    expect(tree.queryByTestId(id(TrustedApproversIds.guardianUnverified(JORDAN)))).toBeNull()
  })

  test("a revoked card: couldn't verify, with the outcome, and never verified (control: the row above)", async () => {
    const tree = await showFor(await writtenWith(card('G-revoked')))
    expect(tree.getByTestId(id(TrustedApproversIds.guardianUnverified(JORDAN)))).toBeTruthy()
    expect(tree.getByTestId(id(TrustedApproversIds.guardianOutcome(JORDAN)))).toBeTruthy()
    expect(tree.queryByTestId(id(TrustedApproversIds.guardianVerified(JORDAN)))).toBeNull()
  })

  test('no card: no line at all (control: the rows above)', async () => {
    const tree = await showFor(await writtenWith(null))
    expect(tree.getByTestId(id(TrustedApproversIds.approver(JORDAN)))).toBeTruthy()
    expect(tree.queryByTestId(id(TrustedApproversIds.guardianVerified(JORDAN)))).toBeNull()
    expect(tree.queryByTestId(id(TrustedApproversIds.guardianUnverified(JORDAN)))).toBeNull()
  })

  test('state-verified approvers off: a kept valid card shows nothing (control: on, it shows)', async () => {
    const sam = await writtenWith(card('G-ok'))
    setStateVerifiedApproversEnabled(false)
    const tree = await showFor(sam)
    expect(tree.getByTestId(id(TrustedApproversIds.approver(JORDAN)))).toBeTruthy()
    expect(tree.queryByTestId(id(TrustedApproversIds.guardianVerified(JORDAN)))).toBeNull()
    expect(tree.queryByTestId(id(TrustedApproversIds.guardianUnverified(JORDAN)))).toBeNull()
  })

  test('switched off while open: the line goes on the next render, before anything is read again (control: on, shown)', async () => {
    const tree = await showFor(await writtenWith(card('G-ok')))
    expect(tree.getByTestId(id(TrustedApproversIds.guardianVerified(JORDAN)))).toBeTruthy()
    STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = true
    tree.rerender(
      <BasicAppContext>
        <VtaTrustedApprovers />
      </BasicAppContext>
    )
    expect(tree.queryByTestId(id(TrustedApproversIds.guardianVerified(JORDAN)))).toBeNull()
    expect(tree.getByTestId(id(TrustedApproversIds.approver(JORDAN)))).toBeTruthy()
  })

  test("verifyGuardian throwing on open: couldn't verify, and the kept verdict is no longer valid (control: no throw, verified)", async () => {
    const sam = await writtenWith(card('G-ok'))
    expect(sam.askRecord().guardian?.verdict.ok).toBe(true)
    jest.spyOn(guardianModule, 'verifyGuardian').mockImplementation(() => {
      throw new Error('boom')
    })
    const tree = await showFor(sam)
    expect(tree.getByTestId(id(TrustedApproversIds.guardianUnverified(JORDAN)))).toBeTruthy()
    expect(tree.queryByTestId(id(TrustedApproversIds.guardianVerified(JORDAN)))).toBeNull()
    expect((sam.askRecord().guardian as GuardianOnAsk).verdict.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Asking Jordan first (Alberto, 2026-11-11): "Also send your Guardian card to <name>?", once per person, kept.

describe('asking Jordan first: the card goes only once Jordan said yes to sending it to this person', () => {
  const offer = (connectionId = CONN, asker = 'Sam'): approverRole.RoleOfferPrompt => ({
    open: true,
    connectionId,
    asker,
    agentDid: SAM_AGENT,
    actions: ['joinCommunity'],
    request: {
      id: `req-${connectionId}`,
      type: TYPE_URI,
      threadId: `req-${connectionId}`,
      issuer: 'did:peer:them',
      recipient: 'did:peer:me',
      issuedAt: new Date().toISOString(),
      payload: { agent: SAM_AGENT, actions: ['joinCommunity'], challenge: 'c'.repeat(43) },
    },
    receivedAt: new Date().toISOString(),
  })
  /** Jordan says yes to approving for the person on `connectionId` (a first offer or a re-offer). */
  const yesTo = async (jordan: ReturnType<typeof phone>, connectionId = CONN, asker = 'Sam') => {
    approverRole.roleOfferPromptStore.set(offer(connectionId, asker))
    await approverRole.respondToRoleOffer(jordan.agent, connectionId, true, JORDAN)
  }
  const cards = () => sent.filter((d) => d.type === GUARDIAN_EVIDENCE_TYPE_URI)
  const answers = (jordan: ReturnType<typeof phone>) =>
    jordan.rows.filter((r) => r.tags.recordType === GUARDIAN_CARD_CONSENT)
  const jordanWithCard = async () => {
    const jordan = phone()
    await holdGuardianEvidence(jordan.agent, card('G-ok'))
    jest.spyOn(stateRoots, 'trustedStateRoots').mockReturnValue([stateRoots.K0_TEST_ROOT])
    return jordan
  }

  test('never asked: the yes goes, the card does not, and Jordan is asked, naming the state on our list (control: a kept yes sends it)', async () => {
    const jordan = await jordanWithCard()
    await yesTo(jordan)
    expect(sent.map((d) => d.type)).toEqual([expect.stringContaining('role-offer')])
    expect(cards()).toHaveLength(0)
    expect(cardQuestions.first()).toEqual({ connectionId: CONN, asker: 'Sam', state: 'Test state (K0)' })
    expect(answers(jordan)).toHaveLength(0)
    // Control: the same phone with a kept yes for Sam sends it.
    const control = await jordanWithCard()
    await setCardConsent(control.agent, CONN, 'yes')
    sent.length = 0
    await yesTo(control)
    expect(cards()).toHaveLength(1)
  })

  test('"Send my card": kept as yes, sent now as the yes kept here, and sent again on a re-offer without asking', async () => {
    const jordan = await jordanWithCard()
    await yesTo(jordan)
    expect(await shareGuardianCard(jordan.agent, CONN, true)).toBe('sent')
    expect(cards()).toHaveLength(1)
    expect(cards()[0].payload).toMatchObject({ agent: SAM_AGENT, approver: JORDAN })
    expect(await cardConsentOn(jordan.agent, CONN)).toBe('yes')
    expect(cardQuestions.first()).toBeUndefined()
    await yesTo(jordan)
    expect(cards()).toHaveLength(2)
    expect(cardQuestions.first()).toBeUndefined()
  })

  test('"Don\'t send": kept as no, nothing goes, and a re-offer neither sends nor asks again (the never-asked row is its control)', async () => {
    const jordan = await jordanWithCard()
    await yesTo(jordan)
    expect(await shareGuardianCard(jordan.agent, CONN, false)).toBe('declined')
    expect(cards()).toHaveLength(0)
    expect(answers(jordan)).toHaveLength(1)
    expect(answers(jordan)[0].tags).toEqual({ recordType: GUARDIAN_CARD_CONSENT, connectionId: CONN })
    expect(cardQuestions.first()).toBeUndefined()
    await yesTo(jordan)
    expect(cards()).toHaveLength(0)
    expect(cardQuestions.first()).toBeUndefined()
    expect(await guardianCardAfterYes(jordan.agent, offer(), JORDAN)).toBe('declined')
  })

  test('a no outlives a restart: nothing in memory, the kept no still withholds and asks nothing (control: a person never asked is asked)', async () => {
    const jordan = await jordanWithCard()
    await setCardConsent(jordan.agent, CONN, 'no')
    // A restart: nothing this run held in memory is left; only what was kept.
    cardQuestions.reset()
    approverRole.roleOfferPromptStore.clear()
    await yesTo(jordan)
    expect(cards()).toHaveLength(0)
    expect(cardQuestions.first()).toBeUndefined()
    await yesTo(jordan, CONN2, 'Amy')
    expect(cardQuestions.first()).toMatchObject({ connectionId: CONN2, asker: 'Amy' })
  })

  test("an answer is per person: a yes for Sam sends nothing to Amy, who is asked (control: Sam's card goes)", async () => {
    const jordan = await jordanWithCard()
    await setCardConsent(jordan.agent, CONN, 'yes')
    await yesTo(jordan, CONN2, 'Amy')
    expect(cards()).toHaveLength(0)
    expect(cardQuestions.first()).toMatchObject({ connectionId: CONN2 })
    await yesTo(jordan)
    expect(cards()).toHaveLength(1)
  })

  test('the answer is kept by connection, so a rotated relationship DID keeps it: a no still withholds, a yes still sends', async () => {
    const jordan = await jordanWithCard()
    await setCardConsent(jordan.agent, CONN, 'no')
    jordan.relationships[0].myRelationshipDid = 'did:peer:2.mine-rotated'
    jordan.relationships[0].counterpartyRelationshipDid = 'did:peer:2.theirs-rotated'
    await yesTo(jordan)
    expect(cards()).toHaveLength(0)
    expect(cardQuestions.first()).toBeUndefined()
    await setCardConsent(jordan.agent, CONN, 'yes')
    await yesTo(jordan)
    expect(cards()).toHaveLength(1)
  })

  test.each([
    ['state-verified approvers off', () => setStateVerifiedApproversEnabled(false)],
    ['state-verified approvers turned off remotely', () => (STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = true)],
    ['the SEDI/KERI umbrella off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
    ['trusted approvers off', () => setTrustedApproversEnabled(false)],
  ])('%s: nothing is asked, nothing is kept and nothing goes (control: on, Jordan is asked)', async (_, off) => {
    const jordan = await jordanWithCard()
    off()
    expect(await guardianCardAfterYes(jordan.agent, offer(), JORDAN)).toBe('off')
    expect(await shareGuardianCard(jordan.agent, CONN, true)).toBe('off')
    expect(cardQuestions.first()).toBeUndefined()
    expect(answers(jordan)).toHaveLength(0)
    expect(cards()).toHaveLength(0)
    allOn()
    expect(await guardianCardAfterYes(jordan.agent, offer(), JORDAN)).toBe('asked')
  })

  test.each([
    ['said no', 'no' as const],
    ['never asked', undefined],
  ])('%s: the approval itself stands, sent and kept as a yes', async (_, answer) => {
    const jordan = await jordanWithCard()
    if (answer) await setCardConsent(jordan.agent, CONN, answer)
    await expect(yesTo(jordan)).resolves.toBeUndefined()
    expect(sent.map((d) => d.type)).toEqual([expect.stringContaining('role-offer')])
    expect((sent[0].payload as { decision?: string }).decision).toBe('accepted')
    const kept = jordan.rows.find((r) => r.tags.recordType === approverRole.ROLE_OFFER_PROMPT)?.content
    expect(kept).toMatchObject({ answered: 'accepted', answeredAs: JORDAN })
  })

  test('on Sam\'s phone, a card Jordan chose not to send is no line at all, not "couldn\'t verify" (control: sent, it shows)', async () => {
    const run = async (send: boolean) => {
      sent.length = 0
      cardQuestions.reset()
      const jordan = await jordanWithCard()
      await yesTo(jordan)
      await shareGuardianCard(jordan.agent, CONN, send)
      const sam = phone()
      await setStateWard(sam.agent, SAM_WARD)
      sam.ask({ state: 'closed', written: true, writtenAs: JORDAN })
      for (const doc of cards()) await handleGuardianEvidence(sam.agent, sam.service, doc, context)
      ;(useFocusEffect as jest.Mock).mockImplementation((effect: () => void) => require('react').useEffect(effect, []))
      ;(useAgent as jest.Mock).mockReturnValue({ agent: sam.agent })
      jest.spyOn(approverRole, 'approverNames').mockResolvedValue({ [JORDAN]: 'Jordan' })
      jest.spyOn(vtaAgent, 'trustedApprovers').mockResolvedValue({
        view: { approvers: [JORDAN], keys: ['joinCommunity'], heldElsewhere: [] },
        version: 2,
      } as TrustedApproversState)
      const tree = render(
        <BasicAppContext>
          <VtaTrustedApprovers />
        </BasicAppContext>
      )
      await act(async () => undefined)
      return tree
    }
    const declined = await run(false)
    expect(declined.getByTestId(testIdWithKey(TrustedApproversIds.approver(JORDAN)))).toBeTruthy()
    expect(declined.queryByTestId(testIdWithKey(TrustedApproversIds.guardianUnverified(JORDAN)))).toBeNull()
    expect(declined.queryByTestId(testIdWithKey(TrustedApproversIds.guardianVerified(JORDAN)))).toBeNull()
    expect(declined.queryByText('Approver.GuardianCouldNotVerify')).toBeNull()
    declined.unmount()
    const shared = await run(true)
    expect(shared.getByTestId(testIdWithKey(TrustedApproversIds.guardianVerified(JORDAN)))).toBeTruthy()
  })

  describe('the question, on the offer sheet after a yes', () => {
    const show = async (jordan: ReturnType<typeof phone>) => {
      ;(useAgent as jest.Mock).mockReturnValue({ agent: jordan.agent })
      jest.spyOn(approverRole, 'restoreRoleOfferPrompts').mockResolvedValue(undefined)
      const tree = render(
        <BasicAppContext>
          <ApproverOfferModal />
        </BasicAppContext>
      )
      await act(async () => undefined)
      return tree
    }

    test("it asks, naming the state, and Send keeps a yes and sends; Don't send keeps a no and sends nothing", async () => {
      const jordan = await jordanWithCard()
      await yesTo(jordan)
      const tree = await show(jordan)
      expect(tree.getByTestId(testIdWithKey(ApproverOfferIds.cardAsk)).props.children).toBe('Approver.CardAskTitle')
      await act(async () => {
        fireEvent.press(tree.getByTestId(testIdWithKey(ApproverOfferIds.cardSend)))
      })
      expect(await cardConsentOn(jordan.agent, CONN)).toBe('yes')
      expect(cards()).toHaveLength(1)
      expect(tree.queryByTestId(testIdWithKey(ApproverOfferIds.cardAsk))).toBeNull()
      tree.unmount()

      sent.length = 0
      const other = await jordanWithCard()
      await yesTo(other)
      const second = await show(other)
      await act(async () => {
        fireEvent.press(second.getByTestId(testIdWithKey(ApproverOfferIds.cardDont)))
      })
      expect(await cardConsentOn(other.agent, CONN)).toBe('no')
      expect(cards()).toHaveLength(0)
      expect(second.queryByTestId(testIdWithKey(ApproverOfferIds.cardAsk))).toBeNull()
    })

    test('with state-verified approvers off it asks nothing, even with a question left (control: on, it asks)', async () => {
      const jordan = await jordanWithCard()
      await yesTo(jordan)
      setStateVerifiedApproversEnabled(false)
      const off = await show(jordan)
      expect(off.queryByTestId(testIdWithKey(ApproverOfferIds.cardAsk))).toBeNull()
      off.unmount()
      setStateVerifiedApproversEnabled(true)
      const on = await show(jordan)
      expect(on.getByTestId(testIdWithKey(ApproverOfferIds.cardAsk))).toBeTruthy()
    })

    test('an open offer shows first; the question waits until no offer is open', async () => {
      const jordan = await jordanWithCard()
      await yesTo(jordan)
      approverRole.roleOfferPromptStore.set(offer(CONN2, 'Amy'))
      const tree = await show(jordan)
      expect(tree.getByTestId(testIdWithKey(ApproverOfferIds.body))).toBeTruthy()
      expect(tree.queryByTestId(testIdWithKey(ApproverOfferIds.cardAsk))).toBeNull()
    })
  })

  describe('People I approve for: changing the answer later', () => {
    const show = async (jordan: ReturnType<typeof phone>) => {
      ;(useFocusEffect as jest.Mock).mockImplementation((effect: () => void) => require('react').useEffect(effect, []))
      ;(useAgent as jest.Mock).mockReturnValue({ agent: jordan.agent })
      jest.spyOn(approverRole, 'approverNames').mockResolvedValue({})
      jest.spyOn(vtaAgent, 'trustedApprovers').mockResolvedValue({
        view: { approvers: [], keys: [], heldElsewhere: [] },
        version: 1,
      } as TrustedApproversState)
      const tree = render(
        <BasicAppContext>
          <VtaTrustedApprovers />
        </BasicAppContext>
      )
      await act(async () => undefined)
      return tree
    }

    test('never asked reads as not sent, and "Send my Guardian card" keeps a yes and sends it now', async () => {
      const jordan = await jordanWithCard()
      await yesTo(jordan)
      const tree = await show(jordan)
      expect(tree.getByTestId(testIdWithKey(TrustedApproversIds.cardStatus(CONN))).props.children).toBe(
        'Approver.CardNotSentTo'
      )
      await act(async () => {
        fireEvent.press(tree.getByTestId(testIdWithKey(TrustedApproversIds.cardSend(CONN))))
      })
      expect(await cardConsentOn(jordan.agent, CONN)).toBe('yes')
      expect(cards()).toHaveLength(1)
      expect(tree.getByTestId(testIdWithKey(TrustedApproversIds.cardStop(CONN)))).toBeTruthy()
    })

    test('a kept yes reads as sent, and "Stop sending" keeps a no, so a re-offer sends nothing', async () => {
      const jordan = await jordanWithCard()
      await setCardConsent(jordan.agent, CONN, 'yes')
      await yesTo(jordan)
      sent.length = 0
      const tree = await show(jordan)
      expect(tree.getByTestId(testIdWithKey(TrustedApproversIds.cardStatus(CONN))).props.children).toBe(
        'Approver.CardSentTo'
      )
      await act(async () => {
        fireEvent.press(tree.getByTestId(testIdWithKey(TrustedApproversIds.cardStop(CONN))))
      })
      expect(await cardConsentOn(jordan.agent, CONN)).toBe('no')
      tree.unmount()
      await yesTo(jordan)
      expect(cards()).toHaveLength(0)
    })

    test('no card held, or state-verified approvers off: no card line (control: both, it shows)', async () => {
      const bare = phone()
      await yesTo(bare)
      const none = await show(bare)
      expect(none.queryByTestId(testIdWithKey(TrustedApproversIds.cardStatus(CONN)))).toBeNull()
      none.unmount()
      const jordan = await jordanWithCard()
      await yesTo(jordan)
      setStateVerifiedApproversEnabled(false)
      const off = await show(jordan)
      expect(off.queryByTestId(testIdWithKey(TrustedApproversIds.cardStatus(CONN)))).toBeNull()
      off.unmount()
      setStateVerifiedApproversEnabled(true)
      const on = await show(jordan)
      expect(on.getByTestId(testIdWithKey(TrustedApproversIds.cardStatus(CONN)))).toBeTruthy()
    })
  })
})
