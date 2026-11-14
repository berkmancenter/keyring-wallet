/**
 * The state office's entry points, each gated by itself (ac's standing ask: never a parent-only guard): the
 * keyring://guardian-card link route, the Guardian card screen, the codes screen and its entry row on Who approves.
 * Each is shown with the switches on (the control) and hidden or inert with either switch off and under the SEDI/KERI
 * kill. And the words: the card's host is named for what it is, never "the state's record".
 */
import { useAgent } from '@bifold/react-hooks'
import { useRoute } from '@react-navigation/native'
import { act, render } from '@testing-library/react-native'
import { userEvent } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import en from '../../../localization/en/en.json'
import { testIdWithKey } from '../../../utils/testable'
import { guardianSourceKey } from '../../trust-tasks/guardianEvidence'
import { setSediDemoSide } from '../../trust-tasks/module/sediDemoSide'
import { SEDI_KERI_REMOTE_OFF } from '../../trust-tasks/module/sediKeriRemoteOff'
import { setStateVerifiedApproversEnabled } from '../../trust-tasks/module/stateVerifiedApproversFlag'
import { setTrustedApproversEnabled } from '../../trust-tasks/module/trustedApproversFlag'
import {
  GUARDIAN_CARD_LINK_OFF,
  KeyringLinkError,
  keyringAgentLinkKind,
  routeKeyringAgentLink,
} from '../../trust-tasks/module/vtiLinks'
import { K0_TEST_GUARDIAN_CARD } from '../guardian/k0TestCard'
import * as stateRoots from '../guardian/stateRoots'
import * as controller from '../holder/controller'
import GuardianCardReceive from '../holder/GuardianCardReceive'
import { GuardianCardReceiveIds } from '../holder/GuardianCardReceive.ids'
import * as receive from '../holder/receiveGuardianCard'
import { stateCardView } from '../holder/stateCard'
import StateOfficeCodes, { StateOfficeEntry } from '../identity/StateOfficeCodes'
import { StateOfficeCodesIds } from '../identity/StateOfficeCodes.ids'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const LINK = `keyring://guardian-card?u=${encodeURIComponent('https://example.org/cards/AbCdEfGhIjKlMnOpQrStUv.json')}`
const id = (key: string) => testIdWithKey(key)

const OFF: [string, () => void][] = [
  ['trusted approvers off', () => setTrustedApproversEnabled(false)],
  ['state-verified approvers off', () => setStateVerifiedApproversEnabled(false)],
  ['the SEDI/KERI kill', () => (SEDI_KERI_REMOTE_OFF.off = true)],
]

beforeEach(() => {
  setTrustedApproversEnabled(true)
  setStateVerifiedApproversEnabled(true)
  ;(useAgent as jest.Mock).mockReturnValue({ agent: { genericRecords: {}, kms: {} } })
  ;(useRoute as jest.Mock).mockReturnValue({ params: { link: LINK, scanId: 's1' } })
})
afterEach(() => {
  jest.restoreAllMocks()
  setTrustedApproversEnabled(false)
  setStateVerifiedApproversEnabled(false)
  SEDI_KERI_REMOTE_OFF.off = false
  stateRoots.k1SettingsForTests.reset()
  setSediDemoSide(null)
})

