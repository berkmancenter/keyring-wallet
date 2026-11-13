/**
 * Who approves, at a glance (B, Alberto's go 11-12): each approver is a header pill and up to three labelled boxes:
 * "What Keyring checked", the demo state's own box (its name and the Demo pill, only for a root the phone's list marks
 * demo), and "Needs <name>'s yes". Plus "Check again" for a state that couldn't be reached, and a solid red Remove for
 * a revoked card. What each box says is decided by guardianEvidence (tested in guardianEvidence.test.tsx); here, which
 * box shows for which standing, and that none of it shows with the switches off.
 */
import { useFocusEffect } from '@react-navigation/native'
import { act, fireEvent, render, within } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { ButtonType } from '../../../components/buttons/Button-api'
import { testIdWithKey } from '../../../utils/testable'
import * as demoHost from '../../sedi/webs/demoStateHost'
import * as stateRoots from '../../sedi/guardian/stateRoots'
import { K0_TEST_ROOT } from '../../sedi/guardian/stateRoots'
import * as approverRole from '../approverRole'
import * as guardianEvidence from '../guardianEvidence'
import { type GuardianStanding } from '../guardianEvidence'
import { SEDI_KERI_REMOTE_OFF } from '../module/sediKeriRemoteOff'
import { setStateVerifiedApproversEnabled } from '../module/stateVerifiedApproversFlag'
import { TRUSTED_APPROVERS_REMOTE_OFF, setTrustedApproversEnabled } from '../module/trustedApproversFlag'
import { vtaAgent, type TrustedApproversState } from '../module/vtaAgent'
import VtaTrustedApprovers, { TrustedApproversIds as Ids } from '../screens/VtaTrustedApprovers'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const AGENT = { genericRecords: {} } as never
const JORDAN = 'did:peer:2.jordans-phone'
const UTAH = 'State of Utah'

let standings: jest.SpyInstance
/** The screen reads the card and its authorization from one call (approverCardStandings); these rows set the cards. */
const cardsAre = (cards: Record<string, GuardianStanding>) => standings.mockResolvedValue({ cards, social: {} })
let demos: jest.SpyInstance

const state = (): TrustedApproversState =>
  ({
    view: { approvers: [JORDAN], keys: ['joinCommunity', 'setTrustedApprovers'], heldElsewhere: [] },
    version: 1,
  }) as unknown as TrustedApproversState

const show = async (standing?: GuardianStanding, demoState?: string) => {
  cardsAre(standing ? { [JORDAN]: standing } : {})
  demos.mockResolvedValue(demoState ? { [JORDAN]: demoState } : {})
  const tree = render(
    <BasicAppContext>
      <VtaTrustedApprovers />
    </BasicAppContext>
  )
  await act(async () => undefined)
  return tree
}
type Tree = Awaited<ReturnType<typeof show>>
const has = (tree: Tree, key: string) => tree.queryByTestId(id(key)) !== null

const VERIFIED_DEMO: GuardianStanding = { kind: 'verified', state: UTAH, demo: true }
const VERIFIED_REAL: GuardianStanding = { kind: 'verified', state: 'State of Somewhere' }
const UNREACHABLE: GuardianStanding = { kind: 'unreachable', state: UTAH }
const REVOKED = (outcome: string): GuardianStanding => ({ kind: 'unverified', outcome })

