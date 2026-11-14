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
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'
import { trustTaskPayloadValidator } from '@bifold/trust-tasks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import * as guardianModule from '../../sedi/guardian'
import * as stateRoots from '../../sedi/guardian/stateRoots'
import { K0_REVOKED_OMITTED_CARD } from '../../sedi/guardian/k0RevokedOmittedCard'
import { wardNamedIn } from '../../sedi/guardian/chain'
import { WARD_IDENTITY, wardCodeOf } from '../../sedi/identity/phoneIdentity'
import { STATE_CARD_REMOTE_OFF, isStateCardEnabled, setStateCardEnabled } from '../../sedi/holder/stateCardFlag'
import * as websModule from '../../sedi/webs'
import * as lastLive from '../../sedi/webs/lastLive'
import * as websResolve from '../../sedi/webs/resolve'
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
  guardianCardAfterKeep,
  cardConsentRootOn,
  setCardConsent,
  shareGuardianCard,
  checkGuardianEvidence,
  heldGuardianEvidence,
  holdK0TestGuardianCard,
  holdK0RevokedTestCard,
  stateWardOf,
  evidenceBytes,
  resetGuardianCheckMemo,
  guardianStandings,
  guardianSourceKey,
  handleGuardianEvidence,
  holdGuardianEvidence,
  sendGuardianEvidence,
  setStateWard,
  type GuardianEvidence,
  type GuardianOnAsk,
  type GuardianStanding,
  type GuardianVerdict,
  phoneWardsOf,
  unsetStateWard,
  wardToCheck,
} from '../guardianEvidence'
import { SEDI_KERI_REMOTE_OFF } from '../module/sediKeriRemoteOff'
import {
  STATE_VERIFIED_APPROVERS_REMOTE_OFF,
  isStateVerifiedApproversEnabled,
  setStateVerifiedApproversEnabled,
} from '../module/stateVerifiedApproversFlag'
import {
  TRUSTED_APPROVERS_REMOTE_OFF,
  isTrustedApproversEnabled,
  setTrustedApproversEnabled,
} from '../module/trustedApproversFlag'
import { isTrustTestStateEnabled, setTrustTestStateEnabled } from '../module/trustTestStateFlag'
import {
  CONFIRM_ITS_YOU_REMOTE_OFF,
  isConfirmItsYouEnabled,
  setConfirmItsYouEnabled,
} from '../module/confirmItsYouFlag'
import { sediDemoHiddenByKill, setUpSediDemo, turnOffSediDemo } from '../developerTestState'
import * as evidenceModule from '../guardianEvidence'
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
/** The K0 root, the state a yes to sending the K0 card is kept for (literal; asserted against the list below). */
const K0_ROOT_AID = 'IMTne_Mkgzgf4iVRanVTxV3RdtL1ggDUKdKOv2OuSBd6'

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
    expect(sam.askRecord().guardian?.verdict).toMatchObject({
      ok: true,
      state: 'Example State',
      demo: true,
      test: true,
    })
    expect(sam.askRecord().guardian?.approver).toBe(JORDAN)
    expect(sam.raw.genericRecords.deleteById).not.toHaveBeenCalled()
    expect(await guardianStandings(sam.agent)).toEqual({
      [JORDAN]: { kind: 'verified', state: 'Example State', demo: true, test: true },
    })
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

