/**
 * The Social Authorization (S2) end to end between two phones: Jordan's phone holds a Guardian card a test state
 * issued to ITS OWN holder AID, issues Sam (the card's ward) an authorization chained to it, and sends it with the
 * card; Sam's phone checks it under the card's own verdict and Who approves says so, in plain words.
 *
 * The holder's key is a test key (sedi/__tests__/fixtures/keriTestKit) standing in for the phone's KMS through the
 * controller's own interface. Every store here throws on delete: nothing in this flow deletes a record.
 */
import { useFocusEffect } from '@react-navigation/native'
import { act, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'
import { trustTaskPayloadValidator } from '@bifold/trust-tasks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { K0_TEST_GUARDIAN_CARD } from '../../sedi/guardian/k0TestCard'
import { K1_ROOT_AID } from '../../sedi/guardian/stateRoots'
import { HOLDER_IDENTITY } from '../../sedi/holder/controller'
import { WARD_IDENTITY } from '../../sedi/identity/phoneIdentity'
import { TestController, revoke, testState } from '../../sedi/__tests__/fixtures/keriTestKit'
import * as approverRole from '../approverRole'
import {
  GUARDIAN_EVIDENCE_TYPE_URI,
  GUARDIAN_EVIDENCE_V2_SPEC,
  GUARDIAN_EVIDENCE_V2_TYPE_URI,
  type GuardianEvidencePayload,
} from '../approverRoleSpec'
import {
  approverCardStandings,
  handleGuardianEvidence,
  holdGuardianEvidence,
  sendGuardianEvidence,
  setStateWard,
  type GuardianEvidence,
} from '../guardianEvidence'
import { SEDI_KERI_REMOTE_OFF } from '../module/sediKeriRemoteOff'
import {
  STATE_VERIFIED_APPROVERS_REMOTE_OFF,
  setStateVerifiedApproversEnabled,
} from '../module/stateVerifiedApproversFlag'
import { TRUSTED_APPROVERS_REMOTE_OFF, setTrustedApproversEnabled } from '../module/trustedApproversFlag'
import { vtaAgent, type TrustedApproversState } from '../module/vtaAgent'
import {
  SOCIAL_AUTHORIZATION,
  checkSocialAuthorization,
  revokeSocialAuthorization,
  socialMaterialFor,
  splitSocial,
  withSocial,
} from '../socialAuthorization'
import {
  blindedState,
  proofOf,
  registryInception,
  registryUpdate,
  sealOf,
  socialAuthorization,
} from '../../sedi/guardian/issue'
import { digest } from '../../sedi/guardian/kel'
import { random as kitRandom } from '../../sedi/__tests__/fixtures/keriTestKit'
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

// The state this phone trusts: the test state of each row (a demo root, as K0 and K1 are).
let mockRoots: { aid: string; name: string; demo: true }[] = []
jest.mock('../../sedi/guardian/stateRoots', () => {
  const actual = jest.requireActual('../../sedi/guardian/stateRoots')
  return { ...actual, trustedStateRoots: () => mockRoots, isDemoStateRoot: () => true }
})

// Jordan's holder key: the row's test controller, through the controller's own interface.
let mockHolder: TestController | null = null
jest.mock('../../sedi/holder/controller', () => {
  const actual = jest.requireActual('../../sedi/holder/controller')
  return {
    ...actual,
    holderKel: jest.fn(async () => mockHolder!.api.holderKel()),
    appendInteraction: jest.fn(async (_a: unknown, seals: Array<{ i: string; s: string; d: string }>) =>
      mockHolder!.api.appendInteraction(undefined, seals)
    ),
  }
})

const SAM_AGENT = 'did:webvh:sams-agent.example'
const JORDAN = 'did:peer:2.jordans-phone'
const CONN = 'c-jordan'
type Row = { id: string; content: Record<string, unknown>; tags: Record<string, string> }

function phone() {
  const rows: Row[] = []
  let n = 0
  const warn = jest.fn()
  const forbidden = jest.fn(async () => {
    throw new Error('this flow never deletes a record')
  })
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
      update: jest.fn(async (record: Row) => {
        const i = rows.findIndex((r) => r.id === record.id)
        rows[i] = { ...record, content: JSON.parse(JSON.stringify(record.content)) }
      }),
      deleteById: forbidden,
      delete: forbidden,
    },
    dependencyManager: {
      resolve: () => ({
        getAll: async () => [
          {
            connectionId: CONN,
            myRelationshipDid: 'did:peer:2.mine',
            counterpartyRelationshipDid: 'did:peer:2.theirs',
          },
        ],
      }),
    },
    modules: { didcomm: { connections: { getById: async () => ({ did: 'did:peer:me', theirDid: 'did:peer:them' }) } } },
    kms: { randomBytes: ({ length }: { length: number }) => require('@noble/hashes/utils.js').randomBytes(length) },
  }
  const of = (type: string) => rows.filter((r) => r.tags.recordType === type)
  return {
    agent: agent as never,
    rows,
    of,
    warn,
    forbidden,
    service: { consume: async () => ({ kind: 'handled' }) } as never,
  }
}

