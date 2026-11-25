/**
 * The state card in Credentials (SEDI/KERI holder card), through the list itself: shown only with "State card (demo)"
 * on and a card held, hidden by its switch, its remote off and the SEDI/KERI one; the details it opens re-check the
 * switch at render; and the chain check runs once for a card, not on every render.
 *
 * The real K0 card, the real verifier and the real switches; the agent is the package's mock, holding the K0 card
 * where heldGuardianEvidence reads it.
 */
import { useCredentials, useAgent } from '@bifold/react-hooks'
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native'
import { readFileSync } from 'fs'
import { join } from 'path'
import React from 'react'

import { BasicAppContext } from '../../../../../__tests__/helpers/app'
import ListCredentials from '../../../../screens/ListCredentials'
import { testIdWithKey } from '../../../../utils/testable'
import * as guardianEvidence from '../../../trust-tasks/guardianEvidence'
import { SEDI_KERI_REMOTE_OFF } from '../../../trust-tasks/module/sediKeriRemoteOff'
import { setStateVerifiedApproversEnabled } from '../../../trust-tasks/module/stateVerifiedApproversFlag'
import { setTrustTestStateEnabled } from '../../../trust-tasks/module/trustTestStateFlag'
import { setTrustedApproversEnabled } from '../../../trust-tasks/module/trustedApproversFlag'
import { K0_REVOKED_OMITTED_CARD } from '../../guardian/k0RevokedOmittedCard'
import { K0_TEST_GUARDIAN_CARD } from '../../guardian/k0TestCard'
import { K0_TEST_ROOT } from '../../guardian/stateRoots'
import { setDemoStateHost } from '../../webs/demoStateHost'
import { setRootKelResolver, type RootKel } from '../../webs/rootKel'
import StateCardDetails from '../StateCardDetails'
import StateCardPass from '../StateCardPass'
import { stateCardView } from '../stateCard'
import { useHeldStateCard } from '../useHeldStateCard'
import { STATE_CARD_REMOTE_OFF, setStateCardEnabled } from '../stateCardFlag'

jest.mock('react-native-localize', () => {})
jest.mock('@bifold/credo-tsp-adapter', () => ({}))
const mockUseOpenId = jest.fn()
jest.mock('../../../openid/context/OpenIDCredentialRecordProvider', () => ({
  ...jest.requireActual('../../../openid/context/OpenIDCredentialRecordProvider'),
  useOpenIDCredentials: () => mockUseOpenId(),
}))

const id = testIdWithKey
const agent = (useAgent as jest.Mock)().agent as { genericRecords: { findAllByQuery: jest.Mock } }
const realQuery = agent.genericRecords.findAllByQuery.getMockImplementation()
const heldQueries = () =>
  agent.genericRecords.findAllByQuery.mock.calls.filter(
    ([q]) => (q as { recordType?: string })?.recordType === guardianEvidence.GUARDIAN_EVIDENCE_HELD
  ).length

/** The phone holds the K0 card (as "Hold the test Guardian card (K0)" leaves it), another card, or nothing. */
function holds(held: boolean, card: object = K0_TEST_GUARDIAN_CARD) {
  agent.genericRecords.findAllByQuery.mockImplementation(async (query: { recordType?: string }) =>
    held && query?.recordType === guardianEvidence.GUARDIAN_EVIDENCE_HELD
      ? [{ content: { ...card, heldAt: '2026-11-11T00:00:00Z' } }]
      : []
  )
}
const screen = () => (
  <BasicAppContext>
    <ListCredentials />
  </BasicAppContext>
)
/** Let the held-card read and the check's promises run (the check is asynchronous). */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0))
  })
async function wallet() {
  const tree = render(screen())
  await settle()
  return tree
}

/** The K0 root's KEL as its demo host serves it (the fixture #1038's rows read). */
const servedKel = () =>
  new Uint8Array(
    readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '__tests__',
        'fixtures',
        'webs-k0-root',
        'example.org',
        'keyring-demo-state',
        K0_TEST_ROOT.aid,
        'keri.cesr'
      )
    )
  )
const SERVED: () => RootKel = () => ({ ok: true, aid: K0_TEST_ROOT.aid, kel: servedKel() })
/** The KEL the demo host serves for an AID of the K0 chain (the root, the org unit or the issuing agent). */
const chainKel = (aid: string) =>
  new Uint8Array(
    readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '__tests__',
        'fixtures',
        'webs-k0-root',
        'example.org',
        'keyring-demo-state',
        aid,
        'keri.cesr'
      )
    )
  )
