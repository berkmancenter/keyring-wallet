/**
 * The trusted-approver screens (trusted-approver plan §4), each behind the switch: the contact's "Ask {{name}} to be
 * my approver" row, the offer sheet on the asked phone, and Who approves on My agent. The protocol itself is tested
 * in approverRole.test.ts; here, what each screen calls, with what, and what it says.
 */
import { useFocusEffect } from '@react-navigation/native'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import * as approverRole from '../approverRole'
import { ROLE_ACTIONS } from '../approverRoleSpec'
import ApproverOfferModal, { ApproverOfferIds, resetPutOff } from '../components/ApproverOfferModal'
import { trustedApproversView } from '../module/trustedApprovers'
import { TRUSTED_APPROVERS_REMOTE_OFF, setTrustedApproversEnabled } from '../module/trustedApproversFlag'
import { vtaAgent, type TrustedApproversState } from '../module/vtaAgent'
import { DeviceActionRefused } from '../module/vtaOwner'
import ApproverAskRow, { ApproverAskRowIds } from '../screens/ApproverAskRow'
import VtaTrustedApprovers, { TrustedApproversIds } from '../screens/VtaTrustedApprovers'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const AGENT = {} as never
const SAM_AGENT = 'did:webvh:sams-agent.example'
const JORDAN = 'did:peer:2.jordans-phone'
const AMY = 'did:peer:2.amys-phone'
const CONN = 'c-jordan'

const linked = (vtaDid?: string) => {
  const real = vtaAgent.getState()
  jest.spyOn(vtaAgent, 'getState').mockReturnValue({
    ...real,
    link: vtaDid ? ({ kind: 'linked', vtaDid } as never) : ({ kind: 'unlinked' } as never),
  })
}

const show = async (element: React.ReactElement) => {
  const tree = render(<BasicAppContext>{element}</BasicAppContext>)
  await act(async () => undefined)
  return tree
}

const ask = (over: Partial<approverRole.RoleOfferAsk> = {}): approverRole.RoleOfferAsk => ({
  state: 'open',
  connectionId: CONN,
  threadId: 't-1',
  agentDid: SAM_AGENT,
  actions: [...ROLE_ACTIONS],
  challenge: 'c'.repeat(43),
  askedAt: new Date().toISOString(),
  ...over,
})

beforeEach(() => {
  jest.restoreAllMocks()
  ;(useFocusEffect as jest.Mock).mockImplementation((effect: () => void) => require('react').useEffect(effect, []))
  ;(useAgent as jest.Mock).mockReturnValue({ agent: AGENT })
  TRUSTED_APPROVERS_REMOTE_OFF.off = false
  setTrustedApproversEnabled(true)
  approverRole.roleOfferPromptStore.clear()
  resetPutOff()
})
afterAll(() => setTrustedApproversEnabled(false))