/** Jordan's phone: its holder identity (made, as the controller would), and the card the state issued to it. */
async function jordanWithCard(state = testState(), opts: { ward?: TestController } = {}) {
  const holder = new TestController()
  mockHolder = holder
  const sam = opts.ward ?? new TestController()
  const g = state.guardian(holder.aid, sam.aid)
  const jordan = phone()
  await (jordan.agent as { genericRecords: { save: (r: unknown) => Promise<void> } }).genericRecords.save({
    content: { aid: holder.aid, kel: holder.kel, sn: 0, said: holder.said },
    tags: { recordType: HOLDER_IDENTITY },
  })
  const evidence = state.evidenceOf(g) as GuardianEvidence
  expect(await holdGuardianEvidence(jordan.agent, evidence)).toBe('held')
  return { state, holder, sam, g, jordan, evidence }
}

const context = { connectionId: CONN, recipientDid: 'did:peer:me', senderDid: 'did:peer:them' } as never
const schemaTakes = (payload: unknown) =>
  trustTaskPayloadValidator.validate(GUARDIAN_EVIDENCE_V2_SPEC.payloadSchema, payload) === true

/** Sam's phone, its ward set, Jordan's yes written on the agent, and the payload Jordan's phone sent arriving. */
async function samReceives(
  payload: GuardianEvidencePayload,
  ward: string,
  type = lastType(),
  sam: ReturnType<typeof phone> = phone()
) {
  await setStateWard(sam.agent, ward)
  ;(sam.agent as { genericRecords: { save: (r: unknown) => Promise<void> } }).genericRecords.save({
    tags: { recordType: approverRole.ROLE_OFFER_ASK, connectionId: CONN },
    content: {
      state: 'closed',
      written: true,
      writtenAs: JORDAN,
      connectionId: CONN,
      threadId: 't-1',
      agentDid: SAM_AGENT,
      actions: ['joinCommunity'],
      challenge: 'c'.repeat(43),
      askedAt: new Date().toISOString(),
      acceptedAs: JORDAN,
    },
  })
  const document = {
    id: 'doc-1',
    type,
    threadId: 'doc-1',
    issuer: 'did:peer:them',
    recipient: 'did:peer:me',
    issuedAt: new Date().toISOString(),
    payload,
  }
  await handleGuardianEvidence(sam.agent, sam.service, document, context)
  return sam
}

const lastPayload = () => sent[sent.length - 1].payload as GuardianEvidencePayload
const lastType = () => (sent[sent.length - 1]?.type as string | undefined) ?? GUARDIAN_EVIDENCE_TYPE_URI
/** The authorization the last send carried, taken out of its lists as the person's phone does. */
const lastSocial = () => splitSocial({ ...lastPayload() } as GuardianEvidence, lastPayload().social!.said).material!
/** A payload with the authorization (and its parts) left out: what a send without one carries. */
const withoutSocial = (payload: GuardianEvidencePayload) => {
  const { social: _s, ...rest } = payload
  return { ...rest, ...splitSocial({ ...payload } as GuardianEvidence, payload.social!.said).card }
}

const allOn = () => {
  setTrustedApproversEnabled(true)
  setStateVerifiedApproversEnabled(true)
  TRUSTED_APPROVERS_REMOTE_OFF.off = false
  STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
}

beforeEach(() => {
  sent.length = 0
  mockHolder = null
  allOn()
})

/** 278.18's guardian-evidence/0.1 payload members: what a K0 card's send must stay, byte for byte. */
const OLD_MEMBERS = ['agent', 'approver', 'guardianSaid', 'holder', 'kels', 'tels', 'creds', 'sentAt']