describe("on the person's phone: the card names this phone's OWN ward code (K1 test, 11-14)", () => {
  // Literals, so a guard that reads the wrong field can't pass by comparing a value with itself.
  const SAM = 'IFDf7z58Wp19EQ-EjCviVU2sgmFnjecWqCEaNsAz8lq6'
  const OTHER = 'IJpj8_jwPauLZMmIjiglQEvnOC0Lfw9nV-LCEKovbEIk'
  const G_OK = 'EE77k2PeUVmo7nPAEjvZ-R-8G3UsxLbmaOM__tG3I6PC'
  /** This phone's own ward code, as phoneIdentity keeps it once the codes screen made it. */
  const ownCode = (sam: ReturnType<typeof phone>, aid: string) =>
    sam.rows.push({
      id: `own-${aid}`,
      tags: { recordType: WARD_IDENTITY },
      content: { aid, keyId: 'k-own', createdAt: '2026-11-13T21:00:00.000Z' },
    })
  /** Sam's phone with the ward `set` (null: none) and its own code `own` (null: never made), then the card arrives. */
  async function arrivesWith(set: string | null, own: string | null) {
    const sam = phone()
    if (set !== null) await setStateWard(sam.agent, set)
    if (own !== null) ownCode(sam, own)
    sam.ask()
    await handleGuardianEvidence(sam.agent, sam.service, documentOf(card('G-ok')), context)
    return sam
  }

  test("the fixture is what these rows assume: K0's G-ok names Sam as its ward", () => {
    expect([SAM_WARD, OTHER_WARD, prov.creds['G-ok'].said]).toEqual([SAM, OTHER, G_OK])
    expect(wardNamedIn(card('G-ok').creds, G_OK)).toBe(SAM)
  })

  test('another ward set ("Set up as the person" after "Use this code"): valid on arrival and on open (control: no own code, wardMismatch)', async () => {
    const sam = await arrivesWith(OTHER, SAM)
    expect(sam.askRecord().guardian?.verdict).toMatchObject({ ok: true, state: 'Example State' })
    expect(await guardianStandings(sam.agent)).toEqual({
      [JORDAN]: { kind: 'verified', state: 'Example State', demo: true, test: true },
    })
    const control = await arrivesWith(OTHER, null)
    expect(control.askRecord().guardian?.verdict).toMatchObject({ ok: false, reason: 'wardMismatch' })
  })

  test('no ward set at all: valid with no Developer step (control: no own code, noWard)', async () => {
    const sam = await arrivesWith(null, SAM)
    expect(sam.askRecord().guardian?.verdict).toMatchObject({ ok: true })
    const control = await arrivesWith(null, null)
    expect(control.askRecord().guardian?.verdict).toMatchObject({ ok: false, reason: 'noWard' })
  })

  test('an own code the card does not name changes nothing: the ward set still checks it, and the refusals read as before', async () => {
    expect((await arrivesWith(SAM, OTHER)).askRecord().guardian?.verdict).toMatchObject({ ok: true })
    expect((await arrivesWith(null, OTHER)).askRecord().guardian?.verdict).toMatchObject({
      ok: false,
      reason: 'noWard',
    })
    expect((await arrivesWith(G_OK, OTHER)).askRecord().guardian?.verdict).toMatchObject({
      ok: false,
      reason: 'wardMismatch',
    })
  })

  test('a check never makes a code: with none made, no key is asked of the key store and none is saved (control: making one does)', async () => {
    const sam = phone()
    const createKey = jest.fn(async () => ({
      keyId: 'k-new',
      publicJwk: { kty: 'OKP', crv: 'Ed25519', x: 'A'.repeat(43) },
    }))
    Object.assign(sam.raw.kms, { createKey })
    await setStateWard(sam.agent, SAM)
    sam.ask()
    await handleGuardianEvidence(sam.agent, sam.service, documentOf(card('G-ok')), context)
    await guardianStandings(sam.agent)
    expect(createKey).not.toHaveBeenCalled()
    expect(sam.rows.filter((r) => r.tags.recordType === WARD_IDENTITY)).toEqual([])
    // Control: the codes screen's own call does make one, through the same fake.
    expect(await wardCodeOf(sam.agent)).toEqual(expect.any(String))
    expect(createKey).toHaveBeenCalledTimes(1)
  })

  test('the code first made after the card came: the next open checks again and reads valid, written in place', async () => {
    const sam = await arrivesWith(OTHER, null)
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'unverified', outcome: 'wardMismatch' } })
    ownCode(sam, SAM)
    expect(await guardianStandings(sam.agent)).toEqual({
      [JORDAN]: { kind: 'verified', state: 'Example State', demo: true, test: true },
    })
    expect(sam.askRecord().guardian?.verdict).toMatchObject({ ok: true })
  })

  test.each([
    ['trusted approvers', setTrustedApproversEnabled],
    ['state-verified approvers', setStateVerifiedApproversEnabled],
  ])('with %s off, the own code is not read (control: both on, it is)', async (_name, setOn) => {
    const sam = phone()
    ownCode(sam, SAM)
    expect(await phoneWardsOf(sam.agent)).toEqual({ set: null, own: SAM })
    setOn(false)
    expect(await phoneWardsOf(sam.agent)).toEqual({ set: null, own: null })
  })

  test("the guardian's setup (unsetStateWard writes an EMPTY ward): a card naming this phone's own code verifies, any other reads noWard", async () => {
    const own = phone()
    await setStateWard(own.agent, OTHER)
    await unsetStateWard(own.agent)
    // The real write: an empty ward kept, not no record.
    expect(own.rows.filter((r) => r.tags.recordType === 'keyring.sedi-state-ward').map((r) => r.content.ward)).toEqual([
      '',
    ])
    ownCode(own, SAM)
    own.ask()
    await handleGuardianEvidence(own.agent, own.service, documentOf(card('G-ok')), context)
    expect(own.askRecord().guardian?.verdict).toMatchObject({ ok: true })
    // Control: the same setup, its own code another one: refused as no ward set.
    const other = phone()
    await setStateWard(other.agent, OTHER)
    await unsetStateWard(other.agent)
    ownCode(other, OTHER)
    other.ask()
    await handleGuardianEvidence(other.agent, other.service, documentOf(card('G-ok')), context)
    expect(other.askRecord().guardian?.verdict).toMatchObject({ ok: false, reason: 'noWard' })
  })

  test('wardToCheck chooses only between the two wards of this phone, by the card it is given', () => {
    const ok = card('G-ok')
    expect(wardToCheck({ set: OTHER, own: SAM }, ok)).toBe(SAM)
    expect(wardToCheck({ set: OTHER, own: OTHER }, ok)).toBe(OTHER)
    expect(wardToCheck({ set: null, own: OTHER }, ok)).toBeNull()
    expect(wardToCheck({ set: OTHER, own: null }, ok)).toBe(OTHER)
    // The card's SAID must be the one named: another credential's ward is never read as this card's.
    expect(wardToCheck({ set: OTHER, own: SAM }, { ...ok, guardianSaid: prov.creds['G-revoked'].said })).toBe(OTHER)
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
    expect(await guardianStandings(sam.agent)).toEqual({
      [JORDAN]: { kind: 'verified', state: 'Example State', demo: true, test: true },
    })
  })

  test('a release with the setting on verifies the K0 card as "Example State" (control: switched off again, it does not)', async () => {
    asBuild(false)
    setTrustTestStateEnabled(true)
    const sam = await arrives(card('G-ok'))
    expect(await guardianStandings(sam.agent)).toEqual({
      [JORDAN]: { kind: 'verified', state: 'Example State', demo: true, test: true },
    })
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
    // All on: the K0 root, and K1 (the state office's root, trusted with both switches on, no setting needed), pinned by
    // literals so a wrong AID, name or demo mark on K1's entry fails here; exactly two, so a third root fails too.
    const all = stateRoots.trustedStateRoots()
    expect(all).toHaveLength(2)
    expect(all[0]).toEqual(stateRoots.K0_TEST_ROOT)
    expect(all[1]).toMatchObject({
      aid: 'IIOfwtkpq00RMwoUH8346kzNKq877GJXQStI6Dyg66Bs',
      name: 'State of Utah',
      demo: true,
    })
    off()
    expect(stateRoots.trustedStateRoots()).toEqual([])
  })

  test('it adds the K0 root only: a card from another root still reads untrustedRoot (control: the K0 card verifies)', async () => {
    asBuild(false)
    setTrustTestStateEnabled(true)
    const other = await arrives(card('G-untrusted'))
    expect(await guardianStandings(other.agent)).toEqual({ [JORDAN]: { kind: 'unverified', outcome: 'untrustedRoot' } })
    const sam = await arrives(card('G-ok'))
    expect(await guardianStandings(sam.agent)).toEqual({
      [JORDAN]: { kind: 'verified', state: 'Example State', demo: true, test: true },
    })
  })

  test("the name and the demo mark shown are our entry's, never what the card claims (control: the K0 root is named so)", () => {
    asBuild(false)
    setTrustTestStateEnabled(true)
    expect(stateRoots.K0_TEST_ROOT).toMatchObject({ name: 'Example State', demo: true, test: true })
    const claims = { ...card('G-ok'), state: 'Utah', name: 'Utah', demo: false } as unknown as GuardianEvidence
    const verdict = checkGuardianEvidence(claims, SAM_WARD, new Date(), () => undefined)
    expect(verdict).toMatchObject({
      ok: true,
      state: 'Example State',
      demo: true,
      test: true,
      root: stateRoots.K0_TEST_ROOT.aid,
    })
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
    expect(await holdK0RevokedTestCard(jordan.agent)).toBe('off')
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

  test.each([
    ['the test-state setting off', () => setTrustTestStateEnabled(false)],
    ['state-verified approvers turned off remotely', () => (STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = true)],
    ['the SEDI/KERI umbrella off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
  ])(
    '"Hold the revoked card without its revocation (K0)": %s: nothing is held (control: on, it holds that card in place of the G-ok one)',
    async (_, off) => {
      const exported = jest.requireActual('../developerTestState') as typeof import('../developerTestState')
      const jordan = phone()
      expect(await holdK0TestGuardianCard(jordan.agent)).toBe('done')
      off()
      expect(await exported.holdK0RevokedOmittedCard(jordan.agent)).toBe('off')
      allOn()
      setTrustTestStateEnabled(true)
      expect(await heldGuardianEvidence(jordan.agent)).toEqual(card('G-ok'))
      expect(await exported.holdK0RevokedOmittedCard(jordan.agent)).toBe('done')
      expect(await heldGuardianEvidence(jordan.agent)).toEqual(K0_REVOKED_OMITTED_CARD)
    }
  )

  test('"Hold the revoked test card (K0)" holds the K0 revoked card WITH its revocation, replacing the ok card (control: the ok card first)', async () => {
    const jordan = phone()
    expect(await holdK0TestGuardianCard(jordan.agent)).toBe('done')
    expect(await heldGuardianEvidence(jordan.agent)).toEqual(card('G-ok'))
    expect(await holdK0RevokedTestCard(jordan.agent)).toBe('done')
    expect(await heldGuardianEvidence(jordan.agent)).toEqual(card('G-revoked'))
  })

  test('a revoked card whose bundle omits its revocation is refused as statusNotCurrent: the issuer KEL anchors the omitted update (control: the full revoked card is refused as revoked)', async () => {
    g.__DEV__ = false
    const full = card('G-revoked')
    // The omission: G-revoked's status log cut to its issuance, with the issued-state proof, as a holder could send it.
    const omitted: GuardianEvidence = {
      ...full,
      tels: [full.tels[0], full.tels[1], tel('G-revoked', ['issued'])],
      creds: [full.creds[0], full.creds[1], text('acdc-G-revoked-issued-proofed.cesr')],
    }
    const omittedVerdict = checkGuardianEvidence(omitted, SAM_WARD, new Date(), () => undefined)
    expect(omittedVerdict).toMatchObject({ ok: false, reason: 'statusNotCurrent' })
    // Sue's KEL, which comes with the card itself, still carries the seal for the n=2 update the bundle left out.
    expect((omittedVerdict as { detail: string }).detail).toMatch(
      /anchors registry events to n=2, the newest presented is n=1/
    )
    const sam = phone()
    await becomeK0TestWard(sam.agent)
    sam.ask()
    await handleGuardianEvidence(sam.agent, sam.service, documentOf(omitted), context)
    expect(await guardianStandings(sam.agent)).toEqual({
      [JORDAN]: { kind: 'unverified', outcome: 'statusNotCurrent' },
    })
    // Control: the full revoked card, revocation included, is refused as revoked.
    expect(checkGuardianEvidence(full, SAM_WARD, new Date(), () => undefined)).toMatchObject({
      ok: false,
      reason: 'revoked',
    })
  })

  test('a tester build: Jordan holds the revoked test card, and Sam refuses it as revoked (control: the ok card verifies)', async () => {
    g.__DEV__ = false
    const sam = phone()
    await becomeK0TestWard(sam.agent)
    sam.ask()
    const jordan = phone()
    await holdK0RevokedTestCard(jordan.agent)
    await handleGuardianEvidence(
      sam.agent,
      sam.service,
      documentOf((await heldGuardianEvidence(jordan.agent))!),
      context
    )
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'unverified', outcome: 'revoked' } })
    const control = phone()
    await becomeK0TestWard(control.agent)
    control.ask()
    await holdK0TestGuardianCard(jordan.agent)
    await handleGuardianEvidence(
      control.agent,
      control.service,
      documentOf((await heldGuardianEvidence(jordan.agent))!),
      context
    )
    expect(await guardianStandings(control.agent)).toEqual({
      [JORDAN]: { kind: 'verified', state: 'Example State', demo: true, test: true },
    })
  })

  test('as the package exports them, the actions are the same and gated the same (control: on, they act)', async () => {
    const exported = jest.requireActual('../developerTestState') as typeof import('../developerTestState')
    setTrustTestStateEnabled(false)
    const jordan = phone()
    const sam = phone()
    expect(await exported.holdK0TestGuardianCard(jordan.agent)).toBe('off')
    expect(await exported.holdK0RevokedTestCard(jordan.agent)).toBe('off')
    expect(await exported.becomeK0TestWard(sam.agent)).toBe('off')
    setTrustTestStateEnabled(true)
    expect(await exported.holdK0TestGuardianCard(jordan.agent)).toBe('done')
    expect(await exported.becomeK0TestWard(sam.agent)).toBe('done')
    expect(await heldGuardianEvidence(jordan.agent)).toEqual(card('G-ok'))
    expect(await stateWardOf(sam.agent)).toBe(SAM_WARD)
  })

  test('a tester build, end to end: Jordan holds the test card, Sam is the test ward, and it verifies as "Example State"', async () => {
    g.__DEV__ = false
    const jordan = phone()
    await holdK0TestGuardianCard(jordan.agent)
    const held = (await heldGuardianEvidence(jordan.agent)) as GuardianEvidence
    const sam = phone()
    await becomeK0TestWard(sam.agent)
    sam.ask()
    await handleGuardianEvidence(sam.agent, sam.service, documentOf(held), context)
    expect(await guardianStandings(sam.agent)).toEqual({
      [JORDAN]: { kind: 'verified', state: 'Example State', demo: true, test: true },
    })
  })
})