beforeEach(() => {
  jest.restoreAllMocks()
  ;(useFocusEffect as jest.Mock).mockImplementation((effect: () => void) => require('react').useEffect(effect, []))
  ;(useAgent as jest.Mock).mockReturnValue({ agent: AGENT })
  TRUSTED_APPROVERS_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
  setTrustedApproversEnabled(true)
  setStateVerifiedApproversEnabled(true)
  jest.spyOn(vtaAgent, 'trustedApprovers').mockResolvedValue(state())
  jest.spyOn(approverRole, 'acceptedRoleOffers').mockResolvedValue([])
  jest.spyOn(approverRole, 'approverNames').mockResolvedValue({ [JORDAN]: 'Jordan' })
  jest.spyOn(approverRole, 'approvingFor').mockResolvedValue([])
  jest.spyOn(approverRole, 'steppedDownApprovers').mockResolvedValue([])
  jest.spyOn(guardianEvidence, 'cardToShare').mockResolvedValue(undefined)
  jest.spyOn(guardianEvidence, 'cardConsents').mockResolvedValue({})
  jest.spyOn(demoHost, 'demoStateHost').mockReturnValue(null)
  standings = jest.spyOn(guardianEvidence, 'approverCardStandings')
  demos = jest.spyOn(guardianEvidence, 'guardianDemoStates')
})
afterAll(() => {
  setStateVerifiedApproversEnabled(false)
  setTrustedApproversEnabled(false)
})

describe('Who approves: the header pill says the standing in the state card words (B3)', () => {
  test.each([
    ['verified', VERIFIED_DEMO, 'Approver.PillChecksOut'],
    ['unreachable', UNREACHABLE, 'StateCard.PillNotReached'],
    ['revoked (its own)', REVOKED('revoked'), 'StateCard.PillRevoked'],
    ["revoked (the issuer's record)", REVOKED('revokedInIssuerRecord'), 'StateCard.PillRevoked'],
    ["revoked (the state's record)", REVOKED('revokedInStateRecord'), 'StateCard.PillRevoked'],
    ["couldn't verify", REVOKED('wardMismatch'), 'StateCard.PillCouldNotVerify'],
    ['no card', undefined, 'Approver.PillNoCard'],
  ] as const)('%s: the pill reads %s', async (_, standing, words) => {
    const tree = await show(standing)
    expect(within(tree.getByTestId(id(Ids.pill(JORDAN)))).getByText(words)).toBeTruthy()
  })

  test('the approver never carries a Demo pill of their own: it is inside the state box (control: the box has it)', async () => {
    const tree = await show(VERIFIED_DEMO)
    const header = tree.getByTestId(id(Ids.pill(JORDAN)))
    expect(within(header).queryByText('Approver.DemoPill')).toBeNull()
    expect(within(tree.getByTestId(id(Ids.stateBox(JORDAN)))).getByTestId(id(Ids.guardianDemo(JORDAN)))).toBeTruthy()
  })
})

describe('Who approves: the three boxes (B1, B2)', () => {
  test('verified: a tick for the card and an open ring for what is not yet checked (the gap is shown)', async () => {
    const tree = await show(VERIFIED_DEMO)
    const box = tree.getByTestId(id(Ids.checkedBox(JORDAN)))
    expect(within(box).getByTestId(id(`${Ids.mark(JORDAN)}_pass`))).toBeTruthy()
    expect(within(box).getByTestId(id(Ids.guardianVerified(JORDAN)))).toBeTruthy()
    expect(within(box).getByText('Approver.GuardianAsShown')).toBeTruthy()
    expect(has(tree, Ids.needsBox(JORDAN))).toBe(true)
  })

  test("the needs box lists each action the agent waits on, under Needs <name>'s yes", async () => {
    const tree = await show(VERIFIED_DEMO)
    const box = tree.getByTestId(id(Ids.needsBox(JORDAN)))
    expect(within(box).getByText('Approver.NeedsTitle')).toBeTruthy()
    expect(within(box).getByText('· Approver.Action.joinCommunity')).toBeTruthy()
    expect(within(box).getByText('· Approver.Action.setTrustedApprovers')).toBeTruthy()
  })

  test.each([
    ['unreachable', UNREACHABLE, '_warn'],
    ['revoked', REVOKED('revoked'), '_fail'],
    ["couldn't verify", REVOKED('wardMismatch'), '_fail'],
  ] as const)("%s: the checked box's mark is %s, never a pass", async (_, standing, mark) => {
    const tree = await show(standing, UTAH)
    const box = tree.getByTestId(id(Ids.checkedBox(JORDAN)))
    expect(within(box).getByTestId(id(`${Ids.mark(JORDAN)}${mark}`))).toBeTruthy()
    expect(within(box).queryByTestId(id(`${Ids.mark(JORDAN)}_pass`))).toBeNull()
  })

  test('no card: one plain line, no checked box, and no state box (not sharing is a choice)', async () => {
    const tree = await show(undefined)
    expect(has(tree, Ids.noCard(JORDAN))).toBe(true)
    expect(has(tree, Ids.checkedBox(JORDAN))).toBe(false)
    expect(has(tree, Ids.stateBox(JORDAN))).toBe(false)
  })
})