describe("Jordan's phone: the authorization goes with a card issued to it, and only then", () => {
  test('K0 card, no holder made on this phone: the payload has exactly the old members, and no holder is made', async () => {
    const jordan = phone()
    await holdGuardianEvidence(jordan.agent, K0_TEST_GUARDIAN_CARD)
    expect(await sendGuardianEvidence(jordan.agent, CONN, SAM_AGENT, JORDAN)).toBe('sent')
    expect(Object.keys(lastPayload())).toEqual(OLD_MEMBERS)
    expect(lastType()).toBe(GUARDIAN_EVIDENCE_TYPE_URI)
    expect(jordan.of(HOLDER_IDENTITY)).toHaveLength(0)
    expect(jordan.of(SOCIAL_AUTHORIZATION)).toHaveLength(0)
  })

  test("a K0 card whose CREDENTIALS mention K1's AID still goes as 0.1, its payload exactly the card's", async () => {
    const jordan = phone()
    const mentions = { ...K0_TEST_GUARDIAN_CARD, creds: [...K0_TEST_GUARDIAN_CARD.creds, `{"note":"${K1_ROOT_AID}"}`] }
    await holdGuardianEvidence(jordan.agent, mentions)
    expect(await sendGuardianEvidence(jordan.agent, CONN, SAM_AGENT, JORDAN)).toBe('sent')
    expect(lastType()).toBe(GUARDIAN_EVIDENCE_TYPE_URI)
    const { sentAt, ...rest } = lastPayload()
    expect(typeof sentAt).toBe('string')
    expect(rest).toEqual({ agent: SAM_AGENT, approver: JORDAN, ...mentions })
    expect(Object.keys(lastPayload())).toEqual(OLD_MEMBERS)
  })

  test("K0 card on a phone that HAS its own holder: still no authorization (the card isn't issued to it)", async () => {
    const { jordan, holder } = await jordanWithCard()
    await holdGuardianEvidence(jordan.agent, K0_TEST_GUARDIAN_CARD)
    expect(await sendGuardianEvidence(jordan.agent, CONN, SAM_AGENT, JORDAN)).toBe('sent')
    expect(Object.keys(lastPayload())).toEqual(OLD_MEMBERS)
    expect(lastType()).toBe(GUARDIAN_EVIDENCE_TYPE_URI)
    expect(holder.anchored).toHaveLength(0)
  })

  test('a card issued to this phone: the authorization goes with it, the schema takes it, one anchoring event', async () => {
    const { jordan, holder, g } = await jordanWithCard()
    expect(await sendGuardianEvidence(jordan.agent, CONN, SAM_AGENT, JORDAN)).toBe('sent')
    const payload = lastPayload()
    expect(Object.keys(payload)).toEqual([...OLD_MEMBERS, 'social'])
    expect(lastType()).toBe(GUARDIAN_EVIDENCE_V2_TYPE_URI)
    expect(payload.social).toEqual({ said: expect.any(String) })
    expect(schemaTakes(payload)).toBe(true)
    // Its proof, its registry and the guardian's KEL ride in the card's own lists, after the card's.
    expect(payload.creds).toHaveLength(4)
    expect(payload.tels).toHaveLength(4)
    expect(payload.kels).toHaveLength(4)
    expect(payload.kels[3]).toBe(holder.kel)
    expect(holder.anchored).toHaveLength(1)
    const [rip, issued] = holder.anchored[0]
    expect(rip).toMatchObject({ s: '0' })
    expect(issued).toMatchObject({ i: rip.i, s: '1' })
    expect(jordan.of(SOCIAL_AUTHORIZATION)[0].content).toMatchObject({ guardianSaid: g.sad.d, state: 'issued' })
  })

  test('sent again for the same card: the same authorization, nothing issued or anchored again', async () => {
    const { jordan, holder } = await jordanWithCard()
    await sendGuardianEvidence(jordan.agent, CONN, SAM_AGENT, JORDAN)
    const first = lastPayload().social!.said
    await sendGuardianEvidence(jordan.agent, CONN, SAM_AGENT, JORDAN)
    expect(lastPayload().social!.said).toBe(first)
    expect(holder.anchored).toHaveLength(1)
    expect(jordan.of(SOCIAL_AUTHORIZATION)).toHaveLength(1)
  })

  test('a new card: a new authorization, and the old one revoked in the same anchoring event', async () => {
    const { jordan, holder, state, sam } = await jordanWithCard()
    await sendGuardianEvidence(jordan.agent, CONN, SAM_AGENT, JORDAN)
    const old = jordan.of(SOCIAL_AUTHORIZATION)[0].content as { rd: string; said: string }
    const g2 = state.guardian(holder.aid, sam.aid)
    await holdGuardianEvidence(jordan.agent, state.evidenceOf(g2) as GuardianEvidence)
    await sendGuardianEvidence(jordan.agent, CONN, SAM_AGENT, JORDAN)
    expect(lastPayload().social!.said).not.toBe(old.said)
    expect(holder.anchored).toHaveLength(2)
    expect(holder.anchored[1]).toEqual([
      expect.objectContaining({ i: old.rd, s: '2' }),
      expect.objectContaining({ s: '0' }),
      expect.objectContaining({ s: '1' }),
    ])
  })

  test('switched off: nothing issued, nothing anchored, nothing kept', async () => {
    const { jordan, holder, evidence } = await jordanWithCard()
    setStateVerifiedApproversEnabled(false)
    expect(await socialMaterialFor(jordan.agent, evidence)).toBeUndefined()
    SEDI_KERI_REMOTE_OFF.off = true
    setStateVerifiedApproversEnabled(true)
    expect(await socialMaterialFor(jordan.agent, evidence)).toBeUndefined()
    expect(holder.anchored).toHaveLength(0)
    expect(jordan.of(SOCIAL_AUTHORIZATION)).toHaveLength(0)
  })

  test('a failure to issue never stops the card: it goes without the authorization', async () => {
    const { jordan, holder } = await jordanWithCard()
    jest.spyOn(holder.api, 'appendInteraction').mockRejectedValueOnce(new Error('key store busy'))
    expect(await sendGuardianEvidence(jordan.agent, CONN, SAM_AGENT, JORDAN)).toBe('sent')
    expect(Object.keys(lastPayload())).toEqual(OLD_MEMBERS)
    expect(lastPayload().creds).toHaveLength(3)
    expect(jordan.warn.mock.calls.map(String).join()).toMatch(/no authorization sent with the card/)
  })
})

