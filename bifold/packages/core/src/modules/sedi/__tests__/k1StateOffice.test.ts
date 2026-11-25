/**
 * K1, the demo state a local state office issues from: where it is fetched from (stateRoots K1_WEBS_HOST, in each of
 * its three modes), receiving a Guardian card from the office's link, the host travelling with the card to the person's
 * phone, and the Developer "Demo state host" field never reaching K1.
 *
 * K1's own chain cannot be issued here (its keys are the office's), so the rows put K1's root AID on the K0 kit's root
 * (k1SettingsForTests): the K0 card, its published histories (fixtures/webs-k0-root, served as example.org) and its
 * revoked variant then exercise every K1 path with real material and the real check. The record store throws on
 * delete, so a delete anywhere fails the row.
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

import {
  GUARDIAN_EVIDENCE_MAX_BYTES,
  GUARDIAN_EVIDENCE_SPEC,
  GUARDIAN_EVIDENCE_TYPE_URI,
  GUARDIAN_EVIDENCE_V2_SPEC,
  GUARDIAN_EVIDENCE_V2_TYPE_URI,
} from '../../trust-tasks/approverRoleSpec'
import {
  GUARDIAN_EVIDENCE_HELD,
  checkGuardianEvidenceResolving,
  cardToShare,
  handleGuardianEvidence,
  heldGuardianStateHost,
  holdGuardianEvidence,
  sendGuardianEvidence,
  type GuardianEvidence,
} from '../../trust-tasks/guardianEvidence'
import { SEDI_KERI_REMOTE_OFF } from '../../trust-tasks/module/sediKeriRemoteOff'
import { setStateVerifiedApproversEnabled } from '../../trust-tasks/module/stateVerifiedApproversFlag'
import { setTrustedApproversEnabled } from '../../trust-tasks/module/trustedApproversFlag'
import { setTrustTestStateEnabled } from '../../trust-tasks/module/trustTestStateFlag'
import { trustTaskPayloadValidator } from '@bifold/trust-tasks'
import { K0_TEST_GUARDIAN_CARD } from '../guardian/k0TestCard'
import { K0_REVOKED_TEST_GUARDIAN_CARD } from '../guardian/k0RevokedTestCard'
import * as stateRoots from '../guardian/stateRoots'
import * as controller from '../holder/controller'
import { GUARDIAN_CARD_TYPE, checkGuardianCard, receiveGuardianCard } from '../holder/receiveGuardianCard'
import type { DesignationCheck, HostDesignation } from '../webs/designatedAliases'
import { setDemoStateHost, websDidToFetch } from '../webs/demoStateHost'
import { resetLiveResolutions } from '../webs/lastLive'

import { fakeKms, fakeRecords } from './fixtures/fakeAgent'

jest.mock('../../trust-tasks/documentProof', () => ({
  signDocumentProof: jest.fn(async (_agent: unknown, doc: Record<string, unknown>) => ({ ...doc, proof: { p: 1 } })),
  verifyDocumentProof: jest.fn(async () => true),
}))
const sent: Record<string, unknown>[] = []
jest.mock('../../trust-tasks/ceremony', () => ({
  getTrustTasksService: () => ({ retain: jest.fn(async () => undefined) }),
  sendTrustTaskDocument: jest.fn(async (_agent: unknown, _conn: string, doc: Record<string, unknown>) => {
    sent.push(doc)
  }),
}))

const K0_ROOT = stateRoots.K0_TEST_ROOT.aid
const WEBS_FX = join(__dirname, 'fixtures', 'webs-k0-root')
const ID = 'AbCdEfGhIjKlMnOpQrStUv' // 22 base64url characters
const CARD_URL = `https://example.org/cards/${ID}.json`
const WARD = K0_TEST_GUARDIAN_CARD.creds.join('').includes('IFDf7z58Wp19EQ-EjCviVU2sgmFnjecWqCEaNsAz8lq6')
  ? 'IFDf7z58Wp19EQ-EjCviVU2sgmFnjecWqCEaNsAz8lq6'
  : ''

/** The card file a state office publishes, for `evidence`. */
const cardFile = (evidence: GuardianEvidence = K0_TEST_GUARDIAN_CARD, over: Record<string, unknown> = {}) =>
  new TextEncoder().encode(
    JSON.stringify({
      type: GUARDIAN_CARD_TYPE,
      ...evidence,
      issuedAt: '2026-11-13T00:00:00Z',
      expiresAt: '2027-11-13T00:00:00Z',
      ...over,
    })
  )