describe("Who approves: the state's own box shows only for a demo root (Demo only for the state)", () => {
  test('verified from a demo root: the box, titled with its name, with the copy line (control: a real root has none)', async () => {
    const demo = await show(VERIFIED_DEMO)
    const box = demo.getByTestId(id(Ids.stateBox(JORDAN)))
    expect(within(box).getByText(UTAH)).toBeTruthy()
    expect(within(box).getByTestId(id(Ids.guardianDemoCopy(JORDAN)))).toBeTruthy()
    demo.unmount()
    const real = await show(VERIFIED_REAL)
    expect(has(real, Ids.stateBox(JORDAN))).toBe(false)
    expect(has(real, Ids.guardianDemo(JORDAN))).toBe(false)
  })

  test('verified live from a demo root: the fetched line (with its host) is in the state box, not the checked box', async () => {
    const tree = await show({ ...VERIFIED_DEMO, fetchedFrom: 'abc-def.trycloudflare.com', fetchedIssuers: true })
    const line = within(tree.getByTestId(id(Ids.stateBox(JORDAN)))).getByTestId(id(Ids.guardianFetchedLive(JORDAN)))
    expect(line.props.children).toBe('Approver.GuardianFetchedLive')
    expect(
      within(tree.getByTestId(id(Ids.checkedBox(JORDAN)))).queryByTestId(id(Ids.guardianFetchedLive(JORDAN)))
    ).toBeNull()
  })

  test('verified live from a real root: the fetched line stays in the checked box (no state box to hold it)', async () => {
    const tree = await show({ ...VERIFIED_REAL, fetchedFrom: 'state.example', fetchedIssuers: true })
    expect(
      within(tree.getByTestId(id(Ids.checkedBox(JORDAN)))).getByTestId(id(Ids.guardianFetchedLive(JORDAN)))
    ).toBeTruthy()
  })

  // SEDI lane's rows: a revoked and an unreachable K0 card both show the box; the same variants from a root that is
  // not demo show none.
  test.each([
    ['unreachable', UNREACHABLE],
    ['revoked', REVOKED('revoked')],
    ['revoked in the state record', REVOKED('revokedInStateRecord')],
  ] as const)(
    '%s, card from the demo root: the state box shows (control: no demo root named, none)',
    async (_, standing) => {
      const demo = await show(standing, UTAH)
      expect(within(demo.getByTestId(id(Ids.stateBox(JORDAN)))).getByText(UTAH)).toBeTruthy()
      demo.unmount()
      const real = await show(standing, undefined)
      expect(has(real, Ids.stateBox(JORDAN))).toBe(false)
    }
  )

  // A refusal other than revoked: the root the card names is its own unchecked claim, so no state box beside it, even
  // when the card writes the K0 root's AID (control: the same demo root named on a revoked card shows the box).
  test.each(['signatureInvalid', 'wardMismatch', 'untrustedRoot', 'checkFailed'])(
    "couldn't verify (%s), card claiming the demo root: no state box and no Demo pill (control: revoked shows it)",
    async (outcome) => {
      const forged = await show(REVOKED(outcome), UTAH)
      expect(has(forged, Ids.stateBox(JORDAN))).toBe(false)
      expect(has(forged, Ids.guardianDemo(JORDAN))).toBe(false)
      expect(forged.queryByText(UTAH)).toBeNull()
      forged.unmount()
      const revoked = await show(REVOKED('revoked'), UTAH)
      expect(has(revoked, Ids.stateBox(JORDAN))).toBe(true)
    }
  )

  test('unreachable demo state: the box names the Demo state host (B4) (control: no host, the plain test-state line)', async () => {
    jest.spyOn(demoHost, 'demoStateHost').mockReturnValue('abc-def.trycloudflare.com')
    const withHost = await show(UNREACHABLE, UTAH)
    expect(
      within(withHost.getByTestId(id(Ids.stateBox(JORDAN)))).getByText('Approver.DemoStateUnreachableHost')
    ).toBeTruthy()
    withHost.unmount()
    jest.spyOn(demoHost, 'demoStateHost').mockReturnValue(null)
    const without = await show(UNREACHABLE, UTAH)
    expect(within(without.getByTestId(id(Ids.stateBox(JORDAN)))).getByText('Approver.DemoStateIs')).toBeTruthy()
  })
})