describe("Sam's phone: the authorization checked under the card's own verdict", () => {
  const sent1 = async (over: { ward?: TestController } = {}) => {
    const setup = await jordanWithCard(testState(), over)
    mockRoots = [{ aid: setup.state.root.aid, name: 'Test State', demo: true }]
    await sendGuardianEvidence(setup.jordan.agent, CONN, SAM_AGENT, JORDAN)
    return { ...setup, payload: lastPayload() }
  }

  test('it checks out: the card and the authorization both, from one check', async () => {
    const { payload, sam } = await sent1()
    const phoneOfSam = await samReceives(payload, sam.aid)
    const { cards, social } = await approverCardStandings(phoneOfSam.agent)
    expect(cards[JORDAN]).toMatchObject({ kind: 'verified', state: 'Test State' })
    expect(social[JORDAN]).toEqual({ kind: 'authorized', state: 'Test State' })
  })

  test('an older payload (no authorization): the card shows as before, with no authorization entry', async () => {
    const { payload, sam } = await sent1()
    const phoneOfSam = await samReceives(
      withoutSocial(payload) as GuardianEvidencePayload,
      sam.aid,
      GUARDIAN_EVIDENCE_TYPE_URI
    )
    const { cards, social } = await approverCardStandings(phoneOfSam.agent)
    expect(cards[JORDAN]).toMatchObject({ kind: 'verified' })
    expect(social).toEqual({})
  })

  test('another ward on this phone: the card is refused, and the authorization falls under it (underCard)', async () => {
    const { payload } = await sent1()
    const phoneOfSam = await samReceives(payload, new TestController().aid)
    const { cards, social } = await approverCardStandings(phoneOfSam.agent)
    expect(cards[JORDAN]).toMatchObject({ kind: 'unverified', outcome: 'wardMismatch' })
    expect(social[JORDAN]).toEqual({ kind: 'refused', outcome: 'wardMismatch', underCard: true })
  })

  test("the card names this phone's OWN ward code while another ward is set: card and authorization both check out, on arrival and on open (control: the row above)", async () => {
    const { payload, sam } = await sent1()
    const other = new TestController().aid
    const phoneOfSam = phone()
    ;(phoneOfSam.agent as { genericRecords: { save: (r: unknown) => Promise<void> } }).genericRecords.save({
      tags: { recordType: WARD_IDENTITY },
      content: { aid: sam.aid, keyId: 'k-own', createdAt: '2026-11-13T21:00:00.000Z' },
    })
    const arrived = await samReceives(payload, other, lastType(), phoneOfSam)
    const kept = arrived.rows.find((r) => r.tags.recordType === approverRole.ROLE_OFFER_ASK)
      ?.content as unknown as approverRole.RoleOfferAsk
    expect(kept.guardian?.verdict).toMatchObject({ ok: true })
    expect(kept.guardian?.social?.verdict).toMatchObject({ ok: true })
    const { cards, social } = await approverCardStandings(arrived.agent)
    expect(cards[JORDAN]).toMatchObject({ kind: 'verified', state: 'Test State' })
    expect(social[JORDAN]).toEqual({ kind: 'authorized', state: 'Test State' })
  })

  test('CASCADE: the state revoked the card (it carries the revocation): the authorization falls with it', async () => {
    const setup = await jordanWithCard()
    mockRoots = [{ aid: setup.state.root.aid, name: 'Test State', demo: true }]
    await sendGuardianEvidence(setup.jordan.agent, CONN, SAM_AGENT, JORDAN)
    const material = lastSocial()
    revoke(setup.g)
    const revoked = {
      ...lastPayload(),
      ...withSocial(setup.state.evidenceOf(setup.g) as GuardianEvidence, material),
    }
    const phoneOfSam = await samReceives(revoked, setup.sam.aid)
    const standings = await approverCardStandings(phoneOfSam.agent)
    expect(standings.cards[JORDAN]).toMatchObject({ kind: 'unverified', outcome: 'revoked' })
    expect(standings.social[JORDAN]).toEqual({ kind: 'refused', outcome: 'revoked', underCard: true })
  })

  test('the guardian revoked the authorization itself: refused for its own reason, the card still checks out', async () => {
    const setup = await jordanWithCard()
    mockRoots = [{ aid: setup.state.root.aid, name: 'Test State', demo: true }]
    await sendGuardianEvidence(setup.jordan.agent, CONN, SAM_AGENT, JORDAN)
    const issued = lastPayload().social!.said
    expect(await revokeSocialAuthorization(setup.jordan.agent)).toBe('revoked')
    // Sent again after the revoke: the same authorization goes, with its revocation; none is issued again.
    await sendGuardianEvidence(setup.jordan.agent, CONN, SAM_AGENT, JORDAN)
    expect(lastPayload().social!.said).toBe(issued)
    expect(setup.holder.anchored).toHaveLength(2)
    expect(await revokeSocialAuthorization(setup.jordan.agent)).toBe('none')
    const phoneOfSam = await samReceives(lastPayload(), setup.sam.aid)
    const standings = await approverCardStandings(phoneOfSam.agent)
    expect(standings.cards[JORDAN]).toMatchObject({ kind: 'verified' })
    expect(standings.social[JORDAN]).toEqual({ kind: 'refused', outcome: 'revoked' })
  })

  test('naming an authorization the lists do not carry: refused as incomplete, never checked from part of it', async () => {
    const { payload, sam } = await sent1()
    const edited = { ...payload, social: { said: 'E' + 'A'.repeat(43) } }
    const phoneOfSam = await samReceives(edited, sam.aid)
    const standings = await approverCardStandings(phoneOfSam.agent)
    expect(standings.cards[JORDAN]).toMatchObject({ kind: 'verified' })
    expect(standings.social[JORDAN]).toEqual({ kind: 'refused', outcome: 'socialIncomplete' })
  })

  test('`social` naming the CARD itself fails closed: the card loses its own credential, nothing is admitted', async () => {
    const { payload, sam } = await sent1()
    const phoneOfSam = await samReceives({ ...payload, social: { said: payload.guardianSaid } }, sam.aid)
    const standings = await approverCardStandings(phoneOfSam.agent)
    expect(standings.cards[JORDAN]).toMatchObject({ kind: 'unverified' })
    expect(standings.social[JORDAN]).toMatchObject({ kind: 'refused' })
  })

  test('the authorization edited after issuing (its credential swapped for another): refused, the card checks out', async () => {
    const { payload, sam } = await sent1()
    const m = splitSocial({ ...payload } as GuardianEvidence, payload.social!.said)
    const tampered = m.material!.cred.split(sam.aid).join(new TestController().aid)
    const lists = withSocial(m.card, { ...m.material!, cred: tampered })
    const phoneOfSam = await samReceives({ ...payload, ...lists }, sam.aid)
    const standings = await approverCardStandings(phoneOfSam.agent)
    expect(standings.cards[JORDAN]).toMatchObject({ kind: 'verified' })
    expect(standings.social[JORDAN]).toMatchObject({ kind: 'refused' })
    expect(standings.social[JORDAN]).not.toMatchObject({ underCard: true })
  })

  test('the card refused LIVE while its own copy is fine: the authorization is refused under it, never admitted', async () => {
    const { payload, sam } = await sent1()
    const { card: evidence, material } = splitSocial({ ...payload } as GuardianEvidence, payload.social!.said)
    // Control: under a card that checks out, it does.
    const ok = { ok: true as const, root: mockRoots[0].aid, state: 'Test State', checkedAt: '' }
    expect(checkSocialAuthorization(evidence, material!, sam.aid, ok, new Date(), jest.fn())).toMatchObject({
      ok: true,
    })
    // The state's published record shows the card revoked; the copy it carries does not.
    const live = { ok: false as const, reason: 'revokedInIssuerRecord', detail: 'published', checkedAt: '' }
    expect(checkSocialAuthorization(evidence, material!, sam.aid, live, new Date(), jest.fn())).toMatchObject({
      ok: false,
      reason: 'revokedInIssuerRecord',
      underCard: true,
    })
  })

  test('issued by the holder on this card but to ANOTHER ward: refused as not issued to this phone (wrongHolder)', async () => {
    const setup = await jordanWithCard()
    mockRoots = [{ aid: setup.state.root.aid, name: 'Test State', demo: true }]
    const evidence = setup.evidence
    const other = new TestController()
    const at = '2026-11-13T01:00:00.000Z'
    const rip = registryInception(digest, setup.holder.aid, at, kitRandom)
    const s2 = socialAuthorization(
      digest,
      {
        issuer: setup.holder.aid,
        ward: other.aid,
        rd: rip.rd,
        guardianSaid: evidence.guardianSaid,
        issued: at,
        expires: '2026-12-13T01:00:00.000Z',
      },
      kitRandom
    )
    const b = blindedState(digest, s2.sad.d, 'issued', kitRandom)
    const bup = registryUpdate(digest, rip.rd, 1, rip.rd, at, b.blid)
    setup.holder.anchor([sealOf(rip.rd, 0, rip.rd), sealOf(rip.rd, 1, bup.said)])
    const social = {
      said: s2.sad.d,
      kel: setup.holder.kel,
      tel: { ripText: rip.text, updateTexts: [bup.text] },
      cred: proofOf(s2.text, b),
    }
    const ok = { ok: true as const, root: setup.state.root.aid, state: 'Test State', checkedAt: '' }
    expect(checkSocialAuthorization(evidence, social, setup.sam.aid, ok, new Date(), jest.fn())).toMatchObject({
      ok: false,
      reason: 'wrongHolder',
    })
  })

  test('an authorization the holder issued on ANOTHER of its cards, sent with this card: refused (notThisCard)', async () => {
    const setup = await jordanWithCard()
    mockRoots = [{ aid: setup.state.root.aid, name: 'Test State', demo: true }]
    const g2 = setup.state.guardian(setup.holder.aid, setup.sam.aid)
    const other = await socialMaterialFor(setup.jordan.agent, setup.state.evidenceOf(g2) as GuardianEvidence)
    const ok = { ok: true as const, root: setup.state.root.aid, state: 'Test State', checkedAt: '' }
    expect(checkSocialAuthorization(setup.evidence, other!, setup.sam.aid, ok, new Date(), jest.fn())).toMatchObject({
      ok: false,
      reason: 'notThisCard',
    })
  })

  test('checked again on open, never read from what was kept: a card that stood at receipt and no longer does', async () => {
    const { payload, sam, state } = await sent1()
    const phoneOfSam = await samReceives(payload, sam.aid)
    // Kept at receipt: authorized (the control).
    const kept = phoneOfSam.of(approverRole.ROLE_OFFER_ASK)[0].content as {
      guardian: { social: { verdict: { ok: boolean } } }
    }
    expect(kept.guardian.social.verdict.ok).toBe(true)
    // On open, this phone no longer trusts that state: the card is refused, and the authorization with it.
    mockRoots = []
    const { cards, social } = await approverCardStandings(phoneOfSam.agent)
    expect(cards[JORDAN]).toMatchObject({ kind: 'unverified', outcome: 'untrustedRoot' })
    expect(social[JORDAN]).toEqual({ kind: 'refused', outcome: 'untrustedRoot', underCard: true })
    void state
  })

  test("switched off on Sam's phone: no card and no authorization are read", async () => {
    const { payload, sam } = await sent1()
    const phoneOfSam = await samReceives(payload, sam.aid)
    setStateVerifiedApproversEnabled(false)
    expect(await approverCardStandings(phoneOfSam.agent)).toEqual({ cards: {}, social: {} })
  })
})