/** The office's card address, answering with `body` (or a status, a redirect, a size). Records what was asked. */
function office(
  body: Uint8Array | null = cardFile(),
  over: { status?: number; redirected?: boolean; length?: number } = {}
) {
  const asked: string[] = []
  const fetchCard = jest.fn(async (url: string) => {
    asked.push(url)
    return {
      ok: (over.status ?? 200) < 300,
      status: over.status ?? (body ? 200 : 404),
      url,
      redirected: over.redirected ?? false,
      headers: {
        get: (h: string) => (h === 'content-length' && over.length !== undefined ? String(over.length) : null),
      },
      arrayBuffer: async () => (body ?? new Uint8Array()).slice().buffer as ArrayBuffer,
    }
  })
  return Object.assign(fetchCard, { asked })
}

/** The K0 chain's published histories as example.org serves them (or nothing, `down`). Records what was asked. */
function state(down = false) {
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
  return Object.assign(f, { asked })
}

/** The state's answer on whether it names a host (sedi/webs designatedAliases), as a row chooses it. */
const named = (result: HostDesignation, why: string) =>
  jest.fn(async (): Promise<DesignationCheck> => ({ result, why }))
/** The state names the host: the pair checkDesignation gives for a listed host. */
const listed = () => named('designated', 'listed')

const phone = () => {
  const genericRecords = fakeRecords()
  return { genericRecords, agent: { genericRecords, kms: fakeKms() } as never }
}
const heldRecord = (p: ReturnType<typeof phone>) =>
  p.genericRecords.records.find((r) => r.tags.recordType === GUARDIAN_EVIDENCE_HELD)?.content

const realFetch = global.fetch
const g = globalThis as { __DEV__?: boolean }
const wasDev = g.__DEV__
beforeEach(() => {
  // A release build: the K0 root is not trusted, so the only root here is K1 (put on the K0 kit's AID for these rows).
  g.__DEV__ = false
  setTrustedApproversEnabled(true)
  setStateVerifiedApproversEnabled(true)
  setTrustTestStateEnabled(false)
  stateRoots.k1SettingsForTests.set({ aid: K0_ROOT, host: 'fromCard' })
  // The card names the K0 kit's guardian (Jordan): this phone's holder code is that AID for these rows.
  jest.spyOn(controller, 'holderCodeOf').mockResolvedValue(K0_TEST_GUARDIAN_CARD.holder)
  global.fetch = jest.fn(async () => {
    throw new Error('no network in tests')
  }) as never
  resetLiveResolutions()
})
afterEach(() => {
  jest.restoreAllMocks()
  stateRoots.k1SettingsForTests.reset()
  setDemoStateHost(null)
  setTrustedApproversEnabled(false)
  setStateVerifiedApproversEnabled(false)
  SEDI_KERI_REMOTE_OFF.off = false
  global.fetch = realFetch
  g.__DEV__ = wasDev
})