describe('Who approves: Check again for a state that could not be reached (B5)', () => {
  test('shown only for unreachable (control: verified has none)', async () => {
    expect(has(await show(UNREACHABLE, UTAH), Ids.checkAgain(JORDAN))).toBe(true)
    expect(has(await show(VERIFIED_DEMO), Ids.checkAgain(JORDAN))).toBe(false)
  })

  test('still unreachable: checked again, the same box with the time of the try', async () => {
    const tree = await show(UNREACHABLE, UTAH)
    expect(has(tree, Ids.triedAgain(JORDAN))).toBe(false)
    const before = standings.mock.calls.length
    await act(async () => fireEvent.press(tree.getByTestId(id(Ids.checkAgain(JORDAN)))))
    expect(standings.mock.calls).toHaveLength(before + 1)
    expect(has(tree, Ids.guardianUnreachable(JORDAN))).toBe(true)
    expect(has(tree, Ids.triedAgain(JORDAN))).toBe(true)
  })

  test('reached this time: the verified card and its timed live line, never the copy line', async () => {
    const tree = await show(UNREACHABLE, UTAH)
    cardsAre({
      [JORDAN]: {
        ...VERIFIED_DEMO,
        fetchedFrom: 'abc-def.trycloudflare.com',
        fetchedAt: new Date().toISOString(),
        fetchedIssuers: true,
      },
    })
    await act(async () => fireEvent.press(tree.getByTestId(id(Ids.checkAgain(JORDAN)))))
    expect(has(tree, Ids.guardianUnreachable(JORDAN))).toBe(false)
    expect(tree.getByTestId(id(Ids.guardianFetchedLive(JORDAN))).props.children).toBe('Approver.GuardianFetchedLiveAt')
    expect(has(tree, Ids.guardianDemoCopy(JORDAN))).toBe(false)
  })
})

describe('Who approves: a revoked card (B6)', () => {
  test.each(['revoked', 'revokedInIssuerRecord', 'revokedInStateRecord'])(
    '%s: Remove is solid red and the needs box says the agent still waits (control: verified, Remove is not)',
    async (outcome) => {
      const revoked = await show(REVOKED(outcome), UTAH)
      expect(revoked.getByTestId(id(Ids.remove(JORDAN)))).toBeTruthy()
      expect(revoked.UNSAFE_getAllByProps({ testID: id(Ids.remove(JORDAN)) })[0].props.buttonType).toBe(
        ButtonType.Critical
      )
      expect(within(revoked.getByTestId(id(Ids.needsBox(JORDAN)))).getByText('Approver.RevokedStillWaits')).toBeTruthy()
      revoked.unmount()
      const ok = await show(VERIFIED_DEMO)
      expect(ok.UNSAFE_getAllByProps({ testID: id(Ids.remove(JORDAN)) })[0].props.buttonType).toBe(ButtonType.Secondary)
      expect(within(ok.getByTestId(id(Ids.needsBox(JORDAN)))).queryByText('Approver.RevokedStillWaits')).toBeNull()
    }
  )
})