describe('the keyring://guardian-card link', () => {
  it('L01: claimed as ours by its prefix, so it never reaches the connection flow', () => {
    expect(keyringAgentLinkKind(LINK)).toBe('guardianCard')
    expect(keyringAgentLinkKind('keyring://guardian-cards?u=x')).toBeUndefined()
  })

  it('L02: with the switches on, it opens the Guardian card screen with the link (control for L03)', async () => {
    const navigate = jest.fn()
    await routeKeyringAgentLink(LINK, {} as never, navigate)
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ screen: 'GuardianCardReceive', link: LINK }))
  })

  it.each(OFF)('L03: %s: it opens nothing, and says it cannot be used here', async (_, off) => {
    off()
    const navigate = jest.fn()
    await expect(routeKeyringAgentLink(LINK, {} as never, navigate)).rejects.toThrow(
      new KeyringLinkError(GUARDIAN_CARD_LINK_OFF)
    )
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('the Guardian card screen', () => {
  it('S01: on: it checks the card and offers Keep; Keep keeps it (userEvent)', async () => {
    jest.spyOn(receive, 'checkGuardianCard').mockResolvedValue({
      kind: 'checked',
      evidence: K0_TEST_GUARDIAN_CARD,
      state: 'State of Utah',
      ward: 'w',
    })
    const kept = jest
      .spyOn(receive, 'receiveGuardianCard')
      .mockResolvedValue({ kind: 'kept', state: 'State of Utah', ward: 'w' })
    const tree = render(
      <BasicAppContext>
        <GuardianCardReceive />
      </BasicAppContext>
    )
    await act(async () => undefined)
    expect(tree.getByTestId(id(GuardianCardReceiveIds.result)).props.children).toBe('GuardianCard.Checked')
    await userEvent.setup().press(tree.getByTestId(id(GuardianCardReceiveIds.keep)))
    expect(kept).toHaveBeenCalledTimes(1)
    expect(kept.mock.calls[0][1]).toBe('https://example.org/cards/AbCdEfGhIjKlMnOpQrStUv.json')
    expect(tree.getByTestId(id(GuardianCardReceiveIds.kept))).toBeTruthy()
  })

  it.each(OFF)('S02: %s: the screen itself says it is off, and checks and keeps nothing', async (_, off) => {
    off()
    const check = jest.spyOn(receive, 'checkGuardianCard')
    const tree = render(
      <BasicAppContext>
        <GuardianCardReceive />
      </BasicAppContext>
    )
    await act(async () => undefined)
    expect(tree.getByTestId(id(GuardianCardReceiveIds.off))).toBeTruthy()
    expect(tree.queryByTestId(id(GuardianCardReceiveIds.keep))).toBeNull()
    expect(check).not.toHaveBeenCalled()
  })
})

describe('the codes screen and its entry', () => {
  const entry = () =>
    render(
      <BasicAppContext>
        <StateOfficeEntry />
      </BasicAppContext>
    )

  it('C01: on: the entry row shows, and the screen makes the guardian code only when asked (userEvent)', async () => {
    expect(entry().getByTestId(id(StateOfficeCodesIds.entry))).toBeTruthy()
    const make = jest.spyOn(controller, 'holderCodeOf').mockResolvedValue('I' + 'a'.repeat(43))
    const tree = render(
      <BasicAppContext>
        <StateOfficeCodes />
      </BasicAppContext>
    )
    expect(make).not.toHaveBeenCalled()
    await userEvent.setup().press(tree.getByTestId(id(StateOfficeCodesIds.showHolder)))
    expect(make).toHaveBeenCalledTimes(1)
    expect(tree.getByTestId(id(StateOfficeCodesIds.holderCode)).props.children).toBe('I' + 'a'.repeat(43))
  })

  it.each(OFF)('C02: %s: no entry row, and the screen itself is off and makes nothing', async (_, off) => {
    off()
    expect(entry().queryByTestId(id(StateOfficeCodesIds.entry))).toBeNull()
    const make = jest.spyOn(controller, 'holderCodeOf')
    const tree = render(
      <BasicAppContext>
        <StateOfficeCodes />
      </BasicAppContext>
    )
    expect(tree.getByTestId(id(StateOfficeCodesIds.off))).toBeTruthy()
    expect(tree.queryByTestId(id(StateOfficeCodesIds.showHolder))).toBeNull()
    expect(make).not.toHaveBeenCalled()
  })

  it.each([
    ['guardian', true, false],
    ['ward', false, true],
    [null, true, true],
  ] as const)(
    'C04: demo side %s: the guardian code offered %s, the ward code offered %s (none set: both, as before)',
    (side, holder, ward) => {
      setSediDemoSide(side)
      const tree = render(
        <BasicAppContext>
          <StateOfficeCodes />
        </BasicAppContext>
      )
      expect(!!tree.queryByTestId(id(StateOfficeCodesIds.showHolder))).toBe(holder)
      expect(!!tree.queryByTestId(id(StateOfficeCodesIds.showWard))).toBe(ward)
      // The whole group goes, its heading too (the test's t gives the key or the English).
      expect(!!tree.queryByText(new RegExp(`StateOffice.HolderTitle|${en.StateOffice.HolderTitle}`))).toBe(holder)
      expect(!!tree.queryByText(new RegExp(`StateOffice.WardTitle|${en.StateOffice.WardTitle}`))).toBe(ward)
    }
  )

  it('C03: no state office on this build (no K1 root): the entry and the screen are off too', () => {
    stateRoots.k1SettingsForTests.set({ aid: '' })
    expect(entry().queryByTestId(id(StateOfficeCodesIds.entry))).toBeNull()
  })
})

describe('the words for a host that came with the card', () => {
  it("W01: Who approves says the host is one the state names, never the state's record", () => {
    const key = guardianSourceKey({
      kind: 'verified',
      state: 'State of Utah',
      fetchedFrom: 'h.example',
      hostFromCard: true,
    })
    expect(key).toBe('Approver.GuardianFetchedFromCardHost')
    expect(en.Approver.GuardianFetchedFromCardHost).toBe('Fetched live from {{host}}, a host the state names.')
    // Control: without the mark, the live line it always was.
    expect(guardianSourceKey({ kind: 'verified', state: 'S', fetchedFrom: 'h.example', fetchedIssuers: true })).toBe(
      'Approver.GuardianFetchedLive'
    )
  })

  it("W02: the holder's card says the host is one the state names, and its as-of line never says the state's record", () => {
    const t = ((key: string, o?: { host?: string; asOf?: string }) =>
      `${key}${o?.host ? `:${o.host}` : ''}${o?.asOf ? `[${o.asOf}]` : ''}`) as never
    const view = stateCardView(
      K0_TEST_GUARDIAN_CARD,
      {
        checked: true,
        verdict: {
          ok: true,
          root: stateRoots.K0_TEST_ROOT.aid,
          state: 'State of Utah',
          checkedAt: '2026-11-13T00:00:00Z',
          fetchedFrom: 'h.example',
          hostFromCard: true,
        },
      },
      t,
      (iso) => iso
    )
    expect(JSON.stringify(view)).toContain('StateCard.FetchedFromQrHost:h.example')
    expect(JSON.stringify(view)).toContain('StateCard.AsOfQrHost')
    expect(JSON.stringify(view)).not.toContain('StateCard.AsOfPublished')
    expect(en.StateCard.AsOfQrHost).not.toContain("state's published record")
  })

  it('W03: K1 is "State of Utah" with its Demo mark, and its card says the State of Utah did not issue it', () => {
    stateRoots.k1SettingsForTests.reset()
    expect(stateRoots.k1Root()).toMatchObject({ name: 'State of Utah', demo: true })
    // Never the K0 preload's grey "Test" (Alberto, 2026-11-13): K1 keeps "Demo" and the blue card.
    expect(stateRoots.k1Root()?.test).toBeUndefined()
    expect(en.StateCard.DemoNoteOffice).toBe(
      'Demo card, issued by the State of Utah demo office. Not issued by the State of Utah.'
    )
  })
})