describe('Developer action: "Set up the SEDI demo" in one tap, and "Turn off the SEDI demo"', () => {
  const allSwitchesOff = () => {
    setTrustedApproversEnabled(false)
    setStateVerifiedApproversEnabled(false)
    setTrustTestStateEnabled(false)
    setStateCardEnabled(false)
    setConfirmItsYouEnabled(false)
  }
  // The four switches the one-tap turns on, in order: trusted approvers, state-verified approvers, the test state, the
  // holder's state card; and last Confirm it's you, which it leaves as it is (Alberto, 11-14).
  const states = () => [
    isTrustedApproversEnabled(),
    isStateVerifiedApproversEnabled(),
    isTrustTestStateEnabled(),
    isStateCardEnabled(),
    isConfirmItsYouEnabled(),
  ]
  beforeEach(() => {
    STATE_CARD_REMOTE_OFF.off = false
    CONFIRM_ITS_YOU_REMOTE_OFF.off = false
    allSwitchesOff()
  })
  afterEach(() => {
    STATE_CARD_REMOTE_OFF.off = false
    CONFIRM_ITS_YOU_REMOTE_OFF.off = false
    setTrustTestStateEnabled(false)
    setStateCardEnabled(false)
    setConfirmItsYouEnabled(false)
  })

  test("from everything off: the four switches on (the state card too, never Confirm it's you), the K0 card held and the K0 ward set (control: before it, all off)", async () => {
    expect(states()).toEqual([false, false, false, false, false])
    const phoneA = phone()
    expect(await setUpSediDemo(phoneA.agent)).toBe('done')
    expect(states()).toEqual([true, true, true, true, false])
    expect(sediDemoHiddenByKill()).toEqual([])
    expect(await heldGuardianEvidence(phoneA.agent)).toEqual(card('G-ok'))
    expect(await stateWardOf(phoneA.agent)).toBe(SAM_WARD)
  })

  test.each([
    ['the SEDI/KERI umbrella off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
    ['trusted approvers turned off remotely', () => (TRUSTED_APPROVERS_REMOTE_OFF.off = true)],
    ['state-verified approvers turned off remotely', () => (STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = true)],
  ])(
    '%s: it says so and does nothing, no switch on and nothing kept (control: cleared, it sets up)',
    async (_, kill) => {
      kill()
      const phoneA = phone()
      expect(await setUpSediDemo(phoneA.agent)).toBe('remoteOff')
      allOn()
      allSwitchesOff()
      // The kill above is cleared by allOn; the switches it would have turned on must still be off, and nothing kept.
      expect(states()).toEqual([false, false, false, false, false])
      expect(await heldGuardianEvidence(phoneA.agent)).toBeUndefined()
      expect(await stateWardOf(phoneA.agent)).toBeNull()
      expect(await setUpSediDemo(phoneA.agent)).toBe('done')
      expect(states()).toEqual([true, true, true, true, false])
    }
  )

  test('the umbrella off: the raw switches stay off too, read before anything is turned on (control: the row above)', async () => {
    SEDI_KERI_REMOTE_OFF.off = true
    const phoneA = phone()
    await setUpSediDemo(phoneA.agent)
    SEDI_KERI_REMOTE_OFF.off = false
    expect(states()).toEqual([false, false, false, false, false])
  })

  test('the undo turns the four switches off (the state card too) and deletes nothing: the card and ward stay kept (control: set up, all on)', async () => {
    const phoneA = phone()
    await setUpSediDemo(phoneA.agent)
    expect(states()).toEqual([true, true, true, true, false])
    turnOffSediDemo()
    expect(states()).toEqual([false, false, false, false, false])
    expect(phoneA.rows.filter((r) => r.tags.recordType === GUARDIAN_EVIDENCE_HELD)).toHaveLength(1)
    expect(await stateWardOf(phoneA.agent)).toBe(SAM_WARD)
  })

  test('the one-tap turns the holder state card on, and the undo turns it off (control: before the tap, it is off)', async () => {
    expect(isStateCardEnabled()).toBe(false)
    expect(await setUpSediDemo(phone().agent)).toBe('done')
    expect(isStateCardEnabled()).toBe(true)
    turnOffSediDemo()
    expect(isStateCardEnabled()).toBe(false)
  })

  test("the state card's own remote off does not stop the setup: doneSomeHidden naming the card, the others visible; cleared, it shows (control: the umbrella stops it)", async () => {
    STATE_CARD_REMOTE_OFF.off = true
    const phoneA = phone()
    expect(await setUpSediDemo(phoneA.agent)).toBe('doneSomeHidden')
    expect(sediDemoHiddenByKill()).toEqual(['stateCard'])
    expect(states()).toEqual([true, true, true, false, false])
    expect(await heldGuardianEvidence(phoneA.agent)).toEqual(card('G-ok'))
    STATE_CARD_REMOTE_OFF.off = false
    expect(isStateCardEnabled()).toBe(true)
    allSwitchesOff()
    SEDI_KERI_REMOTE_OFF.off = true
    expect(await setUpSediDemo(phone().agent)).toBe('remoteOff')
    SEDI_KERI_REMOTE_OFF.off = false
    expect(states()).toEqual([false, false, false, false, false])
  })

  test("Confirm it's you is its own switch: the one-tap and the undo leave it on when on, and off when off (Alberto, 11-14)", async () => {
    setConfirmItsYouEnabled(true)
    expect(await setUpSediDemo(phone().agent)).toBe('done')
    expect(isConfirmItsYouEnabled()).toBe(true)
    turnOffSediDemo()
    expect(isConfirmItsYouEnabled()).toBe(true)
    // Control: off stays off through both.
    setConfirmItsYouEnabled(false)
    expect(await setUpSediDemo(phone().agent)).toBe('done')
    expect(isConfirmItsYouEnabled()).toBe(false)
    turnOffSediDemo()
    expect(isConfirmItsYouEnabled()).toBe(false)
  })

  test("Confirm it's you's own remote off is not the one-tap's to report: done, nothing hidden (control: the state card's is reported)", async () => {
    CONFIRM_ITS_YOU_REMOTE_OFF.off = true
    expect(await setUpSediDemo(phone().agent)).toBe('done')
    expect(sediDemoHiddenByKill()).toEqual([])
    STATE_CARD_REMOTE_OFF.off = true
    allSwitchesOff()
    expect(await setUpSediDemo(phone().agent)).toBe('doneSomeHidden')
    expect(sediDemoHiddenByKill()).toEqual(['stateCard'])
  })

  // Each way the one-tap can stop is its own result (ac, #1033): a card over the size cap is not "a release turned
  // this off". The steps are reached through the module object (developerTestState requires it lazily), so a spy on
  // it stands in for the card or ward failing.
  describe('a step that fails says which step, and the switches it turned on stay on', () => {
    afterEach(() => {
      jest.restoreAllMocks()
      SEDI_KERI_REMOTE_OFF.off = false
    })

    test('the card over the size cap: cardNotHeld, never remoteOff; switches on, ward still set (control: no failure, done)', async () => {
      const control = phone()
      expect(await setUpSediDemo(control.agent)).toBe('done')
      allSwitchesOff()
      jest.spyOn(evidenceModule, 'keepK0TestGuardianCard').mockResolvedValue('tooLarge')
      const phoneA = phone()
      expect(await setUpSediDemo(phoneA.agent)).toBe('cardNotHeld')
      expect(states()).toEqual([true, true, true, true, false])
      expect(await heldGuardianEvidence(phoneA.agent)).toBeUndefined()
      expect(await stateWardOf(phoneA.agent)).toBe(SAM_WARD)
    })

    test('the card step throws: cardNotHeld (control: it resolves done, setup is done)', async () => {
      const spy = jest.spyOn(evidenceModule, 'keepK0TestGuardianCard').mockRejectedValueOnce(new Error('storage'))
      expect(await setUpSediDemo(phone().agent)).toBe('cardNotHeld')
      spy.mockRestore()
      allSwitchesOff()
      expect(await setUpSediDemo(phone().agent)).toBe('done')
    })

    test('the ward step fails: wardNotSet, the card still held and the switches on (control: no failure, done)', async () => {
      jest.spyOn(evidenceModule, 'becomeK0TestWard').mockRejectedValue(new Error('storage'))
      const phoneA = phone()
      expect(await setUpSediDemo(phoneA.agent)).toBe('wardNotSet')
      expect(states()).toEqual([true, true, true, true, false])
      expect(await heldGuardianEvidence(phoneA.agent)).toEqual(card('G-ok'))
      expect(await stateWardOf(phoneA.agent)).toBeNull()
      jest.restoreAllMocks()
      allSwitchesOff()
      expect(await setUpSediDemo(phone().agent)).toBe('done')
    })

    test('both steps fail: the card is named first, and both were attempted (control: the ward-only row above)', async () => {
      jest.spyOn(evidenceModule, 'keepK0TestGuardianCard').mockResolvedValue('tooLarge')
      const ward = jest.spyOn(evidenceModule, 'becomeK0TestWard').mockRejectedValue(new Error('storage'))
      expect(await setUpSediDemo(phone().agent)).toBe('cardNotHeld')
      expect(ward).toHaveBeenCalledTimes(1)
    })

    test('a kill landing during the card step: remoteOff, not cardNotHeld; the raw switches stay on (control: no kill, done)', async () => {
      jest.spyOn(evidenceModule, 'keepK0TestGuardianCard').mockImplementation(async () => {
        SEDI_KERI_REMOTE_OFF.off = true
        return 'off'
      })
      expect(await setUpSediDemo(phone().agent)).toBe('remoteOff')
      SEDI_KERI_REMOTE_OFF.off = false
      expect(states()).toEqual([true, true, true, true, false])
      jest.restoreAllMocks()
      allSwitchesOff()
      expect(await setUpSediDemo(phone().agent)).toBe('done')
    })
  })
})

describe('the demo state is marked on our list, never inferred', () => {
  test('isDemoStateRoot is true for the K0 entry only (control: another AID, and an entry named the same, are not)', () => {
    expect(stateRoots.isDemoStateRoot(stateRoots.K0_TEST_ROOT.aid)).toBe(true)
    expect(stateRoots.isDemoStateRoot(prov.aids['mal-root'])).toBe(false)
    expect(stateRoots.isDemoStateRoot('State of Utah')).toBe(false)
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

  test('a yes set aside with "Not now" still shows its card beside it (control: forgotten, closed, it does not)', async () => {
    const sam = phone()
    await setStateWard(sam.agent, SAM_WARD)
    sam.ask({ state: 'setAside' })
    await handleGuardianEvidence(sam.agent, sam.service, documentOf(card('G-ok')), context)
    expect(Object.keys(await guardianStandings(sam.agent))).toEqual([JORDAN])
    const record = sam.rows.find((r) => r.tags.recordType === approverRole.ROLE_OFFER_ASK) as Row
    record.content = { ...record.content, state: 'closed' }
    expect(await guardianStandings(sam.agent)).toEqual({})
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
    expect(await guardianStandings(sam.agent)).toEqual({
      [JORDAN]: { kind: 'verified', state: 'Example State', demo: true, test: true },
    })
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
    expect(await guardianStandings(sam.agent)).toEqual({
      [JORDAN]: { kind: 'verified', state: 'Example State', demo: true, test: true },
    })

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
    expect(await guardianStandings(sam.agent)).toEqual({
      [JORDAN]: { kind: 'verified', state: 'Example State', demo: true, test: true },
    })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(await guardianStandings(sam.agent)).toEqual({
      [JORDAN]: { kind: 'verified', state: 'Example State', demo: true, test: true },
    })
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
      { kind: 'verified', state: 'Example State', demo: true, test: true },
    ],
    [
      'the name we show for a trusted root',
      async () => {
        jest.spyOn(stateRoots, 'trustedStateRoots').mockReturnValue([{ aid: K0.aid, name: 'Renamed state' }])
      },
      { kind: 'verified', state: 'Renamed state' },
    ],
    [
      'the demo mark on a trusted root',
      async () => {
        jest.spyOn(stateRoots, 'trustedStateRoots').mockReturnValue([{ aid: K0.aid, name: K0.name }])
      },
      { kind: 'verified', state: 'Example State' },
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

  test('a demo mark ADDED to a root: the next open checks again and shows the Demo pill (control: unmarked, no pill)', async () => {
    // The direction that matters: a cached verdict without the mark would let a demo root read as a real state.
    jest.spyOn(stateRoots, 'trustedStateRoots').mockReturnValue([{ aid: K0.aid, name: K0.name }])
    const sam = await arrives(card('G-ok'))
    const spy = checks()
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'verified', state: 'Example State' } })
    await guardianStandings(sam.agent)
    expect(spy).toHaveBeenCalledTimes(1)
    jest.spyOn(stateRoots, 'trustedStateRoots').mockReturnValue([K0])
    expect(await guardianStandings(sam.agent)).toEqual({
      [JORDAN]: { kind: 'verified', state: 'Example State', demo: true, test: true },
    })
    expect(spy).toHaveBeenCalledTimes(2)
  })

  test('the demo mark moved: the kept verdict is written back without it (control: unmoved, it keeps demo)', async () => {
    const sam = await arrives(card('G-ok'))
    await guardianStandings(sam.agent)
    const kept = () => (askRow(sam).content as unknown as approverRole.RoleOfferAsk).guardian?.verdict
    expect(kept()).toMatchObject({ ok: true, state: 'Example State', demo: true, test: true })
    jest.spyOn(stateRoots, 'trustedStateRoots').mockReturnValue([{ aid: K0.aid, name: K0.name }])
    await guardianStandings(sam.agent)
    expect(kept()).toMatchObject({ ok: true, state: 'Example State' })
    expect(kept()).not.toHaveProperty('demo')
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
    expect(await guardianStandings(sam.agent)).toEqual({
      [JORDAN]: { kind: 'verified', state: 'Example State', demo: true, test: true },
    })
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
    expect(await guardianStandings(sam.agent)).toEqual({
      [JORDAN]: { kind: 'verified', state: 'Example State', demo: true, test: true },
    })
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
    await setCardConsent(jordan.agent, CONN, 'yes', K0_ROOT_AID)
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
    await setCardConsent(jordan.agent, CONN, 'yes', K0_ROOT_AID)
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

  test('the K0 state shows "Example State" with the Demo pill beside it (control: the row below, a root not marked demo)', async () => {
    const sam = await writtenWith(card('G-ok'))
    expect(await guardianStandings(sam.agent)).toEqual({
      [JORDAN]: { kind: 'verified', state: 'Example State', demo: true, test: true },
    })
    const tree = await showFor(sam)
    expect(tree.getByTestId(id(TrustedApproversIds.guardianVerified(JORDAN)))).toBeTruthy()
    expect(tree.getByTestId(id(TrustedApproversIds.guardianDemo(JORDAN)))).toBeTruthy()
  })

  test('a root our list does not mark demo gets no pill, even named "State of Utah" (control: the K0 entry above)', async () => {
    jest
      .spyOn(stateRoots, 'trustedStateRoots')
      .mockReturnValue([{ aid: stateRoots.K0_TEST_ROOT.aid, name: 'State of Utah' }])
    const sam = await writtenWith(card('G-ok'))
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'verified', state: 'State of Utah' } })
    const tree = await showFor(sam)
    expect(tree.getByTestId(id(TrustedApproversIds.guardianVerified(JORDAN)))).toBeTruthy()
    expect(tree.queryByTestId(id(TrustedApproversIds.guardianDemo(JORDAN)))).toBeNull()
  })

  test('a card carrying its revocation: "The card shows it was revoked", never "Couldn\'t verify" and never verified (control: the valid row above)', async () => {
    const tree = await showFor(await writtenWith(card('G-revoked')))
    expect(tree.getByTestId(id(TrustedApproversIds.guardianRevoked(JORDAN))).props.children).toBe(
      'Approver.GuardianRevoked'
    )
    expect(tree.queryByTestId(id(TrustedApproversIds.guardianUnverified(JORDAN)))).toBeNull()
    expect(tree.queryByText('Approver.GuardianCouldNotVerify')).toBeNull()
    expect(tree.queryByTestId(id(TrustedApproversIds.guardianVerified(JORDAN)))).toBeNull()
  })

  test('any other refusal keeps "Couldn\'t verify" with its outcome, not the revoked words (control: the revoked row above)', async () => {
    const tree = await showFor(await writtenWith(card('G-untrusted')))
    expect(tree.getByTestId(id(TrustedApproversIds.guardianUnverified(JORDAN)))).toBeTruthy()
    expect(tree.getByTestId(id(TrustedApproversIds.guardianOutcome(JORDAN)))).toBeTruthy()
    expect(tree.queryByTestId(id(TrustedApproversIds.guardianRevoked(JORDAN)))).toBeNull()
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
    expect(cardQuestions.first()).toEqual({
      connectionId: CONN,
      asker: 'Sam',
      state: 'Example State',
      demo: true,
      test: true,
    })
    expect(answers(jordan)).toHaveLength(0)
    // Control: the same phone with a kept yes for Sam sends it.
    const control = await jordanWithCard()
    await setCardConsent(control.agent, CONN, 'yes', K0_ROOT_AID)
    sent.length = 0
    await yesTo(control)
    expect(cards()).toHaveLength(1)
  })

  test("a yes kept for ANOTHER state, or before states were kept: a re-offer puts the question again, naming this card's state, and sends nothing (control: the same state, sent)", async () => {
    expect(stateRoots.K0_TEST_ROOT.aid).toBe(K0_ROOT_AID)
    for (const root of ['EOtherStateRootAidxxxxxxxxxxxxxxxxxxxxxxxxxx', undefined]) {
      const jordan = await jordanWithCard()
      await setCardConsent(jordan.agent, CONN, 'yes', root)
      cardQuestions.reset()
      sent.length = 0
      await yesTo(jordan)
      expect(cards()).toHaveLength(0)
      expect(cardQuestions.first()).toMatchObject({ connectionId: CONN, asker: 'Sam', state: 'Example State' })
    }
    const same = await jordanWithCard()
    await setCardConsent(same.agent, CONN, 'yes', K0_ROOT_AID)
    sent.length = 0
    await yesTo(same)
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
    await setCardConsent(jordan.agent, CONN, 'yes', K0_ROOT_AID)
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
    await setCardConsent(jordan.agent, CONN, 'yes', K0_ROOT_AID)
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

    test('the question shows the Demo pill for the K0 state (control: a root not marked demo, same name, shows none)', async () => {
      const jordan = await jordanWithCard()
      await yesTo(jordan)
      const tree = await show(jordan)
      expect(tree.getByTestId(testIdWithKey(ApproverOfferIds.cardAsk))).toBeTruthy()
      expect(tree.getByTestId(testIdWithKey(ApproverOfferIds.cardAskDemo))).toBeTruthy()
      tree.unmount()
      cardQuestions.reset()
      const plain = await jordanWithCard()
      jest
        .spyOn(stateRoots, 'trustedStateRoots')
        .mockReturnValue([{ aid: stateRoots.K0_TEST_ROOT.aid, name: 'State of Utah' }])
      await yesTo(plain)
      expect(cardQuestions.first()).toEqual({ connectionId: CONN, asker: 'Sam', state: 'State of Utah' })
      const control = await show(plain)
      expect(control.getByTestId(testIdWithKey(ApproverOfferIds.cardAsk))).toBeTruthy()
      expect(control.queryByTestId(testIdWithKey(ApproverOfferIds.cardAskDemo))).toBeNull()
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
      // The people I approve for are on their own tab (B-lite, 11-14).
      await act(async () => {
        fireEvent.press(tree.getByTestId(testIdWithKey(TrustedApproversIds.tabTheirs)))
      })
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
      await setCardConsent(jordan.agent, CONN, 'yes', K0_ROOT_AID)
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

  describe('a card kept AFTER the yes (a state office pick-up, K1 test 11-14): offered by the same rule', () => {
    // The root a yes was given for, kept with it: the K0 card's (literal, so the rows can't compare a value with itself).
    const K0_ROOT = 'IMTne_Mkgzgf4iVRanVTxV3RdtL1ggDUKdKOv2OuSBd6'
    const ceremonyMock = () => jest.requireMock('../ceremony') as { sendTrustTaskDocument: jest.Mock }
    /** Jordan said yes to `who` with no card held (so nothing went and nothing was asked), then keeps a card. */
    const yesThenKeep = async (who: Array<[string, string]> = [[CONN, 'Sam']]) => {
      const jordan = phone()
      jest.spyOn(stateRoots, 'trustedStateRoots').mockReturnValue([stateRoots.K0_TEST_ROOT])
      for (const [connectionId, asker] of who) await yesTo(jordan, connectionId, asker)
      expect(cards()).toHaveLength(0)
      expect(cardQuestions.first()).toBeUndefined()
      await holdGuardianEvidence(jordan.agent, card('G-ok'))
      return jordan
    }

    test("never asked: nothing goes, and the question is put now, naming the kept card's state", async () => {
      const jordan = await yesThenKeep()
      expect(await guardianCardAfterKeep(jordan.agent)).toEqual([{ connectionId: CONN, asker: 'Sam', result: 'asked' }])
      expect(cards()).toHaveLength(0)
      expect(cardQuestions.first()).toMatchObject({ connectionId: CONN, asker: 'Sam', state: 'Example State' })
    })

    test('an earlier yes to sending the card: this card goes now, for the agent and as the yes (control: before the keep, none went)', async () => {
      const jordan = await yesThenKeep()
      await setCardConsent(jordan.agent, CONN, 'yes', K0_ROOT)
      expect(await guardianCardAfterKeep(jordan.agent)).toEqual([{ connectionId: CONN, asker: 'Sam', result: 'sent' }])
      expect(cards()).toHaveLength(1)
      expect(cards()[0].payload).toMatchObject({
        agent: SAM_AGENT,
        approver: JORDAN,
        guardianSaid: card('G-ok').guardianSaid,
      })
      expect(cardQuestions.first()).toBeUndefined()
    })

    test('an earlier no: nothing goes and nothing is asked', async () => {
      const jordan = await yesThenKeep()
      await setCardConsent(jordan.agent, CONN, 'no')
      expect(await guardianCardAfterKeep(jordan.agent)).toEqual([
        { connectionId: CONN, asker: 'Sam', result: 'declined' },
      ])
      expect(cards()).toHaveLength(0)
      expect(cardQuestions.first()).toBeUndefined()
    })

    test("one person's send failing never stops the next, and is logged (control: both yes, both sent)", async () => {
      const jordan = await yesThenKeep([
        [CONN, 'Sam'],
        [CONN2, 'Amy'],
      ])
      await setCardConsent(jordan.agent, CONN, 'yes', K0_ROOT)
      await setCardConsent(jordan.agent, CONN2, 'yes', K0_ROOT)
      ceremonyMock().sendTrustTaskDocument.mockImplementationOnce(async () => {
        throw new Error('mediator down')
      })
      const results = await guardianCardAfterKeep(jordan.agent)
      expect(results.map((r) => r.result).sort()).toEqual(['failed', 'sent'])
      expect(cards()).toHaveLength(1)
      expect(jordan.warn).toHaveBeenCalledWith(expect.stringContaining('the kept card was not sent on'))
      sent.length = 0
      expect((await guardianCardAfterKeep(jordan.agent)).map((r) => r.result)).toEqual(['sent', 'sent'])
    })

    test('no one approved for, or either switch off: nothing at all (control: one yes, an answer)', async () => {
      const nobody = phone()
      await holdGuardianEvidence(nobody.agent, card('G-ok'))
      expect(await guardianCardAfterKeep(nobody.agent)).toEqual([])
      const jordan = await yesThenKeep()
      setStateVerifiedApproversEnabled(false)
      expect(await guardianCardAfterKeep(jordan.agent)).toEqual([])
      setStateVerifiedApproversEnabled(true)
      expect(await guardianCardAfterKeep(jordan.agent)).toHaveLength(1)
      expect(cards()).toHaveLength(0)
    })

    test('the fixture: K0 card G-ok chains to the K0 root these rows name', () => {
      expect(stateRoots.K0_TEST_ROOT.aid).toBe(K0_ROOT)
    })

    test("a yes given for ANOTHER state never sends this one: the question again, naming this card's state (control: same state, sent)", async () => {
      const jordan = await yesThenKeep()
      await setCardConsent(jordan.agent, CONN, 'yes', 'EOtherStateRootAidxxxxxxxxxxxxxxxxxxxxxxxxxx')
      expect(await guardianCardAfterKeep(jordan.agent)).toEqual([{ connectionId: CONN, asker: 'Sam', result: 'asked' }])
      expect(cards()).toHaveLength(0)
      expect(cardQuestions.first()).toMatchObject({ connectionId: CONN, asker: 'Sam', state: 'Example State' })
      // Answering it records this state; the next keep of a card from it sends.
      expect(await shareGuardianCard(jordan.agent, CONN, true)).toBe('sent')
      expect(await cardConsentRootOn(jordan.agent, CONN)).toBe(K0_ROOT)
      sent.length = 0
      expect((await guardianCardAfterKeep(jordan.agent)).map((r) => r.result)).toEqual(['sent'])
    })

    test('a yes kept before states were recorded is asked again, never sent on its own', async () => {
      const jordan = await yesThenKeep()
      await setCardConsent(jordan.agent, CONN, 'yes')
      expect(await guardianCardAfterKeep(jordan.agent)).toEqual([{ connectionId: CONN, asker: 'Sam', result: 'asked' }])
      expect(cards()).toHaveLength(0)
    })

    test('"Send my card" keeps the state of the card held when answering (control: no card held, none kept)', async () => {
      const none = phone()
      await setCardConsent(none.agent, CONN, 'yes')
      expect(await cardConsentRootOn(none.agent, CONN)).toBeUndefined()
      const jordan = await yesThenKeep()
      await shareGuardianCard(jordan.agent, CONN, true)
      expect(await cardConsentRootOn(jordan.agent, CONN)).toBe(K0_ROOT)
    })
  })
})

// ---------------------------------------------------------------------------------------------------------------
// A root that publishes its KEL at a did:webs (sedi/webs): read from there on each open, never the card's copy instead.

describe('a root read from its did:webs', () => {
  const WEBS_FX = join(__dirname, '..', '..', 'sedi', '__tests__', 'fixtures', 'webs-k0-root')
  const ROOT = stateRoots.K0_TEST_ROOT.aid
  const DID = `did:webs:example.org:keyring-demo-state:${ROOT}`
  const BASE = `https://example.org/keyring-demo-state/${ROOT}`
  const served = (f: string) =>
    new Uint8Array(readFileSync(join(WEBS_FX, 'example.org', 'keyring-demo-state', ROOT, f)))
  const id = (key: string) => testIdWithKey(key)
  /** The KEL example.org publishes for an AID of the K0 chain (the root, the org unit or the issuing agent). */
  const kelOf = (aid: string) =>
    new Uint8Array(readFileSync(join(WEBS_FX, 'example.org', 'keyring-demo-state', aid, 'keri.cesr')))
  const aidOfDid = (did: string) => did.slice(did.lastIndexOf(':') + 1)
  /** A replacement resolver answering each did:webs with the fixture KEL for its AID. */
  const honest = async (did: string) => ({ ok: true as const, aid: aidOfDid(did), kel: kelOf(aidOfDid(did)) })
  /** The six URLs one open asks for a demo root: the root's two artifacts, then the org unit's and the agent's. */
  const CHAIN = [ROOT, 'IBv2DqvYol_GdZH3R6M6X-UiSjqcBm6pooXoikn2alOZ', 'IDTFZ-B3B25INJli8AtIDcYRyZpwcfE7sNYaS4ISbZjx']
  const chainUrls = (at = 'example.org') =>
    CHAIN.flatMap((aid) => [
      `https://${at}/keyring-demo-state/${aid}/keri.cesr`,
      `https://${at}/keyring-demo-state/${aid}/did.json`,
    ])
  // No row here may reach the network: the platform fetch refuses unless a row puts its own in place.
  const realFetch = global.fetch
  beforeEach(() => {
    global.fetch = jest.fn(async () => {
      throw new Error('no network in tests')
    }) as never
  })
  afterEach(() => {
    global.fetch = realFetch
    websModule.setDemoStateHost(null)
  })

  /**
   * A fetch serving the K0 chain's artifacts as example.org publishes them (the root's, and the org unit's and issuing
   * agent's: a demo root's check fetches its chain's issuers too), or throwing for every URL when `down`. Counts what
   * was asked.
   */
  const host = (down = false) => {
    const asked: string[] = []
    const f = jest.fn(async (url: string) => {
      asked.push(url)
      if (down) throw new Error('offline')
      const m = /^https:\/\/example\.org\/keyring-demo-state\/([A-Za-z0-9_-]+)\/(keri\.cesr|did\.json)$/.exec(url)
      const file = m ? join(WEBS_FX, 'example.org', 'keyring-demo-state', m[1], m[2]) : null
      const body = file && existsSync(file) ? new Uint8Array(readFileSync(file)) : null
      return {
        ok: !!body,
        status: body ? 200 : 404,
        url,
        headers: { get: () => null },
        arrayBuffer: async () => (body ?? new Uint8Array()).slice().buffer as ArrayBuffer,
      }
    })
    return Object.assign(f as unknown as websModule.WebsFetch, { asked })
  }
  /** This phone's list: the K0 root, publishing at DID. */
  const rootAtWebs = () => {
    // The K0 root is a demo root: it is fetched only with a Developer "Demo state host" in effect.
    websModule.setDemoStateHost('example.org')
    return jest.spyOn(stateRoots, 'trustedStateRoots').mockReturnValue([{ ...stateRoots.K0_TEST_ROOT, webs: DID }])
  }

  /** Sam's phone with Jordan's G-ok card kept (written, so it shows), and optionally Amy's too on a second connection. */
  const kept = async (alsoAmy = false, evidence: GuardianEvidence = card('G-ok')) => {
    const sam = phone()
    await setStateWard(sam.agent, SAM_WARD)
    sam.ask({ state: 'closed', written: true, writtenAs: JORDAN })
    await handleGuardianEvidence(sam.agent, sam.service, documentOf(evidence), context)
    if (alsoAmy) {
      const jordanRow = sam.rows.find((r) => r.tags.recordType === approverRole.ROLE_OFFER_ASK)!
      const content = JSON.parse(JSON.stringify(jordanRow.content)) as Record<string, unknown> & {
        guardian: GuardianOnAsk
      }
      sam.rows.push({
        id: 'r-amy',
        tags: { recordType: approverRole.ROLE_OFFER_ASK, connectionId: CONN2 },
        content: { ...content, connectionId: CONN2, writtenAs: AMY, guardian: { ...content.guardian, approver: AMY } },
      })
    }
    return sam
  }

  test('D1: the root resolves: the card is verified, and its two artifacts were fetched (control: D3, unreachable)', async () => {
    const sam = await kept()
    rootAtWebs()
    const fetch = host()
    expect(await guardianStandings(sam.agent, { fetch })).toEqual({
      [JORDAN]: {
        kind: 'verified',
        state: 'Example State',
        demo: true,
        test: true,
        fetchedFrom: 'example.org',
        fetchedIssuers: true,
      },
    })
    // A demo root's chain issuers (the org unit and the issuing agent) are fetched from the same host and path too.
    expect(fetch.asked).toEqual(chainUrls())
  })

  test('D2: one open fetches each root once, however many cards name it (control: D4, a new open fetches again)', async () => {
    const sam = await kept(true)
    rootAtWebs()
    const fetch = host()
    expect(await guardianStandings(sam.agent, { fetch })).toEqual({
      [JORDAN]: {
        kind: 'verified',
        state: 'Example State',
        demo: true,
        test: true,
        fetchedFrom: 'example.org',
        fetchedIssuers: true,
      },
      [AMY]: {
        kind: 'verified',
        state: 'Example State',
        demo: true,
        test: true,
        fetchedFrom: 'example.org',
        fetchedIssuers: true,
      },
    })
    expect(fetch.asked).toHaveLength(6)
  })

  test("D3: the root can't be reached: unreachable, its own kind, never verified from the card's copy (control: the same card with no did:webs is verified)", async () => {
    const sam = await kept()
    expect(await guardianStandings(sam.agent, { fetch: host(true) })).toEqual({
      [JORDAN]: { kind: 'verified', state: 'Example State', demo: true, test: true },
    })
    rootAtWebs()
    expect(await guardianStandings(sam.agent, { fetch: host(true) })).toEqual({
      [JORDAN]: { kind: 'unreachable', state: 'Example State' },
    })
    expect(sam.askRecord().guardian?.verdict).toMatchObject({ ok: false, reason: 'stateNotResolved' })
  })

  test('D4: a failure is not remembered: the next open fetches again and verifies (control: D3)', async () => {
    const sam = await kept()
    rootAtWebs()
    expect((await guardianStandings(sam.agent, { fetch: host(true) }))[JORDAN].kind).toBe('unreachable')
    const fetch = host()
    expect(await guardianStandings(sam.agent, { fetch })).toEqual({
      [JORDAN]: {
        kind: 'verified',
        state: 'Example State',
        demo: true,
        test: true,
        fetchedFrom: 'example.org',
        fetchedIssuers: true,
      },
    })
    expect(fetch.asked).toHaveLength(6)
  })

  test('D5: switched off: nothing is fetched and nothing shows (control: D1)', async () => {
    const sam = await kept()
    rootAtWebs()
    setStateVerifiedApproversEnabled(false)
    const fetch = host()
    expect(await guardianStandings(sam.agent, { fetch })).toEqual({})
    expect(fetch.asked).toEqual([])
  })

  test('D6: a card whose chain does not name the root is not resolved against it (control: D1, G-ok names it)', async () => {
    const sam = phone()
    await setStateWard(sam.agent, SAM_WARD)
    sam.ask({ state: 'closed', written: true, writtenAs: JORDAN })
    await handleGuardianEvidence(sam.agent, sam.service, documentOf(card('G-untrusted')), context)
    rootAtWebs()
    const fetch = host()
    expect(await guardianStandings(sam.agent, { fetch })).toEqual({
      [JORDAN]: { kind: 'unverified', outcome: 'untrustedRoot' },
    })
    expect(fetch.asked).toEqual([])
  })

  test('D7: a card arriving while the root is unreachable is kept as stateNotResolved (control: D1)', async () => {
    rootAtWebs()
    const realFetch = global.fetch
    global.fetch = jest.fn(async () => {
      throw new Error('offline')
    }) as never
    try {
      const sam = await arrives(card('G-ok'))
      expect(sam.askRecord().guardian?.verdict).toMatchObject({ ok: false, reason: 'stateNotResolved' })
    } finally {
      global.fetch = realFetch
    }
  })

  test('D8: the resolver throwing is checkFailed, never verified (control: D1)', async () => {
    const sam = await kept()
    rootAtWebs()
    jest.spyOn(websResolve, 'resolveWebs').mockImplementation(() => {
      throw new Error('boom')
    })
    expect(await guardianStandings(sam.agent, { fetch: host() })).toEqual({
      [JORDAN]: { kind: 'unverified', outcome: 'checkFailed' },
    })
  })

  test('D10: a replacement resolver behind the one seam is used, and our fetch is not (control: D1, ours)', async () => {
    const sam = await kept()
    rootAtWebs()
    const fetch = host()
    const replacement = jest.fn(honest)
    expect(await guardianStandings(sam.agent, { fetch, resolveRootKel: replacement })).toEqual({
      [JORDAN]: {
        kind: 'verified',
        state: 'Example State',
        demo: true,
        test: true,
        fetchedFrom: 'example.org',
        fetchedIssuers: true,
      },
    })
    expect(replacement).toHaveBeenCalledWith(DID)
    expect(fetch.asked).toEqual([])
  })

  test("D11: a replacement's refusal is unreachable; its KEL is replayed again here, so a bad one is still refused (control: D10)", async () => {
    const sam = await kept()
    rootAtWebs()
    const refusing = async () => ({ ok: false as const, reason: 'unreachable', detail: 'offline' })
    expect((await guardianStandings(sam.agent, { resolveRootKel: refusing }))[JORDAN]).toEqual({
      kind: 'unreachable',
      state: 'Example State',
    })
    const tampered = new TextEncoder().encode(
      new TextDecoder('latin1').decode(served('keri.cesr')).replace('"s":"1"', '"s":"3"')
    )
    const lying = async (did: string) => (did === DID ? { ok: true as const, aid: ROOT, kel: tampered } : honest(did))
    expect((await guardianStandings(sam.agent, { resolveRootKel: lying }))[JORDAN]).toEqual({
      kind: 'unverified',
      outcome: 'kelNotReplaying',
    })
  })

  test('D12: setRootKelResolver replaces it app-wide, so the screen path needs no change (control: null restores ours)', async () => {
    const sam = await kept()
    rootAtWebs()
    const replacement = jest.fn(honest)
    websModule.setRootKelResolver(replacement)
    try {
      expect(await guardianStandings(sam.agent)).toEqual({
        [JORDAN]: {
          kind: 'verified',
          state: 'Example State',
          demo: true,
          test: true,
          fetchedFrom: 'example.org',
          fetchedIssuers: true,
        },
      })
      expect(replacement).toHaveBeenCalledTimes(3) // the root, then its two chain issuers
    } finally {
      websModule.setRootKelResolver(null)
    }
    // Forget the replacement's success (as a restart would), so the control shows our resolver is the one asked;
    // otherwise its result would rightly be reused for five minutes (sedi/webs/lastLive).
    resetGuardianCheckMemo()
    const ours = host(true)
    expect(await guardianStandings(sam.agent, { fetch: ours })).toEqual({
      [JORDAN]: { kind: 'unreachable', state: 'Example State' },
    })
    expect(ours.asked.length).toBeGreaterThan(0)
  })

  test("L1: a root fetched live: Who approves names the host it came from and says the alias check is not supported (control: from the card's copy, no such line)", async () => {
    const sam = await kept()
    ;(useFocusEffect as jest.Mock).mockImplementation((effect: () => void) => require('react').useEffect(effect, []))
    ;(useAgent as jest.Mock).mockReturnValue({ agent: sam.agent })
    jest.spyOn(approverRole, 'approverNames').mockResolvedValue({ [JORDAN]: 'Jordan' })
    jest.spyOn(vtaAgent, 'trustedApprovers').mockResolvedValue({
      view: { approvers: [JORDAN], keys: ['joinCommunity'], heldElsewhere: [] },
      version: 2,
    } as TrustedApproversState)
    const screen = async () => {
      const tree = render(
        <BasicAppContext>
          <VtaTrustedApprovers />
        </BasicAppContext>
      )
      await act(async () => undefined)
      return tree
    }
    const copy = await screen()
    expect(copy.getByTestId(id(TrustedApproversIds.guardianVerified(JORDAN)))).toBeTruthy()
    expect(copy.queryByTestId(id(TrustedApproversIds.guardianFetchedLive(JORDAN)))).toBeNull()
    copy.unmount()
    rootAtWebs()
    global.fetch = host() as never
    const live = await screen()
    expect(live.getByTestId(id(TrustedApproversIds.guardianFetchedLive(JORDAN))).props.children).toBe(
      'Approver.GuardianFetchedLive'
    )
    expect(live.getByTestId(id(TrustedApproversIds.guardianVerified(JORDAN)))).toBeTruthy()
  })

  test("H6: with the Demo state host set, the root is fetched from THAT host and the line names it, never the DID's own (control: the placeholder host is never asked)", async () => {
    const sam = await kept()
    const TUNNEL = 'abc-def.trycloudflare.com'
    const asked: string[] = []
    const tunnel = jest.fn(async (url: string) => {
      asked.push(url)
      // did.json names its own DID, so a host serves the one generated for it (the generator takes the host).
      const m = new RegExp(
        `^https://${TUNNEL.replace(/\./g, '\\.')}/keyring-demo-state/([A-Za-z0-9_-]+)/(keri\\.cesr|did\\.json)$`
      ).exec(url)
      const aid = m?.[1]
      const tdoc = (a: string) =>
        new TextEncoder().encode(
          readFileSync(join(WEBS_FX, 'example.org', 'keyring-demo-state', a, 'did.json'), 'utf8')
            .split('example.org')
            .join(TUNNEL)
        )
      const body = aid && CHAIN.includes(aid) ? (m?.[2] === 'keri.cesr' ? kelOf(aid) : tdoc(aid)) : null
      return {
        ok: !!body,
        status: body ? 200 : 404,
        url,
        headers: { get: () => null },
        arrayBuffer: async () => (body ?? new Uint8Array()).slice().buffer as ArrayBuffer,
      }
    }) as unknown as websModule.WebsFetch
    rootAtWebs()
    websModule.setDemoStateHost(TUNNEL)
    expect(await guardianStandings(sam.agent, { fetch: tunnel })).toEqual({
      [JORDAN]: {
        kind: 'verified',
        state: 'Example State',
        demo: true,
        test: true,
        fetchedFrom: TUNNEL,
        fetchedIssuers: true,
      },
    })
    expect(asked.length).toBeGreaterThan(0)
    expect(asked.every((u) => u.startsWith(`https://${TUNNEL}/`))).toBe(true)
    expect(asked.some((u) => u.includes('example.org'))).toBe(false)
  })

  test("H7: no Demo state host: the demo root is checked from the card's copy, nothing is fetched, and the line says so (control: H6, fetched live)", async () => {
    const sam = await kept()
    const fetch = host()
    expect(await guardianStandings(sam.agent, { fetch })).toEqual({
      [JORDAN]: { kind: 'verified', state: 'Example State', demo: true, test: true },
    })
    expect(fetch.asked).toHaveLength(0)
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
    expect(tree.getByTestId(id(TrustedApproversIds.guardianDemoCopy(JORDAN))).props.children).toBe(
      'Approver.GuardianTestCopy'
    )
    expect(tree.queryByTestId(id(TrustedApproversIds.guardianFetchedLive(JORDAN)))).toBeNull()
  })

  // -------------------------------------------------------------------------------------------------------------
  // A demo root's chain issuers, fetched live (revocation option (b)): a revocation is anchored in its ISSUER's key
  // history, so the org unit's and the issuing agent's published histories are read too, never only the card's.

  const SUE = CHAIN[2]
  const omitted = () => K0_REVOKED_OMITTED_CARD as GuardianEvidence
  /** A fetch serving the chain at example.org, except the AIDs in `missing` (404). */
  const hostWithout = (...missing: string[]) => {
    const all = host()
    const asked: string[] = []
    const f = jest.fn(async (url: string, init?: unknown) => {
      asked.push(url)
      if (missing.some((aid) => url.includes(`/${aid}/`)))
        return {
          ok: false,
          status: 404,
          url,
          headers: { get: () => null },
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      return (all as unknown as (u: string, i?: unknown) => Promise<unknown>)(url, init)
    })
    return Object.assign(f as unknown as websModule.WebsFetch, { asked })
  }

  test("I1: OMISSION: the card leaves out its revocation, the agent's PUBLISHED history anchors it: refused as revokedInIssuerRecord (the issuer's record) (controls: the same card from its own copy reads verified; G-ok against the same live history is verified)", async () => {
    const own = await kept(false, omitted())
    // Control 1: no host in effect, so the card is checked from its own copy (the known bound): verified.
    expect((await guardianStandings(own.agent, { fetch: host() }))[JORDAN]).toEqual({
      kind: 'verified',
      state: 'Example State',
      demo: true,
      test: true,
    })
    rootAtWebs()
    expect((await guardianStandings(own.agent, { fetch: host() }))[JORDAN]).toEqual({
      kind: 'unverified',
      outcome: 'revokedInIssuerRecord',
    })
    // Control 2: an unrevoked card against the very same live histories.
    resetGuardianCheckMemo()
    const ok = await kept()
    expect((await guardianStandings(ok.agent, { fetch: host() }))[JORDAN]).toEqual({
      kind: 'verified',
      state: 'Example State',
      demo: true,
      test: true,
      fetchedFrom: 'example.org',
      fetchedIssuers: true,
    })
  })

  test("I1b: a card that CARRIES its own revocation stays 'revoked', not the published-record reason (control: I1, the omitted one)", async () => {
    const sam = await kept(false, card('G-revoked'))
    rootAtWebs()
    expect((await guardianStandings(sam.agent, { fetch: host() }))[JORDAN]).toEqual({
      kind: 'unverified',
      outcome: 'revoked',
    })
  })

  test("I3: the issuing agent's host can't be reached: unreachable, never the card's own copy of its history (control: all served, verified)", async () => {
    const sam = await kept()
    rootAtWebs()
    expect((await guardianStandings(sam.agent, { fetch: hostWithout(SUE) }))[JORDAN]).toEqual({
      kind: 'unreachable',
      state: 'Example State',
    })
    expect(sam.askRecord().guardian?.verdict).toMatchObject({ ok: false, reason: 'stateNotResolved' })
    expect((await guardianStandings(sam.agent, { fetch: host() }))[JORDAN]).toMatchObject({ kind: 'verified' })
  })

  test("I4: the card's history for the agent is LONGER than the one published: refused, never read from the card (control: the honest resolver, verified)", async () => {
    const sam = await kept()
    rootAtWebs()
    const t = new TextDecoder('latin1').decode(kelOf(SUE))
    const rev = (JSON.parse(text('tel-G-revoked-revoked.json')) as { d: string }).d
    const shorter = new TextEncoder().encode(t.slice(0, t.lastIndexOf('{"v":"', t.indexOf(rev))))
    const publishesLess = async (did: string) =>
      aidOfDid(did) === SUE ? { ok: true as const, aid: SUE, kel: shorter } : honest(did)
    expect((await guardianStandings(sam.agent, { resolveRootKel: publishesLess }))[JORDAN]).toEqual({
      kind: 'unverified',
      outcome: 'kelNotReplaying',
    })
    resetGuardianCheckMemo()
    expect((await guardianStandings(sam.agent, { resolveRootKel: honest }))[JORDAN]).toMatchObject({ kind: 'verified' })
  })

  test('I5: a REAL (non-demo) root: only the root is fetched, never its chain issuers (control: I1/D1, a demo root fetches all three)', async () => {
    const sam = await kept()
    const was = stateRoots.K0_TEST_ROOT.demo
    ;(stateRoots.K0_TEST_ROOT as { demo?: true }).demo = undefined
    try {
      jest.spyOn(stateRoots, 'trustedStateRoots').mockReturnValue([{ ...stateRoots.K0_TEST_ROOT, webs: DID }])
      const fetch = host()
      const standing = (await guardianStandings(sam.agent, { fetch }))[JORDAN]
      expect(standing).toMatchObject({ kind: 'verified', fetchedFrom: 'example.org' })
      expect(standing).not.toHaveProperty('fetchedIssuers')
      expect(fetch.asked).toEqual([`${BASE}/keri.cesr`, `${BASE}/did.json`])
    } finally {
      ;(stateRoots.K0_TEST_ROOT as { demo?: true }).demo = was
    }
  })

  test('I6: no Demo state host: nothing at all is fetched, the root or its issuers (control: I1, with a host)', async () => {
    const sam = await kept(false, omitted())
    rootAtWebs()
    websModule.setDemoStateHost(null)
    const fetch = host()
    expect((await guardianStandings(sam.agent, { fetch }))[JORDAN]).toEqual({
      kind: 'verified',
      state: 'Example State',
      demo: true,
      test: true,
    })
    expect(fetch.asked).toEqual([])
  })

  test("I7: the five-minute reuse applies per issuer: the agent's host blips after a success, its last live history is reused and the line says when (control: forgotten, unreachable)", async () => {
    const sam = await kept()
    rootAtWebs()
    expect((await guardianStandings(sam.agent, { fetch: host() }))[JORDAN]).toMatchObject({ kind: 'verified' })
    const blip = await guardianStandings(sam.agent, { fetch: hostWithout(SUE) })
    expect(blip[JORDAN]).toMatchObject({ kind: 'verified', fetchedFrom: 'example.org' })
    expect((blip[JORDAN] as { fetchedAt?: string }).fetchedAt).toEqual(expect.any(String))
    resetGuardianCheckMemo()
    expect((await guardianStandings(sam.agent, { fetch: hostWithout(SUE) }))[JORDAN]).toEqual({
      kind: 'unreachable',
      state: 'Example State',
    })
  })

  test("I9: a revocation found in the STATE ROOT's own published history is named as the state's record, not the issuer's (control: I1, an issuer's history, the issuer's record)", async () => {
    const sam = await kept()
    rootAtWebs()
    const real = jest.requireActual('../../sedi/guardian') as typeof import('../../sedi/guardian')
    const rootKel = kelOf(ROOT)
    const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])
    // Only the root's published history reports a later status (as a revoked org-unit credential would); the card's
    // own copy and the issuers' histories alone do not.
    jest
      .spyOn(guardianModule, 'verifyGuardian')
      .mockImplementation((m, said, exp, opts) =>
        (opts.resolvedKels ?? []).some((k) => same(k, rootKel))
          ? { ok: false, reason: 'statusNotCurrent', detail: 'the issuer KEL anchors registry events to n=2' }
          : real.verifyGuardian(m, said, exp, opts)
      )
    expect((await guardianStandings(sam.agent, { fetch: host() }))[JORDAN]).toEqual({
      kind: 'unverified',
      outcome: 'revokedInStateRecord',
    })
    // And Who approves says so on the state's line, not the issuer's.
    ;(useFocusEffect as jest.Mock).mockImplementation((effect: () => void) => require('react').useEffect(effect, []))
    ;(useAgent as jest.Mock).mockReturnValue({ agent: sam.agent })
    jest.spyOn(approverRole, 'approverNames').mockResolvedValue({ [JORDAN]: 'Jordan' })
    jest.spyOn(vtaAgent, 'trustedApprovers').mockResolvedValue({
      view: { approvers: [JORDAN], keys: ['joinCommunity'], heldElsewhere: [] },
      version: 2,
    } as TrustedApproversState)
    resetGuardianCheckMemo()
    global.fetch = host() as never
    const tree = render(
      <BasicAppContext>
        <VtaTrustedApprovers />
      </BasicAppContext>
    )
    await act(async () => undefined)
    expect(tree.getByTestId(id(TrustedApproversIds.guardianRevokedState(JORDAN))).props.children).toBe(
      'Approver.GuardianRevokedState'
    )
    expect(tree.queryByTestId(id(TrustedApproversIds.guardianRevokedIssuer(JORDAN)))).toBeNull()
    expect(tree.queryByTestId(id(TrustedApproversIds.guardianRevoked(JORDAN)))).toBeNull()
  })

  test('G1 (derived guard): every root this build could trust, under every flag combination, plus a synthetic NON-demo root with a did:webs: a root that is not demo never gets the all-fetched line, a demo root always does (the set must hold at least one non-demo root)', async () => {
    // Every root on the list, as stateRootsFor gives it under each combination of its two flags, then a synthetic
    // NON-demo root (K0's AID with its demo mark cleared, as a real state's entry would be). Expectations are derived
    // from isDemoStateRoot, read live for each, never written per root.
    const listed = [false, true].flatMap((dev) =>
      [false, true].flatMap((trust) => stateRoots.stateRootsFor(dev, trust))
    )
    const unique = [...new Map(listed.map((r) => [r.aid, r])).values()].map((r) => ({ root: r, synthetic: false }))
    const cases = [...unique, { root: { ...stateRoots.K0_TEST_ROOT, name: 'Synthetic state' }, synthetic: true }]
    const was = stateRoots.K0_TEST_ROOT.demo
    const seen: { demo: boolean; key: string | null }[] = []
    try {
      for (const { root, synthetic } of cases) {
        ;(stateRoots.K0_TEST_ROOT as { demo?: true }).demo = synthetic ? undefined : was
        resetGuardianCheckMemo()
        const sam = await kept()
        websModule.setDemoStateHost('example.org')
        const spy = jest
          .spyOn(stateRoots, 'trustedStateRoots')
          .mockReturnValue([{ ...root, ...(synthetic ? { demo: undefined } : {}), webs: DID }])
        const standing = (await guardianStandings(sam.agent, { fetch: host() }))[JORDAN]
        spy.mockRestore()
        expect(standing).toMatchObject({ kind: 'verified' })
        const demo = stateRoots.isDemoStateRoot(root.aid) === true
        const key = guardianSourceKey(standing as Extract<GuardianStanding, { kind: 'verified' }>)
        seen.push({ demo, key })
        expect(key).toBe(demo ? 'Approver.GuardianFetchedLive' : 'Approver.GuardianFetchedRootLive')
      }
    } finally {
      ;(stateRoots.K0_TEST_ROOT as { demo?: true }).demo = was
    }
    // Not vacuous: at least one non-demo root was checked (remove the synthetic one and this fails).
    expect(seen.some((c) => !c.demo)).toBe(true)
    expect(seen.some((c) => c.demo)).toBe(true)
  })

  test('W1: a verdict that differs only in whether the issuers were fetched live is written back (the screen reads it) (control: unchanged, the stored record is untouched)', async () => {
    const sam = await kept()
    rootAtWebs()
    await guardianStandings(sam.agent, { fetch: host() })
    const stored = () => sam.askRecord().guardian?.verdict as GuardianVerdict & { fetchedIssuers?: true }
    expect(stored()).toMatchObject({ ok: true, fetchedIssuers: true })
    // The kept verdict loses only that field (as one checked when only the root was live would have it).
    const row = sam.rows.find((r) => r.tags.recordType === approverRole.ROLE_OFFER_ASK)!
    const ask = row.content as unknown as approverRole.RoleOfferAsk & { guardian: GuardianOnAsk }
    const { fetchedIssuers: _drop, ...without } = ask.guardian.verdict as GuardianVerdict & { fetchedIssuers?: true }
    row.content = { ...ask, guardian: { ...ask.guardian, verdict: without } } as Row['content']
    // The double's update (phone().update, a jest.fn) has counted the arrival and the first open: count from here.
    const updates = sam.update
    updates.mockClear()
    await guardianStandings(sam.agent, { fetch: host() })
    expect(stored()).toMatchObject({ ok: true, fetchedIssuers: true })
    expect(updates).toHaveBeenCalledTimes(1)
    // Control: nothing moved this time, so nothing is written.
    updates.mockClear()
    await guardianStandings(sam.agent, { fetch: host() })
    expect(updates).not.toHaveBeenCalled()
  })

  test('I8: Who approves says "The issuer\'s published record shows it was revoked", its own line, not "Couldn\'t verify" (controls: a card carrying its own revocation shows #1044 own line; I9, the state record line); each render shows exactly one of the three revocation lines', async () => {
    const sam = await kept(false, omitted())
    ;(useFocusEffect as jest.Mock).mockImplementation((effect: () => void) => require('react').useEffect(effect, []))
    ;(useAgent as jest.Mock).mockReturnValue({ agent: sam.agent })
    jest.spyOn(approverRole, 'approverNames').mockResolvedValue({ [JORDAN]: 'Jordan' })
    jest.spyOn(vtaAgent, 'trustedApprovers').mockResolvedValue({
      view: { approvers: [JORDAN], keys: ['joinCommunity'], heldElsewhere: [] },
      version: 2,
    } as TrustedApproversState)
    rootAtWebs()
    global.fetch = host() as never
    const screen = async () => {
      const tree = render(
        <BasicAppContext>
          <VtaTrustedApprovers />
        </BasicAppContext>
      )
      await act(async () => undefined)
      return tree
    }
    const live = await screen()
    expect(live.getByTestId(id(TrustedApproversIds.guardianRevokedIssuer(JORDAN))).props.children).toBe(
      'Approver.GuardianRevokedIssuer'
    )
    expect(live.queryByTestId(id(TrustedApproversIds.guardianUnverified(JORDAN)))).toBeNull()
    expect(live.queryByTestId(id(TrustedApproversIds.guardianRevoked(JORDAN)))).toBeNull()
    expect(live.queryByTestId(id(TrustedApproversIds.guardianRevokedState(JORDAN)))).toBeNull()
    live.unmount()
    // Control: a card that carries its own revocation is refused as `revoked`, on #1044's own line ("The card shows it
    // was revoked"), never shadowed by the published-record lines.
    const own = await kept(false, card('G-revoked'))
    ;(useAgent as jest.Mock).mockReturnValue({ agent: own.agent })
    const carried = await screen()
    expect(carried.getByTestId(id(TrustedApproversIds.guardianRevoked(JORDAN))).props.children).toBe(
      'Approver.GuardianRevoked'
    )
    expect(carried.queryByTestId(id(TrustedApproversIds.guardianRevokedIssuer(JORDAN)))).toBeNull()
    expect(carried.queryByTestId(id(TrustedApproversIds.guardianRevokedState(JORDAN)))).toBeNull()
  })

  test('L2: the live line, in every language, names the host and says the designated-alias check is not done (control: the key exists in all three)', () => {
    const en = require('../../../localization/en/en.json').Approver.GuardianFetchedLive as string
    const fr = require('../../../localization/fr/fr.json').Approver.GuardianFetchedLive as string
    const pt = require('../../../localization/pt-br/pt-br.json').Approver.GuardianFetchedLive as string
    for (const s of [en, fr, pt]) expect(s).toContain('{{host}}')
    expect(en).toBe("Fetched live from {{host}}; the designated-alias check isn't supported yet.")
    expect(fr).toMatch(/pas encore/)
    expect(pt).toMatch(/ainda não/)
  })

  test('D9: Who approves says "Couldn\'t reach the state", not "Couldn\'t verify" and not verified (control: the state card line rows above)', async () => {
    const sam = await kept()
    rootAtWebs()
    const realFetch = global.fetch
    global.fetch = jest.fn(async () => {
      throw new Error('offline')
    }) as never
    try {
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
      expect(tree.getByTestId(id(TrustedApproversIds.guardianUnreachable(JORDAN))).props.children).toBe(
        'Approver.GuardianStateUnreachable'
      )
      expect(tree.queryByTestId(id(TrustedApproversIds.guardianUnverified(JORDAN)))).toBeNull()
      expect(tree.queryByTestId(id(TrustedApproversIds.guardianVerified(JORDAN)))).toBeNull()
    } finally {
      global.fetch = realFetch
    }
  })

  // ---------------------------------------------------------------------------------------------------------------
  // Reusing our own last LIVE result for five minutes when the host fails (sedi/webs/lastLive). Never a failure, never
  // the card's copy, never another host's; the whole check runs again on the reused KEL.

  describe('our own last live result, reused for five minutes when the host fails', () => {
    const T0 = new Date('2026-11-14T15:00:00.000Z')
    const at = (ms: number) => jest.setSystemTime(new Date(T0.getTime() + ms))
    beforeEach(() =>
      jest.useFakeTimers({
        now: T0,
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
          'hrtime',
          'performance',
        ],
      })
    )
    afterEach(() => jest.useRealTimers())
    const FRESH = {
      kind: 'verified',
      state: 'Example State',
      demo: true,
      test: true,
      fetchedFrom: 'example.org',
      fetchedIssuers: true,
    }

    test('U1: a success, then a failure under five minutes later: our earlier result, saying when (control: the first open is fresh, no time)', async () => {
      const sam = await kept()
      rootAtWebs()
      expect(await guardianStandings(sam.agent, { fetch: host() })).toEqual({ [JORDAN]: FRESH })
      at(4 * 60 * 1000)
      expect(await guardianStandings(sam.agent, { fetch: host(true) })).toEqual({
        [JORDAN]: { ...FRESH, fetchedAt: T0.toISOString() },
      })
      expect(sam.askRecord().guardian?.verdict).toMatchObject({ ok: true, reused: true, fetchedAt: T0.toISOString() })
    })

    test('U2: exactly at five minutes it is not reused: "Couldn\'t reach the state" (control: one millisecond before, it is)', async () => {
      const sam = await kept()
      rootAtWebs()
      await guardianStandings(sam.agent, { fetch: host() })
      at(5 * 60 * 1000 - 1)
      expect((await guardianStandings(sam.agent, { fetch: host(true) }))[JORDAN]).toEqual({
        ...FRESH,
        fetchedAt: T0.toISOString(),
      })
      at(5 * 60 * 1000)
      expect((await guardianStandings(sam.agent, { fetch: host(true) }))[JORDAN]).toEqual({
        kind: 'unreachable',
        state: 'Example State',
      })
    })

    test('U3: past five minutes: "Couldn\'t reach the state" (control: U1, under five)', async () => {
      const sam = await kept()
      rootAtWebs()
      await guardianStandings(sam.agent, { fetch: host() })
      at(6 * 60 * 1000)
      expect((await guardianStandings(sam.agent, { fetch: host(true) }))[JORDAN].kind).toBe('unreachable')
    })

    test('U4: a failure with no earlier success: "Couldn\'t reach the state", and a failure is never kept (control: U1)', async () => {
      const sam = await kept()
      rootAtWebs()
      expect((await guardianStandings(sam.agent, { fetch: host(true) }))[JORDAN].kind).toBe('unreachable')
      at(60 * 1000)
      expect((await guardianStandings(sam.agent, { fetch: host(true) }))[JORDAN].kind).toBe('unreachable')
    })

    test('U5: a success, then a success: fresh both times, with no time and no reuse mark (control: U1)', async () => {
      const sam = await kept()
      rootAtWebs()
      await guardianStandings(sam.agent, { fetch: host() })
      at(60 * 1000)
      expect(await guardianStandings(sam.agent, { fetch: host() })).toEqual({ [JORDAN]: FRESH })
      expect(sam.askRecord().guardian?.verdict).not.toHaveProperty('reused')
    })

    test("U6: the host changed (a new tunnel), then a failure: another host's result is never reused (control: same host, U1)", async () => {
      const sam = await kept()
      rootAtWebs()
      await guardianStandings(sam.agent, { fetch: host() })
      websModule.setDemoStateHost('other-tunnel.trycloudflare.com')
      at(60 * 1000)
      expect((await guardianStandings(sam.agent, { fetch: host() }))[JORDAN]).toEqual({
        kind: 'unreachable',
        state: 'Example State',
      })
    })

    test("U7: the reused KEL is checked again with today's inputs: a ward that moved refuses it (control: U1, ward unchanged)", async () => {
      const sam = await kept()
      rootAtWebs()
      await guardianStandings(sam.agent, { fetch: host() })
      await setStateWard(sam.agent, OTHER_WARD)
      at(60 * 1000)
      expect((await guardianStandings(sam.agent, { fetch: host(true) }))[JORDAN]).toEqual({
        kind: 'unverified',
        outcome: 'wardMismatch',
      })
    })

    test('U8: the line for a reused result says when, never just "fetched live" (control: a fresh one has no time)', async () => {
      const sam = await kept()
      rootAtWebs()
      ;(useFocusEffect as jest.Mock).mockImplementation((effect: () => void) => require('react').useEffect(effect, []))
      ;(useAgent as jest.Mock).mockReturnValue({ agent: sam.agent })
      jest.spyOn(approverRole, 'approverNames').mockResolvedValue({ [JORDAN]: 'Jordan' })
      jest.spyOn(vtaAgent, 'trustedApprovers').mockResolvedValue({
        view: { approvers: [JORDAN], keys: ['joinCommunity'], heldElsewhere: [] },
        version: 2,
      } as TrustedApproversState)
      const screen = async () => {
        const tree = render(
          <BasicAppContext>
            <VtaTrustedApprovers />
          </BasicAppContext>
        )
        await act(async () => undefined)
        return tree
      }
      const realFetch = global.fetch
      try {
        global.fetch = host() as never
        const fresh = await screen()
        expect(fresh.getByTestId(id(TrustedApproversIds.guardianFetchedLive(JORDAN))).props.children).toBe(
          'Approver.GuardianFetchedLive'
        )
        fresh.unmount()
        at(60 * 1000)
        global.fetch = host(true) as never
        const reused = await screen()
        expect(reused.getByTestId(id(TrustedApproversIds.guardianFetchedLive(JORDAN))).props.children).toBe(
          'Approver.GuardianFetchedLiveAt'
        )
      } finally {
        global.fetch = realFetch
      }
    })

    test('U9: with a switch off nothing is reused and what was kept is dropped (control: U1, switches on)', async () => {
      const ok = jest.fn(async () => ({ ok: true as const, aid: ROOT, kel: new Uint8Array([1]) }))
      const down = jest.fn(async () => ({ ok: false as const, reason: 'unreachable', detail: 'offline' }))
      expect(await lastLive.resolveRootKelReusing(DID, ok, T0)).toMatchObject({ ok: true, reused: false })
      setStateVerifiedApproversEnabled(false)
      expect(await lastLive.resolveRootKelReusing(DID, down, new Date(T0.getTime() + 1000))).toMatchObject({
        ok: false,
      })
      setStateVerifiedApproversEnabled(true)
      expect(await lastLive.resolveRootKelReusing(DID, down, new Date(T0.getTime() + 2000))).toMatchObject({
        ok: false,
      })
    })

    test('U10: the line in every language names the host and the time (control: the key exists in all three)', () => {
      for (const f of ['en/en.json', 'fr/fr.json', 'pt-br/pt-br.json']) {
        const s = require(`../../../localization/${f}`).Approver.GuardianFetchedLiveAt as string
        expect(s).toContain('{{host}}')
        expect(s).toContain('{{time}}')
      }
    })
  })
})