/** A live state that answers only when a row says so: each fetch waits on its own answer. */
function stateAnswersLater() {
  const waiting: ((r: RootKel) => void)[] = []
  const resolver = jest.fn(() => new Promise<RootKel>((resolve) => waiting.push(resolve)))
  setDemoStateHost('example.org')
  // Only the ROOT's fetch waits on the row (and is counted); a demo root's chain issuers, which the check also fetches
  // (sedi/webs README), answer at once with the KEL the host publishes for them. Test isolation only.
  setRootKelResolver((did: string) => {
    const aid = did.slice(did.lastIndexOf(':') + 1)
    return aid === K0_TEST_ROOT.aid ? resolver() : Promise.resolve({ ok: true as const, aid, kel: chainKel(aid) })
  })
  return { resolver, answer: (i: number, r: RootKel) => waiting[i](r) }
}
const shown = (tree: ReturnType<typeof render>) => tree.queryByTestId(id('StateCard')) !== null

beforeEach(() => {
  // As after a restart: no row inherits a kept live result (sedi/webs/lastLive), whatever order the rows run in.
  guardianEvidence.resetGuardianCheckMemo()
  mockUseOpenId.mockReturnValue({
    openIdState: { w3cCredentialRecords: [], sdJwtVcRecords: [], mdocVcRecords: [], isLoading: false },
  })
  ;(useCredentials as jest.Mock).mockReturnValue({ records: [], loading: false })
  agent.genericRecords.findAllByQuery.mockClear()
  setTrustedApproversEnabled(true)
  setStateVerifiedApproversEnabled(true)
  setTrustTestStateEnabled(true)
  setStateCardEnabled(true)
  holds(true)
})
// No row may reach the network: the platform fetch refuses unless a row puts a resolver in place.
const realFetch = global.fetch
beforeEach(() => {
  global.fetch = jest.fn(async () => {
    throw new Error('no network in tests')
  }) as never
})
afterEach(() => {
  global.fetch = realFetch
  jest.restoreAllMocks()
  setRootKelResolver(null)
  setDemoStateHost(null)
  agent.genericRecords.findAllByQuery.mockImplementation(realQuery)
  setStateCardEnabled(false)
  STATE_CARD_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
  setTrustedApproversEnabled(false)
  setStateVerifiedApproversEnabled(false)
  setTrustTestStateEnabled(false)
})