describe("the contact's row", () => {
  test('asks for every action, naming the linked agent, then says it waits', async () => {
    linked(SAM_AGENT)
    const read = jest.spyOn(approverRole, 'roleOfferAskOn').mockResolvedValue(undefined)
    const offer = jest.spyOn(approverRole, 'offerApproverRole').mockResolvedValue('sent')
    const tree = await show(<ApproverAskRow connectionId={CONN} name="Jordan" />)
    expect(tree.getByText('Approver.Ask')).toBeTruthy()

    read.mockResolvedValue(ask())
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(ApproverAskRowIds.ask)))
    })
    expect(offer).toHaveBeenCalledWith(AGENT, CONN, SAM_AGENT, [...ROLE_ACTIONS])
    expect(tree.getByTestId(id(ApproverAskRowIds.status)).props.children).toBe('Approver.Waiting')
    expect(tree.queryByTestId(id(ApproverAskRowIds.ask))).toBeNull()
  })

  test('is not there with the switch off, turned off remotely, or with no linked agent (control: on and linked, it is)', async () => {
    jest.spyOn(approverRole, 'roleOfferAskOn').mockResolvedValue(undefined)
    linked(SAM_AGENT)
    setTrustedApproversEnabled(false)
    expect(
      (await show(<ApproverAskRow connectionId={CONN} name="Jordan" />)).queryByTestId(id(ApproverAskRowIds.row))
    ).toBeNull()
    setTrustedApproversEnabled(true)
    TRUSTED_APPROVERS_REMOTE_OFF.off = true
    expect(
      (await show(<ApproverAskRow connectionId={CONN} name="Jordan" />)).queryByTestId(id(ApproverAskRowIds.row))
    ).toBeNull()
    TRUSTED_APPROVERS_REMOTE_OFF.off = false
    expect(
      (await show(<ApproverAskRow connectionId={CONN} name="Jordan" />)).getByTestId(id(ApproverAskRowIds.row))
    ).toBeTruthy()
    jest.restoreAllMocks()
    jest.spyOn(approverRole, 'roleOfferAskOn').mockResolvedValue(undefined)
    linked(undefined)
    expect(
      (await show(<ApproverAskRow connectionId={CONN} name="Jordan" />)).queryByTestId(id(ApproverAskRowIds.row))
    ).toBeNull()
  })

  test('says a yes waits on My agent, and once written, that they approve', async () => {
    linked(SAM_AGENT)
    jest.spyOn(approverRole, 'roleOfferAskOn').mockResolvedValue(ask({ state: 'accepted', acceptedAs: JORDAN }))
    let tree = await show(<ApproverAskRow connectionId={CONN} name="Jordan" />)
    expect(tree.getByTestId(id(ApproverAskRowIds.status)).props.children).toBe('Approver.SaidYes')
    jest
      .spyOn(approverRole, 'roleOfferAskOn')
      .mockResolvedValue(ask({ state: 'closed', acceptedAs: JORDAN, written: true }))
    tree = await show(<ApproverAskRow connectionId={CONN} name="Jordan" />)
    expect(tree.getByTestId(id(ApproverAskRowIds.status)).props.children).toBe('Approver.IsApprover')
    // Control: closed without writing, the person can ask again.
    jest.spyOn(approverRole, 'roleOfferAskOn').mockResolvedValue(ask({ state: 'closed', acceptedAs: JORDAN }))
    tree = await show(<ApproverAskRow connectionId={CONN} name="Jordan" />)
    expect(tree.getByTestId(id(ApproverAskRowIds.ask))).toBeTruthy()
  })

  test('says so when there is no relationship to ask over, or the ask did not go', async () => {
    linked(SAM_AGENT)
    jest.spyOn(approverRole, 'roleOfferAskOn').mockResolvedValue(undefined)
    const offer = jest.spyOn(approverRole, 'offerApproverRole').mockResolvedValue('noRelationship')
    const tree = await show(<ApproverAskRow connectionId={CONN} name="Jordan" />)
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(ApproverAskRowIds.ask)))
    })
    expect(tree.getByTestId(id(ApproverAskRowIds.error)).props.children).toBe('Approver.NoRelationship')
    offer.mockRejectedValue(new Error('mediator down'))
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(ApproverAskRowIds.ask)))
    })
    expect(tree.getByTestId(id(ApproverAskRowIds.error)).props.children).toBe('Approver.NotSent')
  })
})