describe('K1 on this build', () => {
  it('K1-01: the real root is the one on the list, named "State of Utah" and demo-marked; only the root is trusted', () => {
    stateRoots.k1SettingsForTests.reset()
    expect(stateRoots.K1_ROOT_AID).toBe('IIOfwtkpq00RMwoUH8346kzNKq877GJXQStI6Dyg66Bs')
    expect(stateRoots.k1Root()).toMatchObject({ aid: stateRoots.K1_ROOT_AID, name: 'State of Utah', demo: true })
    expect(stateRoots.trustedStateRoots().map((r) => r.aid)).toEqual([stateRoots.K1_ROOT_AID])
    // The unit and the agent are the chain below it, never roots.
    for (const aid of ['IEuyaxT7vB8IXBmEp_bfzYfDVxTU538eduNypwgANIwd', 'IJNKxQupOLWNLwsIgCkAfSi9UPE1q7xHyFXZqBlU_O-T'])
      expect(stateRoots.trustedStateRoots().some((r) => r.aid === aid)).toBe(false)
  })

  it("K1-02: this build ships 'fromCard', and the Developer field never applies to K1 in any mode (control: K0 takes it)", () => {
    stateRoots.k1SettingsForTests.reset()
    expect(stateRoots.K1_WEBS_HOST).toBe('fromCard')
    setDemoStateHost('typed.example.net')
    for (const host of ['fromCard', 'state.example.net', null] as const) {
      stateRoots.k1SettingsForTests.set({ host })
      const k1 = stateRoots.k1Root() as stateRoots.StateRoot
      expect(stateRoots.takesDemoStateHost(k1.aid)).toBe(false)
      expect(websDidToFetch(k1) ?? '').not.toContain('typed.example.net')
    }
    expect(websDidToFetch(stateRoots.K0_TEST_ROOT)).toContain('typed.example.net')
  })

  it('K1-03: the three modes: a fixed host builds the did:webs; fromCard a placeholder; null none at all', () => {
    stateRoots.k1SettingsForTests.set({ host: 'state.example.net' })
    expect(stateRoots.k1HostMode()).toBe('fixed')
    expect(stateRoots.k1Root()?.webs).toBe(`did:webs:state.example.net:keyring-demo-state:${K0_ROOT}`)
    stateRoots.k1SettingsForTests.set({ host: 'fromCard' })
    expect(stateRoots.k1Root()).toMatchObject({ hostFromCard: true })
    stateRoots.k1SettingsForTests.set({ host: null })
    expect(stateRoots.k1HostMode()).toBe('none')
    expect(stateRoots.k1Root()?.webs).toBeUndefined()
    // A malformed host is no host, never a partly used one.
    stateRoots.k1SettingsForTests.set({ host: 'state.example.net/path' })
    expect(stateRoots.k1HostMode()).toBe('none')
  })

  it('K1-04: K1 is trusted only with both switches on (and not under the SEDI/KERI kill)', () => {
    expect(stateRoots.k1StateRoots()).toHaveLength(1)
    setStateVerifiedApproversEnabled(false)
    expect(stateRoots.k1StateRoots()).toHaveLength(0)
    setStateVerifiedApproversEnabled(true)
    SEDI_KERI_REMOTE_OFF.off = true
    expect(stateRoots.k1StateRoots()).toHaveLength(0)
  })
})