describe('the state card in Credentials', () => {
  test('switched on, a card held: the card shows, and "no credentials" does not', async () => {
    const tree = await wallet()
    expect(shown(tree)).toBe(true)
    expect(tree.getByTestId(id('CommunityPassTitle')).props.children).toBe(K0_TEST_ROOT.name)
    expect(tree.getByTestId(id('CommunityPassLapsing')).props.children).toBe('StateCard.Test')
    expect(tree.queryByText('Credentials.EmptyList')).toBeNull()
  })

  test('switched on, nothing held: no card, and the list says it is empty (control above: held, shown)', async () => {
    holds(false)
    const tree = await wallet()
    expect(shown(tree)).toBe(false)
    expect(tree.getByText('Credentials.EmptyList')).toBeTruthy()
  })

  test.each([
    ['switched off', () => setStateCardEnabled(false)],
    ['its remote off', () => (STATE_CARD_REMOTE_OFF.off = true)],
    ['the SEDI/KERI remote off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
  ])('%s: no card, the held card not even read, and the list says it is empty (control: on, shown)', async (_, off) => {
    const control = await wallet()
    expect(shown(control)).toBe(true)
    control.unmount()
    agent.genericRecords.findAllByQuery.mockClear()

    off()
    const tree = await wallet()
    expect(shown(tree)).toBe(false)
    expect(heldQueries()).toBe(0)
    expect(tree.getByText('Credentials.EmptyList')).toBeTruthy()
  })

  test.each([
    ['its remote off', () => (STATE_CARD_REMOTE_OFF.off = true)],
    ['the SEDI/KERI remote off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
  ])('%s while the card is on screen: gone on the next render', async (_, off) => {
    const tree = await wallet()
    expect(shown(tree)).toBe(true)
    off()
    tree.rerender(screen())
    expect(shown(tree)).toBe(false)
    expect(tree.getByText('Credentials.EmptyList')).toBeTruthy()
  })

  test('pressed, its details open: the status, what was checked, the demo line, and Technical details', async () => {
    const tree = await wallet()
    fireEvent.press(tree.getByTestId(id('CommunityPass')))
    await waitFor(() => expect(tree.getByTestId(id('StateCardDetails'))).toBeTruthy())
    expect(tree.getByTestId(id('StateCardStatus')).props.children).toBe('StateCard.ChecksOut')
    expect(tree.getByTestId(id('StateCardWhatChecked'))).toBeTruthy()
    expect(tree.getByTestId(id('StateCardDemoNote')).props.children).toBe('StateCard.TestNote')
    expect(tree.queryByTestId(id('StateCardTechnicalRows'))).toBeNull()
    fireEvent.press(tree.getByTestId(id('StateCardTechnical')))
    const rows = tree.getByTestId(id('StateCardTechnicalRows'))
    for (const value of [K0_TEST_GUARDIAN_CARD.holder, K0_TEST_GUARDIAN_CARD.guardianSaid, 'valid'])
      expect(tree.getAllByText(value).length).toBeGreaterThan(0)
    expect(rows).toBeTruthy()
    fireEvent.press(tree.getByTestId(id('StateCardClose')))
    await waitFor(() => expect(tree.queryByTestId(id('StateCardDetails'))).toBeNull())
  })

  test('details open, then the remote off: the details go on the next render, not only the card', async () => {
    const tree = await wallet()
    fireEvent.press(tree.getByTestId(id('CommunityPass')))
    await waitFor(() => expect(tree.getByTestId(id('StateCardDetails'))).toBeTruthy())
    STATE_CARD_REMOTE_OFF.off = true
    tree.rerender(screen())
    expect(tree.queryByTestId(id('StateCardDetails'))).toBeNull()
  })

  test('not checked here (state-verified approvers off): "Not checked", what to turn on, no "what was checked"', async () => {
    setStateVerifiedApproversEnabled(false)
    const tree = await wallet()
    expect(tree.getByTestId(id('CommunityPassLapsing')).props.children).toBe('StateCard.PillNotChecked')
    fireEvent.press(tree.getByTestId(id('CommunityPass')))
    await waitFor(() => expect(tree.getByTestId(id('StateCardDetails'))).toBeTruthy())
    expect(tree.getByTestId(id('StateCardStatus')).props.children).toBe('StateCard.SetupNeeded')
    expect(tree.queryByTestId(id('StateCardWhatChecked'))).toBeNull()
  })

  test("a root renamed on this phone's list, keeping its AID: the card on screen takes the new name", async () => {
    const tree = await wallet()
    expect(tree.getByTestId(id('CommunityPassTitle')).props.children).toBe(K0_TEST_ROOT.name)
    const name = K0_TEST_ROOT.name
    try {
      ;(K0_TEST_ROOT as { name: string }).name = 'Renamed state'
      tree.rerender(screen())
      // A rename moves the key, so the card is checked again (checking, then the new name).
      await settle()
      expect(tree.getByTestId(id('CommunityPassTitle')).props.children).toBe('Renamed state')
    } finally {
      ;(K0_TEST_ROOT as { name: string }).name = name
    }
  })

  test('checking a live state: a cream "Checking", never "Checks out", until it answers; then where it came from', async () => {
    const state = stateAnswersLater()
    const tree = await wallet()
    expect(tree.getByTestId(id('CommunityPassLapsing')).props.children).toBe('StateCard.PillChecking')
    fireEvent.press(tree.getByTestId(id('CommunityPass')))
    await waitFor(() => expect(tree.getByTestId(id('StateCardDetails'))).toBeTruthy())
    expect(tree.getByTestId(id('StateCardStatus')).props.children).toBe('StateCard.Checking')
    expect(tree.queryByTestId(id('StateCardWhatChecked'))).toBeNull()
    expect(tree.queryByTestId(id('StateCardSource'))).toBeNull()
    state.answer(0, SERVED())
    await settle()
    expect(tree.getByTestId(id('StateCardStatus')).props.children).toBe('StateCard.ChecksOut')
    expect(tree.getByTestId(id('StateCardSource')).props.children).toBe('Approver.GuardianFetchedLive')
    expect(state.resolver).toHaveBeenCalledTimes(1)
  })

  test('the switch turned off while checking: nothing shows, the late answer is dropped, and on again it checks anew', async () => {
    const state = stateAnswersLater()
    const tree = await wallet()
    // Off with no render before the answer (a remote off landing mid-check): the answer is dropped on its way in.
    setStateCardEnabled(false)
    state.answer(0, SERVED())
    await settle()
    tree.rerender(screen())
    expect(shown(tree)).toBe(false)
    setStateCardEnabled(true)
    tree.rerender(screen())
    await settle()
    // Not the dropped answer: a new check, still waiting.
    expect(tree.getByTestId(id('CommunityPassLapsing')).props.children).toBe('StateCard.PillChecking')
    expect(state.resolver).toHaveBeenCalledTimes(2)
  })

  test('the card left the screen while checking: the late answer lands nowhere, and coming back checks anew', async () => {
    const state = stateAnswersLater()
    const errors = jest.spyOn(console, 'error')
    const first = await wallet()
    first.unmount()
    state.answer(0, SERVED())
    await settle()
    expect(errors).not.toHaveBeenCalledWith(expect.stringMatching(/unmounted|not wrapped in act/))
    const again = await wallet()
    expect(again.getByTestId(id('CommunityPassLapsing')).props.children).toBe('StateCard.PillChecking')
    expect(state.resolver).toHaveBeenCalledTimes(2)
  })

  test('a live state that can\'t be reached: its own red "Couldn\'t reach", never "Checks out"', async () => {
    const state = stateAnswersLater()
    const tree = await wallet()
    state.answer(0, { ok: false, reason: 'unreachable', detail: 'offline' })
    await settle()
    expect(tree.getByTestId(id('CommunityPassStatus')).props.children).toBe('StateCard.PillNotReached')
    fireEvent.press(tree.getByTestId(id('CommunityPass')))
    await waitFor(() => expect(tree.getByTestId(id('StateCardDetails'))).toBeTruthy())
    expect(tree.getByTestId(id('StateCardStatus')).props.children).toBe('StateCard.NotReached')
  })

  test('the real card that leaves out its revocation, checked live: a red "Revoked", the issuer\'s record named', async () => {
    holds(true, K0_REVOKED_OMITTED_CARD)
    setDemoStateHost('example.org')
    setRootKelResolver(async (did: string) => {
      const aid = did.slice(did.lastIndexOf(':') + 1)
      return { ok: true as const, aid, kel: chainKel(aid) }
    })
    const tree = await wallet()
    expect(tree.getByTestId(id('CommunityPassStatus')).props.children).toBe('StateCard.PillRevoked')
    fireEvent.press(tree.getByTestId(id('CommunityPass')))
    await waitFor(() => expect(tree.getByTestId(id('StateCardDetails'))).toBeTruthy())
    expect(tree.getByTestId(id('StateCardStatus')).props.children).toBe('StateCard.RevokedIssuer')
    expect(tree.queryByTestId(id('StateCardWhatChecked'))).toBeNull()
  })

  test('the chain is checked once for the card, not on each render of the list', async () => {
    const check = jest.spyOn(guardianEvidence, 'checkGuardianEvidenceResolving')
    const tree = await wallet()
    for (let i = 0; i < 3; i++) tree.rerender(screen())
    expect(shown(tree)).toBe(true)
    expect(check).toHaveBeenCalledTimes(1)
  })
})

describe('the state card’s hook', () => {
  test('an answer that arrives while Credentials is out of focus (still mounted) is kept, and shows on return', async () => {
    const state = stateAnswersLater()
    const hook = renderHook(({ focused }: { focused: boolean }) => useHeldStateCard(focused), {
      initialProps: { focused: true },
    })
    await settle()
    expect(hook.result.current?.tone).toBe('checking')
    hook.rerender({ focused: false })
    state.answer(0, SERVED())
    await settle()
    hook.rerender({ focused: true })
    await settle()
    expect(hook.result.current?.tone).toBe('ok')
    expect(state.resolver).toHaveBeenCalledTimes(1)
  })

  test('a return to Credentials re-reads the card (a new object) but does not check it again', async () => {
    const check = jest.spyOn(guardianEvidence, 'checkGuardianEvidenceResolving')
    const hook = renderHook(({ focused }: { focused: boolean }) => useHeldStateCard(focused), {
      initialProps: { focused: true },
    })
    await settle()
    expect(hook.result.current?.tone).toBe('ok')
    const reads = heldQueries()
    for (const focused of [false, true, false, true]) {
      hook.rerender({ focused })
      await settle()
    }
    // Read again on each return (the control: the card was re-read), checked once.
    expect(heldQueries()).toBe(reads + 2)
    expect(check).toHaveBeenCalledTimes(1)
    expect(hook.result.current?.tone).toBe('ok')
  })
})

describe('the state card’s details, alone', () => {
  const view = () =>
    stateCardView(
      K0_TEST_GUARDIAN_CARD,
      { checked: false, why: 'switchedOff' },
      ((k: string) => k) as never,
      (iso) => iso
    )
  const details = () =>
    render(
      <BasicAppContext>
        <StateCardDetails view={view()} onClose={jest.fn()} />
      </BasicAppContext>
    )

  const pass = () =>
    render(
      <BasicAppContext>
        <StateCardPass view={view()} />
      </BasicAppContext>
    )

  test.each([
    ['switched off', () => setStateCardEnabled(false)],
    ['its remote off', () => (STATE_CARD_REMOTE_OFF.off = true)],
    ['the SEDI/KERI remote off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
  ])('%s: the details and the pass each draw nothing, however reached (control: on, drawn)', (_, off) => {
    expect(details().queryByTestId(id('StateCardDetails'))).not.toBeNull()
    expect(pass().queryByTestId(id('StateCard'))).not.toBeNull()
    off()
    expect(details().queryByTestId(id('StateCardDetails'))).toBeNull()
    expect(pass().queryByTestId(id('StateCard'))).toBeNull()
  })
})