describe('the offer sheet', () => {
  const offerFrom = (connectionId = 'c-sam', asker = 'Sam'): approverRole.RoleOfferPrompt => ({
    open: true,
    connectionId,
    asker,
    agentDid: SAM_AGENT,
    actions: ['shareCredential', 'joinCommunity'],
    request: { payload: { challenge: 'c'.repeat(43) } },
    receivedAt: new Date().toISOString(),
  })

  beforeEach(() => {
    jest.spyOn(approverRole, 'restoreRoleOfferPrompts').mockResolvedValue(undefined)
  })

  test('a yes names the DID this phone approves as on its own agent', async () => {
    linked('did:webvh:jordans-agent.example')
    approverRole.roleOfferPromptStore.set(offerFrom())
    jest.spyOn(vtaAgent, 'approverDid').mockResolvedValue(JORDAN)
    const respond = jest.spyOn(approverRole, 'respondToRoleOffer').mockResolvedValue(undefined)
    const tree = await show(<ApproverOfferModal />)
    expect(tree.getByText('Approver.Action.shareCredential', { exact: false })).toBeTruthy()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(ApproverOfferIds.yes)))
    })
    expect(respond).toHaveBeenCalledWith(AGENT, 'c-sam', true, JORDAN)
  })

  test('with no agent of its own, only a no can be sent, and it says why', async () => {
    linked(undefined)
    approverRole.roleOfferPromptStore.set(offerFrom())
    const did = jest.spyOn(vtaAgent, 'approverDid')
    const respond = jest.spyOn(approverRole, 'respondToRoleOffer').mockResolvedValue(undefined)
    const tree = await show(<ApproverOfferModal />)
    expect(tree.getByTestId(id(ApproverOfferIds.needsAgent))).toBeTruthy()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(ApproverOfferIds.yes)))
    })
    expect(respond).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(ApproverOfferIds.no)))
    })
    expect(respond).toHaveBeenCalledWith(AGENT, 'c-sam', false, undefined)
    expect(did).not.toHaveBeenCalled()
  })

  test('an answer that did not go says so and the offer stays', async () => {
    linked('did:webvh:jordans-agent.example')
    approverRole.roleOfferPromptStore.set(offerFrom())
    jest.spyOn(vtaAgent, 'approverDid').mockRejectedValue(new DeviceActionRefused('unreachable'))
    const respond = jest.spyOn(approverRole, 'respondToRoleOffer')
    const tree = await show(<ApproverOfferModal />)
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(ApproverOfferIds.yes)))
    })
    expect(respond).not.toHaveBeenCalled()
    expect(tree.getByTestId(id(ApproverOfferIds.failed))).toBeTruthy()
    expect(tree.getByTestId(id(ApproverOfferIds.sheet))).toBeTruthy()
  })

  test('Not now sends nothing and moves to the next offer', async () => {
    linked('did:webvh:jordans-agent.example')
    approverRole.roleOfferPromptStore.set(offerFrom('c-sam', 'Sam'))
    approverRole.roleOfferPromptStore.set(offerFrom('c-riley', 'Riley'))
    const respond = jest.spyOn(approverRole, 'respondToRoleOffer')
    const tree = await show(<ApproverOfferModal />)
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(ApproverOfferIds.notNow)))
    })
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(ApproverOfferIds.notNow)))
    })
    expect(tree.queryByTestId(id(ApproverOfferIds.sheet))).toBeNull()
    expect(respond).not.toHaveBeenCalled()
  })

  test('an offer on screen goes when the switch is turned off', async () => {
    linked('did:webvh:jordans-agent.example')
    approverRole.roleOfferPromptStore.set(offerFrom())
    const tree = await show(<ApproverOfferModal />)
    expect(tree.getByTestId(id(ApproverOfferIds.sheet))).toBeTruthy()
    setTrustedApproversEnabled(false)
    tree.rerender(
      <BasicAppContext>
        <ApproverOfferModal />
      </BasicAppContext>
    )
    expect(tree.queryByTestId(id(ApproverOfferIds.sheet))).toBeNull()
  })

  test('with the switch off nothing is shown or brought back (control: on, the same offer is shown)', async () => {
    linked('did:webvh:jordans-agent.example')
    approverRole.roleOfferPromptStore.set(offerFrom())
    const restore = jest.spyOn(approverRole, 'restoreRoleOfferPrompts').mockResolvedValue(undefined)
    setTrustedApproversEnabled(false)
    expect((await show(<ApproverOfferModal />)).queryByTestId(id(ApproverOfferIds.sheet))).toBeNull()
    expect(restore).not.toHaveBeenCalled()
    setTrustedApproversEnabled(true)
    expect((await show(<ApproverOfferModal />)).getByTestId(id(ApproverOfferIds.sheet))).toBeTruthy()
    expect(restore).toHaveBeenCalledWith(AGENT)
  })
})