describe('Who approves: one honest line for the authorization', () => {
  const id = (key: string) => testIdWithKey(key)
  const showFor = async (agent: unknown) => {
    ;(useFocusEffect as jest.Mock).mockImplementation((effect: () => void) => require('react').useEffect(effect, []))
    ;(useAgent as jest.Mock).mockReturnValue({ agent })
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
  const received = async (opts: { strip?: boolean; otherWard?: boolean; edited?: boolean } = {}) => {
    const setup = await jordanWithCard()
    mockRoots = [{ aid: setup.state.root.aid, name: 'Test State', demo: true }]
    await sendGuardianEvidence(setup.jordan.agent, CONN, SAM_AGENT, JORDAN)
    const payload = lastPayload()
    const edited = { ...payload, social: { said: 'E' + 'A'.repeat(43) } }
    return samReceives(
      (opts.strip ? withoutSocial(payload) : opts.edited ? edited : payload) as GuardianEvidencePayload,
      opts.otherWard ? new TestController().aid : setup.sam.aid,
      opts.strip ? GUARDIAN_EVIDENCE_TYPE_URI : GUARDIAN_EVIDENCE_V2_TYPE_URI
    )
  }

  test('refused for its own reason under a card that checks out: "didn\'t check out", never "authorized"', async () => {
    const tree = await showFor((await received({ edited: true })).agent)
    expect(tree.getByTestId(id(TrustedApproversIds.guardianVerified(JORDAN)))).toBeTruthy()
    expect(tree.getByTestId(id(TrustedApproversIds.socialRefused(JORDAN))).props.children).toBe(
      'Approver.SocialNotAuthorized'
    )
    expect(tree.queryByTestId(id(TrustedApproversIds.socialAuthorized(JORDAN)))).toBeNull()
    expect(tree.getByText('Approver.GuardianAsShown')).toBeTruthy()
  })

  test('authorized: "Jordan authorized you" and "signed … sent from Jordan\'s phone", in place of "Not yet"', async () => {
    const tree = await showFor((await received()).agent)
    expect(tree.getByTestId(id(TrustedApproversIds.socialAuthorized(JORDAN))).props.children).toBe(
      'Approver.SocialAuthorized'
    )
    expect(tree.getByTestId(id(TrustedApproversIds.socialFromPhone(JORDAN))).props.children).toBe(
      'Approver.SocialSignedFromPhone'
    )
    expect(tree.queryByText('Approver.GuardianAsShown')).toBeNull()
  })

  test('control: no authorization sent: "Not yet" stays, and no authorization line', async () => {
    const tree = await showFor((await received({ strip: true })).agent)
    expect(tree.getByText('Approver.GuardianAsShown')).toBeTruthy()
    expect(tree.queryByTestId(id(TrustedApproversIds.socialAuthorized(JORDAN)))).toBeNull()
  })

  test('the card fails under it: never "authorized", and no line blaming the authorization', async () => {
    const tree = await showFor((await received({ otherWard: true })).agent)
    expect(tree.queryByTestId(id(TrustedApproversIds.socialAuthorized(JORDAN)))).toBeNull()
    expect(tree.queryByTestId(id(TrustedApproversIds.socialRefused(JORDAN)))).toBeNull()
    expect(tree.getByTestId(id(TrustedApproversIds.guardianUnverified(JORDAN)))).toBeTruthy()
  })

  test('state-verified approvers off: no card box and no authorization line (the screen itself checks)', async () => {
    const sam = await received()
    setStateVerifiedApproversEnabled(false)
    const tree = await showFor(sam.agent)
    expect(tree.queryByTestId(id(TrustedApproversIds.socialAuthorized(JORDAN)))).toBeNull()
    expect(tree.queryByTestId(id(TrustedApproversIds.checkedBox(JORDAN)))).toBeNull()
  })
})