describe("receiving a card from the office's link", () => {
  it('R01: kept, checked live at the host the link named, and that host kept with the card', async () => {
    const p = phone()
    const fetchCard = office()
    const fetch = state()
    const r = await receiveGuardianCard(p.agent, CARD_URL, {
      fetchCard,
      fetch: fetch as never,
      checkDesignation: listed(),
    })
    expect(r).toMatchObject({
      kind: 'kept',
      state: 'State of Utah',
      stateHost: 'example.org',
      fetchedFrom: 'example.org',
    })
    expect(fetchCard.asked).toEqual([CARD_URL])
    expect(fetch.asked.length).toBeGreaterThan(0)
    expect(fetch.asked.every((u) => u.startsWith('https://example.org/keyring-demo-state/'))).toBe(true)
    expect(heldRecord(p)).toMatchObject({ guardianSaid: K0_TEST_GUARDIAN_CARD.guardianSaid, stateHost: 'example.org' })
    expect(await heldGuardianStateHost(p.agent)).toBe('example.org')
    expect(p.genericRecords.delete).not.toHaveBeenCalled()
  })

  it('R02: under fromCard a host typed in the Developer field never reaches K1 (the check fetches the link host only)', async () => {
    setDemoStateHost('typed.example.net')
    const fetch = state()
    const r = await checkGuardianCard(phone().agent, CARD_URL, {
      fetchCard: office(),
      fetch: fetch as never,
      checkDesignation: listed(),
    })
    expect(r).toMatchObject({ kind: 'checked', fetchedFrom: 'example.org' })
    expect(fetch.asked.some((u) => u.includes('typed.example.net'))).toBe(false)
  })

  it.each([
    ['another path on the host', 'https://example.org/other/AbCdEfGhIjKlMnOpQrStUv.json'],
    ['a short id', 'https://example.org/cards/short.json'],
    ['http', `http://example.org/cards/${ID}.json`],
    ['a query', `${CARD_URL}?x=1`],
    ['a fragment', `${CARD_URL}#x`],
    ['an address', `https://127.0.0.1/cards/${ID}.json`],
    ['a local name', `https://localhost/cards/${ID}.json`],
    ['a .local name', `https://office.local/cards/${ID}.json`],
    ['upper case', `https://EXAMPLE.org/cards/${ID}.json`],
    ['user info', `https://a@example.org/cards/${ID}.json`],
  ])('R03: %s is refused before anything is fetched (control: R01)', async (_, url) => {
    const p = phone()
    const fetchCard = office()
    expect(await receiveGuardianCard(p.agent, url, { fetchCard })).toEqual({ kind: 'wrongHost' })
    expect(fetchCard).not.toHaveBeenCalled()
    expect(heldRecord(p)).toBeUndefined()
  })

  it("R04: a fixed host: only that host's cards; a typed field host is ignored (control: the fixed host is fetched)", async () => {
    stateRoots.k1SettingsForTests.set({ host: 'state.example.net' })
    setDemoStateHost('example.org')
    const fetchCard = office()
    expect(await checkGuardianCard(phone().agent, CARD_URL, { fetchCard })).toEqual({ kind: 'wrongHost' })
    expect(fetchCard).not.toHaveBeenCalled()
    const other = `https://state.example.net/cards/${ID}.json`
    const fetch = state()
    await checkGuardianCard(phone().agent, other, { fetchCard, fetch: fetch as never, checkDesignation: listed() })
    expect(fetchCard.asked).toEqual([other])
    expect(fetch.asked.length).toBeGreaterThan(0)
    expect(fetch.asked.every((u) => u.startsWith('https://state.example.net/'))).toBe(true)
  })

  it('R05: null (no host on this build): refused as noHost, nothing fetched, whatever the field says', async () => {
    stateRoots.k1SettingsForTests.set({ host: null })
    setDemoStateHost('example.org')
    const fetchCard = office()
    expect(await receiveGuardianCard(phone().agent, CARD_URL, { fetchCard })).toEqual({ kind: 'noHost' })
    expect(fetchCard).not.toHaveBeenCalled()
  })

  it('R06: over the cap, by its declared length or its bytes: tooLarge, nothing kept', async () => {
    const p = phone()
    const big = office(cardFile(), { length: GUARDIAN_EVIDENCE_MAX_BYTES + 1 })
    expect(await receiveGuardianCard(p.agent, CARD_URL, { fetchCard: big })).toEqual({ kind: 'tooLarge' })
    const bytes = office(new Uint8Array(GUARDIAN_EVIDENCE_MAX_BYTES + 1))
    expect(await receiveGuardianCard(p.agent, CARD_URL, { fetchCard: bytes })).toEqual({ kind: 'tooLarge' })
    expect(heldRecord(p)).toBeUndefined()
  })

  it('R07: not our card file: badCard (another type, not JSON, no registries)', async () => {
    const p = phone()
    for (const body of [
      cardFile(K0_TEST_GUARDIAN_CARD, { type: 'something/else' }),
      new TextEncoder().encode('not json'),
      cardFile(K0_TEST_GUARDIAN_CARD, { tels: [] }),
    ])
      expect(await receiveGuardianCard(p.agent, CARD_URL, { fetchCard: office(body) })).toMatchObject({
        kind: 'badCard',
      })
    expect(heldRecord(p)).toBeUndefined()
  })

  it("R08: a card issued to another phone's code is not kept (the link is not a secret)", async () => {
    jest.spyOn(controller, 'holderCodeOf').mockResolvedValue('I' + 'x'.repeat(43))
    const p = phone()
    const fetch = state()
    expect(
      await receiveGuardianCard(p.agent, CARD_URL, {
        fetchCard: office(),
        fetch: fetch as never,
        checkDesignation: listed(),
      })
    ).toEqual({
      kind: 'notForThisPhone',
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(heldRecord(p)).toBeUndefined()
  })

  it('R09: a revoked card is refused by the check and not kept', async () => {
    const p = phone()
    const r = await receiveGuardianCard(p.agent, CARD_URL, {
      fetchCard: office(cardFile(K0_REVOKED_TEST_GUARDIAN_CARD)),
      fetch: state() as never,
      checkDesignation: listed(),
    })
    expect(r).toMatchObject({ kind: 'refused', reason: 'revoked' })
    expect(heldRecord(p)).toBeUndefined()
  })

  it('R10: the state unreachable: refused, not the card copy instead, nothing kept', async () => {
    const p = phone()
    const r = await receiveGuardianCard(p.agent, CARD_URL, {
      fetchCard: office(),
      fetch: state(true) as never,
      checkDesignation: listed(),
    })
    expect(r).toMatchObject({ kind: 'refused', reason: 'stateNotResolved' })
    expect(heldRecord(p)).toBeUndefined()
  })

  it('R11: a redirect, or a non-2xx answer, is unreachable', async () => {
    expect(
      await checkGuardianCard(phone().agent, CARD_URL, { fetchCard: office(cardFile(), { redirected: true }) })
    ).toMatchObject({
      kind: 'unreachable',
    })
    expect(
      await checkGuardianCard(phone().agent, CARD_URL, { fetchCard: office(null, { status: 404 }) })
    ).toMatchObject({
      kind: 'unreachable',
    })
  })

  it.each([
    ['trusted approvers off', () => setTrustedApproversEnabled(false)],
    ['state-verified approvers off', () => setStateVerifiedApproversEnabled(false)],
    ['the SEDI/KERI kill', () => (SEDI_KERI_REMOTE_OFF.off = true)],
  ])('R12: %s: off, nothing fetched or kept (control: R01)', async (_, off) => {
    off()
    const p = phone()
    const fetchCard = office()
    expect(await receiveGuardianCard(p.agent, CARD_URL, { fetchCard })).toEqual({ kind: 'off' })
    expect(fetchCard).not.toHaveBeenCalled()
    expect(heldRecord(p)).toBeUndefined()
  })
})

describe("the person's phone checks the card with the host it came with, and only that", () => {
  const check = (stateHost: string | undefined, fetch = state()) =>
    checkGuardianEvidenceResolving(K0_TEST_GUARDIAN_CARD, WARD, new Date(), () => undefined, {
      fetch: fetch as never,
      checkDesignation,
      ...(stateHost !== undefined ? { stateHost } : {}),
    })
  let checkDesignation = listed()
  beforeEach(() => {
    checkDesignation = listed()
  })

  it('P01: the payload host: fetched there and labelled as the card host (hostFromCard), the field ignored', async () => {
    setDemoStateHost('typed.example.net')
    const fetch = state()
    const v = await check('example.org', fetch)
    expect(v).toMatchObject({ ok: true, fetchedFrom: 'example.org', hostFromCard: true })
    expect(fetch.asked.some((u) => u.includes('typed.example.net'))).toBe(false)
  })

  it('P02: no host with the card: K1 is not fetched at all; the copy is checked (no fetchedFrom), field or not', async () => {
    setDemoStateHost('example.org')
    const fetch = state()
    const v = await check(undefined, fetch)
    expect(v).toMatchObject({ ok: true })
    expect(v.ok === true && v.fetchedFrom).toBeFalsy()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['127.0.0.1'],
    ['localhost'],
    ['example.org/path'],
    ['a@example.org'],
    ['https://example.org'],
    ['intranet'],
  ])(
    'P03: a bad host with the card (%s) refuses the check, never read past and never the copy instead',
    async (bad) => {
      const fetch = state()
      expect(await check(bad, fetch)).toMatchObject({ ok: false, reason: 'stateHostRefused' })
      expect(fetch).not.toHaveBeenCalled()
    }
  )

  it('P04: 0.1 is what 278.18 reads (no stateHost); 0.2 takes stateHost and social as optional, and refuses a host with a path', () => {
    const payload = {
      agent: 'did:webvh:a.example',
      approver: 'did:peer:2.b',
      ...K0_TEST_GUARDIAN_CARD,
      sentAt: '2026-11-13T00:00:00Z',
    }
    const takes = (spec: { payloadSchema: object }, p: unknown) =>
      trustTaskPayloadValidator.validate(spec.payloadSchema as never, p) === true
    expect(takes(GUARDIAN_EVIDENCE_SPEC, payload)).toBe(true)
    expect(takes(GUARDIAN_EVIDENCE_SPEC, { ...payload, stateHost: 'example.org' })).toBe(false)
    expect(takes(GUARDIAN_EVIDENCE_V2_SPEC, payload)).toBe(true)
    expect(takes(GUARDIAN_EVIDENCE_V2_SPEC, { ...payload, stateHost: 'example.org' })).toBe(true)
    expect(takes(GUARDIAN_EVIDENCE_V2_SPEC, { ...payload, social: { said: K0_TEST_GUARDIAN_CARD.guardianSaid } })).toBe(
      true
    )
    expect(takes(GUARDIAN_EVIDENCE_V2_SPEC, { ...payload, stateHost: 'example.org/x' })).toBe(false)
    expect(takes(GUARDIAN_EVIDENCE_V2_SPEC, { ...payload, social: { said: 'x', more: 1 } })).toBe(false)
  })

  it('P05: a K0 card held from the Developer settings keeps no host (a later card replaces a host it did not come with)', async () => {
    const p = phone()
    await holdGuardianEvidence(p.agent, K0_TEST_GUARDIAN_CARD, { stateHost: 'example.org' })
    expect(await heldGuardianStateHost(p.agent)).toBe('example.org')
    await holdGuardianEvidence(p.agent, K0_TEST_GUARDIAN_CARD)
    expect(await heldGuardianStateHost(p.agent)).toBeUndefined()
  })
})

describe("the card's host goes to the person's phone only with a K1 card", () => {
  /** Jordan's phone with a relationship on connection c1, as sendGuardianEvidence reads it. */
  const jordan = () => {
    const p = phone()
    const agent = {
      ...(p.agent as object),
      context: {},
      config: { logger: { warn: jest.fn(), info: jest.fn() } },
      dependencyManager: {
        resolve: () => ({
          getAll: async () => [
            {
              connectionId: 'c1',
              myRelationshipDid: 'did:peer:2.mine',
              counterpartyRelationshipDid: 'did:peer:2.theirs',
            },
          ],
        }),
      },
      modules: {
        didcomm: { connections: { getById: async () => ({ did: 'did:peer:me', theirDid: 'did:peer:them' }) } },
      },
    }
    return { ...p, agent: agent as never }
  }
  beforeEach(() => {
    sent.length = 0
  })

  it('X01: a K1 card held with its host goes as 0.2, carrying stateHost (control for X02)', async () => {
    const j = jordan()
    await holdGuardianEvidence(j.agent, K0_TEST_GUARDIAN_CARD, { stateHost: 'example.org' })
    expect(await sendGuardianEvidence(j.agent, 'c1', 'did:webvh:a.example', 'did:peer:2.b')).toBe('sent')
    expect(sent[0].type).toBe(GUARDIAN_EVIDENCE_V2_TYPE_URI)
    expect((sent[0].payload as { stateHost?: string }).stateHost).toBe('example.org')
  })

  it("X03: a K0 card whose CREDENTIALS mention K1's AID still goes as 0.1, byte-identical (only a carried KEL counts)", async () => {
    // K1 is somewhere else (its own root), so the card's KELs never carry it; one credential text mentions it.
    stateRoots.k1SettingsForTests.reset()
    const k1 = stateRoots.K1_ROOT_AID
    const last = K0_TEST_GUARDIAN_CARD.creds.length - 1
    const card = {
      ...K0_TEST_GUARDIAN_CARD,
      creds: K0_TEST_GUARDIAN_CARD.creds.map((cred, i) => (i === last ? `${cred}${k1}` : cred)),
    }
    expect(card.kels.some((kel) => kel.includes(k1))).toBe(false)
    expect(card.creds.some((cred) => cred.includes(k1))).toBe(true)
    const j = jordan()
    await holdGuardianEvidence(j.agent, card, { stateHost: 'example.org' })
    expect(await sendGuardianEvidence(j.agent, 'c1', 'did:webvh:a.example', 'did:peer:2.b')).toBe('sent')
    expect(sent[0].type).toBe(GUARDIAN_EVIDENCE_TYPE_URI)
    expect(Object.keys(sent[0].payload as object).sort()).toEqual([
      'agent',
      'approver',
      'creds',
      'guardianSaid',
      'holder',
      'kels',
      'sentAt',
      'tels',
    ])
  })

  it('X02: a K0 card goes as 0.1 with NO stateHost, exactly what 278.18 sends, even if a host were kept with it', async () => {
    // A K0 card: K1 is somewhere else, so the card does not name K1's root.
    stateRoots.k1SettingsForTests.reset()
    const j = jordan()
    await holdGuardianEvidence(j.agent, K0_TEST_GUARDIAN_CARD, { stateHost: 'example.org' })
    expect(await sendGuardianEvidence(j.agent, 'c1', 'did:webvh:a.example', 'did:peer:2.b')).toBe('sent')
    const payload = sent[0].payload as Record<string, unknown>
    expect(sent[0].type).toBe(GUARDIAN_EVIDENCE_TYPE_URI)
    expect('stateHost' in payload).toBe(false)
    expect(Object.keys(payload).sort()).toEqual([
      'agent',
      'approver',
      'creds',
      'guardianSaid',
      'holder',
      'kels',
      'sentAt',
      'tels',
    ])
  })
})

describe('a host is fetched only if the state names it (its designated aliases, #1059)', () => {
  it('D01: at receipt, a link host the state does not name: hostNotNamed, nothing kept, no KEL fetched', async () => {
    for (const [result, why] of [
      ['notDesignated', 'hostNotListed'],
      ['notDesignated', 'notPublished'],
      ['notDesignated', 'statusNotCurrent'],
      ['notDesignated', 'badInput'],
      ['badFile', 'stateNotVerified'],
    ] as const) {
      const p = phone()
      const fetch = state()
      const r = await receiveGuardianCard(p.agent, CARD_URL, {
        fetchCard: office(),
        fetch: fetch as never,
        checkDesignation: named(result, why),
      })
      expect(r).toEqual({ kind: 'hostNotNamed' })
      expect(fetch).not.toHaveBeenCalled()
      expect(heldRecord(p)).toBeUndefined()
    }
  })

  it("D02: at receipt, the state's list unreadable: unreachable, nothing kept (control: designated, R01 keeps it)", async () => {
    const p = phone()
    const r = await receiveGuardianCard(p.agent, CARD_URL, {
      fetchCard: office(),
      fetch: state() as never,
      checkDesignation: named('unreachable', 'timeout'),
    })
    expect(r).toMatchObject({ kind: 'unreachable' })
    expect(heldRecord(p)).toBeUndefined()
  })

  const check = (checkDesignation: ReturnType<typeof named>, fetch = state()) =>
    checkGuardianEvidenceResolving(K0_TEST_GUARDIAN_CARD, WARD, new Date(), () => undefined, {
      fetch: fetch as never,
      stateHost: 'example.org',
      checkDesignation,
    })

  it("D03: the person's phone, a host the state does not name: no live fetch, the copy only, said so (not retryable)", async () => {
    const fetch = state()
    const v = await check(named('notDesignated', 'hostNotListed'), fetch)
    expect(v).toMatchObject({
      ok: true,
      hostWithheld: { host: 'example.org', result: 'notDesignated', why: 'hostNotListed', retryable: false },
    })
    expect(v.ok === true && v.fetchedFrom).toBeFalsy()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['unreachable', true],
    ['timeout', true],
    ['switchedOff', false],
  ])(
    'D04: the list could not be read (%s): copy only; Check again offered only for a failure that can pass (%s)',
    async (why, retryable) => {
      const v = await check(named('unreachable', why))
      expect(v).toMatchObject({ ok: true, hostWithheld: { result: 'unreachable', why, retryable } })
    }
  )

  it('D05: designated: fetched live there, and named as a host the state names (control for D03)', async () => {
    const designation = listed()
    const v = await check(designation)
    expect(v).toMatchObject({ ok: true, fetchedFrom: 'example.org', hostFromCard: true })
    expect(v.ok === true && v.hostWithheld).toBeFalsy()
    expect(designation).toHaveBeenCalledWith(K0_ROOT, 'example.org', expect.anything())
  })
})

describe("on the person's phone, the host is read from 0.2 only", () => {
  const arrive = async (type: string) => {
    const p = phone()
    const conn = 'c1'
    const agent = {
      ...(p.agent as object),
      context: {},
      config: { logger: { warn: jest.fn(), info: jest.fn() } },
      dependencyManager: {
        resolve: () => ({
          getAll: async () => [
            {
              connectionId: conn,
              myRelationshipDid: 'did:peer:2.mine',
              counterpartyRelationshipDid: 'did:peer:2.theirs',
            },
          ],
        }),
      },
    } as never
    await p.genericRecords.save({
      content: { state: 'accepted', connectionId: conn, agentDid: 'did:webvh:a.example', acceptedAs: 'did:peer:2.b' },
      tags: { recordType: 'keyring.approver-role-offer-ask', connectionId: conn },
    })
    const consume = jest.fn(async () => ({ kind: 'handled' as const }))
    const document = {
      id: 'd1',
      type,
      threadId: 'd1',
      issuer: 'did:peer:them',
      recipient: 'did:peer:me',
      issuedAt: '2026-11-13T00:00:00Z',
      payload: {
        agent: 'did:webvh:a.example',
        approver: 'did:peer:2.b',
        ...K0_TEST_GUARDIAN_CARD,
        stateHost: 'example.org',
        sentAt: '2026-11-13T00:00:00Z',
      },
    }
    await handleGuardianEvidence(agent, { consume } as never, document, {
      connectionId: conn,
      recipientDid: 'did:peer:me',
      senderDid: 'did:peer:them',
    } as never)
    const ask = p.genericRecords.records.find((r) => r.tags.recordType === 'keyring.approver-role-offer-ask')
    return { consume, guardian: (ask?.content as { guardian?: { stateHost?: string } }).guardian }
  }

  it('A01: a 0.2 card keeps the host it came with, checked against the 0.2 spec', async () => {
    const { consume, guardian } = await arrive(GUARDIAN_EVIDENCE_V2_TYPE_URI)
    expect((consume.mock.calls[0] as unknown[])[1]).toMatchObject({ spec: GUARDIAN_EVIDENCE_V2_SPEC })
    expect(guardian?.stateHost).toBe('example.org')
  })

  it('A02: a 0.1 document never carries a host to this phone, whatever its payload says (control: A01)', async () => {
    const { consume, guardian } = await arrive(GUARDIAN_EVIDENCE_TYPE_URI)
    expect((consume.mock.calls[0] as unknown[])[1]).toMatchObject({ spec: GUARDIAN_EVIDENCE_SPEC })
    expect(guardian?.stateHost).toBeUndefined()
  })
})

describe("the sender's line after a K1 (0.2) send", () => {
  const LANGS = ['en/en', 'fr/fr', 'pt-br/pt-br'] as const
  const line = (lang: (typeof LANGS)[number]) =>
    (
      JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'localization', `${lang}.json`), 'utf8')) as {
        Approver: Record<string, string>
      }
    ).Approver

  it('N01: a K1 card is marked k1 for its line; a K0 card is not (it keeps the old line)', async () => {
    const p = phone()
    await holdGuardianEvidence(p.agent, K0_TEST_GUARDIAN_CARD)
    expect(await cardToShare(p.agent)).toMatchObject({ k1: true })
    stateRoots.k1SettingsForTests.reset()
    expect((await cardToShare(p.agent))?.k1).toBeUndefined()
  })

  it('N02: the line never claims receipt, in any language: it says it was sent, and what an older Keyring does', () => {
    expect(line('en/en').CardSentToK1).toBe(
      "Sent to {{asker}}. If their Keyring is older than this one, it won't show the card."
    )
    const claims: Record<(typeof LANGS)[number], RegExp> = {
      'en/en': /receiv|deliver|arriv|got it|has it|reached/i,
      'fr/fr': /reçu|livr|arriv|parvenu/i,
      'pt-br/pt-br': /receb|entreg|cheg/i,
    }
    for (const lang of LANGS) {
      expect(line(lang).CardSentToK1).toMatch(/\{\{asker\}\}/)
      expect(line(lang).CardSentToK1).not.toMatch(claims[lang])
    }
  })
})