describe('Who approves: hidden with the switches off (ac)', () => {
  test('state-verified approvers off: no pill, no checked box, no state box, no Check again (control: on, all shown)', async () => {
    const on = await show(UNREACHABLE, UTAH)
    for (const key of [Ids.pill(JORDAN), Ids.checkedBox(JORDAN), Ids.stateBox(JORDAN), Ids.checkAgain(JORDAN)])
      expect(has(on, key)).toBe(true)
    on.unmount()
    setStateVerifiedApproversEnabled(false)
    const off = await show(UNREACHABLE, UTAH)
    for (const key of [Ids.pill(JORDAN), Ids.checkedBox(JORDAN), Ids.stateBox(JORDAN), Ids.checkAgain(JORDAN)])
      expect(has(off, key)).toBe(false)
    // The approver and what they hold up still show: that is the trusted-approvers switch's, not this one's.
    expect(has(off, Ids.needsBox(JORDAN))).toBe(true)
  })

  test.each([
    ['the trusted-approvers switch', () => setTrustedApproversEnabled(false)],
    ['the trusted-approvers remote off', () => (TRUSTED_APPROVERS_REMOTE_OFF.off = true)],
    ['the SEDI/KERI remote off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
  ])(
    '%s: the screen itself is the switched-off line, with none of the boxes (control: on, the boxes)',
    async (_, off) => {
      const on = await show(VERIFIED_DEMO)
      expect(has(on, Ids.needsBox(JORDAN))).toBe(true)
      on.unmount()
      off()
      const tree = await show(VERIFIED_DEMO)
      expect(has(tree, Ids.off)).toBe(true)
      for (const key of [Ids.pill(JORDAN), Ids.checkedBox(JORDAN), Ids.stateBox(JORDAN), Ids.needsBox(JORDAN)])
        expect(has(tree, key)).toBe(false)
    }
  )
})

describe('guardianDemoStates: the demo root a kept card names, from the list only', () => {
  const recordWith = (
    said: string,
    over: Partial<approverRole.RoleOfferAsk> = {},
    where: { tels?: string[]; creds?: string[] } = {}
  ) => ({
    id: 'r1',
    content: {
      state: 'accepted',
      acceptedAs: JORDAN,
      connectionId: 'c1',
      guardian: {
        approver: JORDAN,
        evidence: { guardianSaid: 'G', holder: 'H', kels: [said], tels: where.tels ?? [], creds: where.creds ?? [] },
        receivedAt: '2026-11-12T00:00:00Z',
        verdict: { ok: false, reason: 'revoked', detail: '', checkedAt: '' },
      },
      ...over,
    },
  })
  const agentWith = (records: unknown[]) =>
    ({ genericRecords: { findAllByQuery: jest.fn(async () => records) } }) as never

  test('guardianTestStates: the K0 root is marked test (control: the same root unmarked has no entry)', async () => {
    const records = [recordWith(`kel of ${K0_TEST_ROOT.aid}`)]
    expect(await guardianEvidence.guardianTestStates(agentWith(records))).toEqual({ [JORDAN]: true })
    // The mark is the list entry's own: unmarked, the same card is still a demo state's, but not a test one.
    jest.spyOn(stateRoots, 'trustedStateRoots').mockReturnValue([{ ...K0_TEST_ROOT, test: undefined }])
    expect(await guardianEvidence.guardianTestStates(agentWith(records))).toEqual({})
    expect(await guardianEvidence.guardianDemoStates(agentWith(records))).toEqual({ [JORDAN]: K0_TEST_ROOT.name })
  })

  test('a card naming the K0 root reads as its name (control: a card naming no listed root has no entry)', async () => {
    expect(await guardianEvidence.guardianDemoStates(agentWith([recordWith(`kel of ${K0_TEST_ROOT.aid}`)]))).toEqual({
      [JORDAN]: K0_TEST_ROOT.name,
    })
    expect(await guardianEvidence.guardianDemoStates(agentWith([recordWith('kel of some other root')]))).toEqual({})
  })

  test('the name is never read from the card: a card that only says "State of Utah" has no entry', async () => {
    expect(await guardianEvidence.guardianDemoStates(agentWith([recordWith('issued by State of Utah')]))).toEqual({})
  })

  // ac, 11-12: a demo root's AID named only in a non-anchoring place (a reference inside a credential or a registry,
  // while the card's KELs are another root's) gives no name. The limit, documented: this is presence in a carried KEL,
  // not anchoring (control: the same AID in a KEL names it).
  test.each([
    ['a credential', { creds: [`{"ri":"${K0_TEST_ROOT.aid}"}`] }],
    ['a registry', { tels: [`ref ${K0_TEST_ROOT.aid}`] }],
  ])(
    "the demo root's AID only in %s, KELs of another root: no entry (control: in a KEL, its name)",
    async (_, where) => {
      const elsewhere = recordWith('kel of some other root', {}, where)
      expect(await guardianEvidence.guardianDemoStates(agentWith([elsewhere]))).toEqual({})
      const inKel = recordWith(`kel of ${K0_TEST_ROOT.aid}`, {}, where)
      expect(await guardianEvidence.guardianDemoStates(agentWith([inKel]))).toEqual({ [JORDAN]: K0_TEST_ROOT.name })
    }
  )

  test('empty with state-verified approvers off (control: on, above)', async () => {
    setStateVerifiedApproversEnabled(false)
    expect(await guardianEvidence.guardianDemoStates(agentWith([recordWith(`kel of ${K0_TEST_ROOT.aid}`)]))).toEqual({})
  })
})

describe('Who approves: the K0 preload reads "Test", never "Demo" or "State of Utah" (Alberto, 2026-11-13)', () => {
  const VERIFIED_TEST: GuardianStanding = { kind: 'verified', state: K0_TEST_ROOT.name, demo: true, test: true }

  test('verified K0: the box is "Example State" with the Test label and the test words (control: a demo root reads Demo)', async () => {
    const tree = await show(VERIFIED_TEST)
    const box = tree.getByTestId(id(Ids.stateBox(JORDAN)))
    expect(within(box).getByText('Example State')).toBeTruthy()
    expect(within(box).getByText('Approver.TestPill')).toBeTruthy()
    expect(within(box).getByText('Approver.TestStateIs')).toBeTruthy()
    expect(within(box).queryByText('Approver.DemoPill')).toBeNull()
    expect(tree.queryByText(/State of Utah/)).toBeNull()
    const demo = await show(VERIFIED_DEMO)
    const demoBox = demo.getByTestId(id(Ids.stateBox(JORDAN)))
    expect(within(demoBox).getByText('Approver.DemoPill')).toBeTruthy()
    expect(within(demoBox).getByText('Approver.DemoStateIs')).toBeTruthy()
    expect(within(demoBox).queryByText('Approver.TestPill')).toBeNull()
  })

  test.each([
    ['unreachable', { kind: 'unreachable', state: K0_TEST_ROOT.name } as GuardianStanding, 'Approver.TestStateIs'],
    ['revoked', REVOKED('revoked'), 'Approver.TestStateRevoked'],
  ] as const)(
    '%s K0: the list entry marks it test, so the box says Test (control: unmarked, Demo)',
    async (_, standing, words) => {
      const tests = jest.spyOn(guardianEvidence, 'guardianTestStates').mockResolvedValue({ [JORDAN]: true })
      const tree = await show(standing, K0_TEST_ROOT.name)
      const box = tree.getByTestId(id(Ids.stateBox(JORDAN)))
      expect(within(box).getByText('Approver.TestPill')).toBeTruthy()
      expect(within(box).getByText(words)).toBeTruthy()
      expect(tree.queryByText(/State of Utah/)).toBeNull()
      tests.mockResolvedValue({})
      const unmarked = await show(standing, K0_TEST_ROOT.name)
      const plain = unmarked.getByTestId(id(Ids.stateBox(JORDAN)))
      expect(within(plain).getByText('Approver.DemoPill')).toBeTruthy()
      expect(within(plain).queryByText('Approver.TestPill')).toBeNull()
    }
  )
})

describe("Who approves: why a card didn't check out, in plain words (Alberto's hand run, 2026-11-13)", () => {
  const outcomeLine = (tree: Tree) => tree.getByTestId(id(Ids.guardianOutcome(JORDAN))).props.children

  test('noWard: what went wrong and what to do, never "Details: noWard" (control: wardMismatch has its own words)', async () => {
    const tree = await show({ kind: 'unverified', outcome: 'noWard' })
    expect(tree.getByTestId(id(Ids.guardianUnverified(JORDAN)))).toBeTruthy()
    expect(outcomeLine(tree)).toBe('Approver.Reason.noWard Approver.ReasonDo.noWard')
    expect(tree.queryByText(/GuardianOutcome/)).toBeNull()
    tree.unmount()
    const other = await show({ kind: 'unverified', outcome: 'wardMismatch' })
    expect(outcomeLine(other)).toBe('Approver.Reason.wardMismatch Approver.ReasonDo.wardMismatch')
  })

  test('a chain refusal reads in its group: kelNotReplaying is "damaged" (control: expired is its own)', async () => {
    const tree = await show({ kind: 'unverified', outcome: 'kelNotReplaying' })
    expect(outcomeLine(tree)).toBe('Approver.Reason.damaged Approver.ReasonDo.damaged')
    tree.unmount()
    const expired = await show({ kind: 'unverified', outcome: 'expired' })
    expect(outcomeLine(expired)).toBe('Approver.Reason.expired Approver.ReasonDo.expired')
  })

  test('a code this phone does not know gets the general words, never the code (control: a known code, above)', async () => {
    const tree = await show({ kind: 'unverified', outcome: 'someNewReason' })
    expect(outcomeLine(tree)).toBe('Approver.Reason.other Approver.ReasonDo.other')
    expect(tree.queryByText(/someNewReason/)).toBeNull()
  })

  test("an authorization that didn't check out says why the same way (control: authorized has no such line)", async () => {
    standings.mockResolvedValue({
      cards: { [JORDAN]: VERIFIED_DEMO },
      social: { [JORDAN]: { kind: 'refused', outcome: 'notThisCard' } },
    })
    demos.mockResolvedValue({})
    const tree = render(
      <BasicAppContext>
        <VtaTrustedApprovers />
      </BasicAppContext>
    )
    await act(async () => undefined)
    expect(tree.getByTestId(id(Ids.socialRefused(JORDAN)))).toBeTruthy()
    expect(tree.getByText('Approver.Reason.damaged Approver.ReasonDo.damaged')).toBeTruthy()
    tree.unmount()
    standings.mockResolvedValue({
      cards: { [JORDAN]: VERIFIED_DEMO },
      social: { [JORDAN]: { kind: 'authorized', state: UTAH } },
    })
    const ok = render(
      <BasicAppContext>
        <VtaTrustedApprovers />
      </BasicAppContext>
    )
    await act(async () => undefined)
    expect(ok.queryByTestId(id(Ids.socialRefused(JORDAN)))).toBeNull()
    expect(ok.queryByText(/Approver\.Reason\./)).toBeNull()
  })
})
