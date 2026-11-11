/**
 * The state card in Credentials (SEDI/KERI holder card), through the list itself: shown only with "State card (demo)"
 * on and a card held, hidden by its switch, its remote off and the SEDI/KERI one; the details it opens re-check the
 * switch at render; and the chain check runs once for a card, not on every render.
 *
 * The real K0 card, the real verifier and the real switches; the agent is the package's mock, holding the K0 card
 * where heldGuardianEvidence reads it.
 */
import { useCredentials, useAgent } from '@bifold/react-hooks'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../../__tests__/helpers/app'
import ListCredentials from '../../../../screens/ListCredentials'
import { testIdWithKey } from '../../../../utils/testable'
import * as guardianEvidence from '../../../trust-tasks/guardianEvidence'
import { SEDI_KERI_REMOTE_OFF } from '../../../trust-tasks/module/sediKeriRemoteOff'
import { setStateVerifiedApproversEnabled } from '../../../trust-tasks/module/stateVerifiedApproversFlag'
import { setTrustTestStateEnabled } from '../../../trust-tasks/module/trustTestStateFlag'
import { setTrustedApproversEnabled } from '../../../trust-tasks/module/trustedApproversFlag'
import { K0_TEST_GUARDIAN_CARD } from '../../guardian/k0TestCard'
import { K0_TEST_ROOT } from '../../guardian/stateRoots'
import StateCardDetails from '../StateCardDetails'
import StateCardPass from '../StateCardPass'
import { checkHeldCard, stateCardView } from '../stateCard'
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

/** The phone holds the K0 card (as "Hold the test Guardian card (K0)" leaves it), or nothing. */
function holds(held: boolean) {
  agent.genericRecords.findAllByQuery.mockImplementation(async (query: { recordType?: string }) =>
    held && query?.recordType === guardianEvidence.GUARDIAN_EVIDENCE_HELD
      ? [{ content: { ...K0_TEST_GUARDIAN_CARD, heldAt: '2026-11-11T00:00:00Z' } }]
      : []
  )
}
const screen = () => (
  <BasicAppContext>
    <ListCredentials />
  </BasicAppContext>
)
async function wallet() {
  const tree = render(screen())
  await act(async () => undefined)
  return tree
}
const shown = (tree: ReturnType<typeof render>) => tree.queryByTestId(id('StateCard')) !== null

beforeEach(() => {
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
afterEach(() => {
  jest.restoreAllMocks()
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
    expect(tree.getByTestId(id('CommunityPassLapsing')).props.children).toBe('StateCard.Demo')
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
    expect(tree.getByTestId(id('StateCardDemoNote')).props.children).toBe('StateCard.DemoNote')
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
      expect(tree.getByTestId(id('CommunityPassTitle')).props.children).toBe('Renamed state')
    } finally {
      ;(K0_TEST_ROOT as { name: string }).name = name
    }
  })

  test('the chain is checked once for the card, not on each render of the list', async () => {
    const check = jest.spyOn(guardianEvidence, 'checkGuardianEvidence')
    const tree = await wallet()
    for (let i = 0; i < 3; i++) tree.rerender(screen())
    expect(shown(tree)).toBe(true)
    expect(check).toHaveBeenCalledTimes(1)
  })
})

describe('the state card’s details, alone', () => {
  const view = () =>
    stateCardView(
      K0_TEST_GUARDIAN_CARD,
      checkHeldCard(K0_TEST_GUARDIAN_CARD, new Date(), () => undefined),
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