describe('Who approves', () => {
  const held = (approvers: string[], keys: TrustedApproversState['view']['keys'], heldElsewhere: typeof keys = []) =>
    ({ view: { approvers, keys, heldElsewhere }, version: 3 }) as TrustedApproversState

  const kept = (yeses: approverRole.RoleOfferAsk[], names: Record<string, string> = {}) => {
    jest.spyOn(approverRole, 'acceptedRoleOffers').mockResolvedValue(yeses)
    jest.spyOn(approverRole, 'approverNames').mockResolvedValue(names)
    jest.spyOn(approverRole, 'approvingFor').mockResolvedValue([])
  }

  test('adding a yes writes the approver with the offered actions, less one held elsewhere, then closes it as written', async () => {
    kept([ask({ state: 'accepted', acceptedAs: JORDAN, actions: ['shareCredential', 'addDevice'] })], {
      [JORDAN]: 'Jordan',
    })
    jest.spyOn(vtaAgent, 'trustedApprovers').mockResolvedValue(held([], [], ['addDevice']))
    const write = jest
      .spyOn(vtaAgent, 'setTrustedApprovers')
      .mockResolvedValue(held([JORDAN], ['shareCredential'], ['addDevice']))
    const close = jest.spyOn(approverRole, 'closeRoleOffer').mockResolvedValue(undefined)
    const tree = await show(<VtaTrustedApprovers />)
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(TrustedApproversIds.add(CONN))))
    })
    expect(write).toHaveBeenCalledWith(AGENT, [JORDAN], ['shareCredential'])
    expect(close).toHaveBeenCalledWith(AGENT, CONN, true)
    expect(tree.getByTestId(id(TrustedApproversIds.approver(JORDAN)))).toBeTruthy()
  })

  test('a write the agent refused (or Face ID declined) closes nothing and says why (control for the one above)', async () => {
    kept([ask({ state: 'accepted', acceptedAs: JORDAN })])
    jest.spyOn(vtaAgent, 'trustedApprovers').mockResolvedValue(held([], []))
    jest.spyOn(vtaAgent, 'setTrustedApprovers').mockRejectedValue(new DeviceActionRefused('failed', 'no'))
    const close = jest.spyOn(approverRole, 'closeRoleOffer').mockResolvedValue(undefined)
    const tree = await show(<VtaTrustedApprovers />)
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(TrustedApproversIds.add(CONN))))
    })
    expect(close).not.toHaveBeenCalled()
    expect(tree.getByTestId(id(TrustedApproversIds.error))).toBeTruthy()
    expect(tree.getByTestId(id(TrustedApproversIds.add(CONN)))).toBeTruthy()
  })

  test('a write the agent holds for an approval closes nothing: it is not on the agent yet, and it says so', async () => {
    // A held task comes back as a refusal (VtaClient consentPendingOf → awaitingApproval), so the write rejects.
    kept([ask({ state: 'accepted', acceptedAs: JORDAN })])
    jest.spyOn(vtaAgent, 'trustedApprovers').mockResolvedValue(held([AMY], ['shareCredential']))
    jest.spyOn(vtaAgent, 'setTrustedApprovers').mockRejectedValue(new DeviceActionRefused('awaitingApproval'))
    const close = jest.spyOn(approverRole, 'closeRoleOffer').mockResolvedValue(undefined)
    const tree = await show(<VtaTrustedApprovers />)
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(TrustedApproversIds.add(CONN))))
    })
    expect(close).not.toHaveBeenCalled()
    expect(tree.getByTestId(id(TrustedApproversIds.error))).toBeTruthy()
  })

  test('a yes whose every action another rule holds writes no rule naming them, and closes nothing', async () => {
    // nextTrustedRules leaves out what is held elsewhere; with nothing left, the write holds no trusted set at all,
    // so what was written does not name the approver.
    kept([ask({ state: 'accepted', acceptedAs: JORDAN, actions: ['addDevice'] })])
    jest.spyOn(vtaAgent, 'trustedApprovers').mockResolvedValue(held([], [], ['addDevice']))
    const write = jest.spyOn(vtaAgent, 'setTrustedApprovers').mockResolvedValue(held([], [], ['addDevice']))
    const close = jest.spyOn(approverRole, 'closeRoleOffer').mockResolvedValue(undefined)
    const tree = await show(<VtaTrustedApprovers />)
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(TrustedApproversIds.add(CONN))))
    })
    expect(write).toHaveBeenCalledWith(AGENT, [JORDAN], [])
    expect(close).not.toHaveBeenCalled()
  })

  test('removing one writes the others with every action, then marks their yes no longer written', async () => {
    kept([], { [JORDAN]: 'Jordan' })
    jest
      .spyOn(vtaAgent, 'trustedApprovers')
      .mockResolvedValue(held([AMY, JORDAN], ['shareCredential', 'joinCommunity']))
    const write = jest
      .spyOn(vtaAgent, 'setTrustedApprovers')
      .mockResolvedValue(held([AMY], ['shareCredential', 'joinCommunity']))
    const removed = jest.spyOn(approverRole, 'approverRemoved').mockResolvedValue(undefined)
    const tree = await show(<VtaTrustedApprovers />)
    expect(tree.getByText('Jordan')).toBeTruthy()
    expect(tree.getByText('Approver.Unnamed')).toBeTruthy()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(TrustedApproversIds.remove(JORDAN))))
    })
    expect(write).toHaveBeenCalledWith(AGENT, [AMY], ['shareCredential', 'joinCommunity'])
    expect(removed).toHaveBeenCalledWith(AGENT, JORDAN)
    expect(tree.queryByTestId(id(TrustedApproversIds.approver(JORDAN)))).toBeNull()
  })

  test('a removal the agent held for an approval marks nothing: they still approve until it is done', async () => {
    kept([], { [JORDAN]: 'Jordan' })
    jest.spyOn(vtaAgent, 'trustedApprovers').mockResolvedValue(held([AMY, JORDAN], ['shareCredential']))
    jest.spyOn(vtaAgent, 'setTrustedApprovers').mockResolvedValue(held([AMY, JORDAN], ['shareCredential']))
    const removed = jest.spyOn(approverRole, 'approverRemoved').mockResolvedValue(undefined)
    const tree = await show(<VtaTrustedApprovers />)
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(TrustedApproversIds.remove(JORDAN))))
    })
    expect(removed).not.toHaveBeenCalled()
    expect(tree.getByTestId(id(TrustedApproversIds.approver(JORDAN)))).toBeTruthy()
  })

  test('reads the rules as the agent holds them (the real view over an empty row says nobody)', async () => {
    kept([])
    jest
      .spyOn(vtaAgent, 'trustedApprovers')
      .mockResolvedValue({ view: trustedApproversView({ rules: [], sets: {} }), version: 0 })
    const tree = await show(<VtaTrustedApprovers />)
    expect(tree.getByTestId(id(TrustedApproversIds.none))).toBeTruthy()
  })
})
