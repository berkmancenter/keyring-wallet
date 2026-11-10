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
import ApproverWaitNote, {
  APPROVED_SHOWN_MS,
  ApproverWaitNoteIds,
  NOT_GIVEN_SHOWN_MS,
} from '../screens/ApproverWaitNote'
import * as ownerConfirm from '../module/ownerConfirm'
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
  const press = async (tree: Awaited<ReturnType<typeof show>>, key: string) =>
    act(async () => {
      fireEvent.press(tree.getByTestId(id(key)))
    })

  test('Ask shows the choice first and sends nothing; Send offers every action by default, naming the linked agent, then says it waits', async () => {
    linked(SAM_AGENT)
    const read = jest.spyOn(approverRole, 'roleOfferAskOn').mockResolvedValue(undefined)
    const offer = jest.spyOn(approverRole, 'offerApproverRole').mockResolvedValue('sent')
    const tree = await show(<ApproverAskRow connectionId={CONN} name="Jordan" />)
    expect(tree.getByText('Approver.Ask')).toBeTruthy()

    await press(tree, ApproverAskRowIds.ask)
    expect(offer).not.toHaveBeenCalled()
    expect(tree.getByTestId(id(ApproverAskRowIds.send))).toBeTruthy()

    read.mockResolvedValue(ask())
    await press(tree, ApproverAskRowIds.send)
    expect(offer).toHaveBeenCalledTimes(1)
    expect(offer.mock.calls[0].slice(0, 3)).toEqual([AGENT, CONN, SAM_AGENT])
    expect([...offer.mock.calls[0][3]].sort()).toEqual([...ROLE_ACTIONS].sort())
    expect(tree.getByTestId(id(ApproverAskRowIds.status)).props.children).toBe('Approver.Waiting')
    expect(tree.getByTestId(id(ApproverAskRowIds.asked)).props.children).toHaveLength(ROLE_ACTIONS.length)
    expect(tree.queryByTestId(id(ApproverAskRowIds.ask))).toBeNull()
  })

  test('only the chosen actions are offered, and changing who approves always is (control: the default above offers all)', async () => {
    linked(SAM_AGENT)
    jest.spyOn(approverRole, 'roleOfferAskOn').mockResolvedValue(undefined)
    const offer = jest.spyOn(approverRole, 'offerApproverRole').mockResolvedValue('sent')
    const tree = await show(<ApproverAskRow connectionId={CONN} name="Jordan" />)
    await press(tree, ApproverAskRowIds.ask)
    await press(tree, ApproverAskRowIds.pick('shareCredential'))
    await press(tree, ApproverAskRowIds.pick('addDevice'))
    // Pressing the locked row changes nothing.
    await press(tree, ApproverAskRowIds.pick('changeApprovers'))
    await press(tree, ApproverAskRowIds.send)
    expect([...offer.mock.calls[0][3]].sort()).toEqual(['changeApprovers', 'joinCommunity'])
  })

  test('with only the locked action left, Send is off and nothing goes (control: one chosen, it goes)', async () => {
    linked(SAM_AGENT)
    jest.spyOn(approverRole, 'roleOfferAskOn').mockResolvedValue(undefined)
    const offer = jest.spyOn(approverRole, 'offerApproverRole').mockResolvedValue('sent')
    const tree = await show(<ApproverAskRow connectionId={CONN} name="Jordan" />)
    await press(tree, ApproverAskRowIds.ask)
    for (const action of ['joinCommunity', 'shareCredential', 'addDevice'] as const)
      await press(tree, ApproverAskRowIds.pick(action))
    expect(tree.getByText('Approver.PickOne')).toBeTruthy()
    await press(tree, ApproverAskRowIds.send)
    expect(offer).not.toHaveBeenCalled()
    await press(tree, ApproverAskRowIds.pick('addDevice'))
    await press(tree, ApproverAskRowIds.send)
    expect([...offer.mock.calls[0][3]].sort()).toEqual(['addDevice', 'changeApprovers'])
  })

  test('Cancel closes the choice and sends nothing', async () => {
    linked(SAM_AGENT)
    jest.spyOn(approverRole, 'roleOfferAskOn').mockResolvedValue(undefined)
    const offer = jest.spyOn(approverRole, 'offerApproverRole').mockResolvedValue('sent')
    const tree = await show(<ApproverAskRow connectionId={CONN} name="Jordan" />)
    await press(tree, ApproverAskRowIds.ask)
    await press(tree, ApproverAskRowIds.cancel)
    expect(tree.queryByTestId(id(ApproverAskRowIds.send))).toBeNull()
    expect(tree.getByTestId(id(ApproverAskRowIds.ask))).toBeTruthy()
    expect(offer).not.toHaveBeenCalled()
  })

  test('Ask again re-sends the actions the open offer asked for, not every action', async () => {
    linked(SAM_AGENT)
    jest.spyOn(approverRole, 'roleOfferAskOn').mockResolvedValue(ask({ actions: ['joinCommunity', 'changeApprovers'] }))
    const offer = jest.spyOn(approverRole, 'offerApproverRole').mockResolvedValue('sent')
    const tree = await show(<ApproverAskRow connectionId={CONN} name="Jordan" />)
    expect(tree.getByTestId(id(ApproverAskRowIds.asked)).props.children).toHaveLength(2)
    await press(tree, ApproverAskRowIds.again)
    expect(offer).toHaveBeenCalledWith(AGENT, CONN, SAM_AGENT, ['joinCommunity', 'changeApprovers'])
  })

  test('says when the contact stepped down: before writing, it can be asked again; once written, it says to remove them', async () => {
    linked(SAM_AGENT)
    const read = jest
      .spyOn(approverRole, 'roleOfferAskOn')
      .mockResolvedValue(ask({ state: 'closed', acceptedAs: JORDAN, steppedDown: '2026-11-10T12:00:00Z' }))
    let tree = await show(<ApproverAskRow connectionId={CONN} name="Jordan" />)
    expect(tree.getByTestId(id(ApproverAskRowIds.steppedDown)).props.children).toBe('Approver.SteppedDown')
    expect(tree.getByTestId(id(ApproverAskRowIds.ask))).toBeTruthy()
    read.mockResolvedValue(
      ask({ state: 'closed', acceptedAs: JORDAN, written: true, steppedDown: '2026-11-10T12:00:00Z' })
    )
    tree = await show(<ApproverAskRow connectionId={CONN} name="Jordan" />)
    expect(tree.getByTestId(id(ApproverAskRowIds.steppedDown)).props.children).toBe('Approver.SteppedDownWritten')
    // Control: written and not stepped down, no such line.
    read.mockResolvedValue(ask({ state: 'closed', acceptedAs: JORDAN, written: true }))
    tree = await show(<ApproverAskRow connectionId={CONN} name="Jordan" />)
    expect(tree.queryByTestId(id(ApproverAskRowIds.steppedDown))).toBeNull()
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
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(ApproverAskRowIds.send)))
    })
    expect(tree.getByTestId(id(ApproverAskRowIds.error)).props.children).toBe('Approver.NoRelationship')
    offer.mockRejectedValue(new Error('mediator down'))
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(ApproverAskRowIds.send)))
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

  /** The app's owner check (Face ID, a fingerprint or the passcode), answering as given; the real one runs it. */
  const owner = (answer: { ok: true } | { ok: false; reason: 'cancelled' | 'unavailable' }) => {
    const confirmOwner = jest.fn(async () => answer as never)
    vtaAgent.setOwnerChecks({ confirmOwner, deviceCanOwn: async () => true })
    return confirmOwner
  }

  beforeEach(() => {
    jest.spyOn(approverRole, 'restoreRoleOfferPrompts').mockResolvedValue(undefined)
  })

  test("the sheet names the person's own lock, not always Face ID (control: the unknown fallback)", async () => {
    // The shared stub drops a key's values; this one shows them, so the lock word that reaches the line is visible.
    const words = (key: string, opts?: { method?: string }) => (opts?.method ? `${key}|${opts.method}` : key)
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- the mapped mock module itself, not a namespace copy
    const i18nMock = require('react-i18next')
    jest.spyOn(i18nMock, 'useTranslation').mockReturnValue({ t: words, i18n: { language: 'en' } } as never)
    approverRole.roleOfferPromptStore.set(offerFrom())
    const lock = jest.spyOn(ownerConfirm, 'ownerLockKind').mockResolvedValue('fingerprint')
    const tree = await show(<ApproverOfferModal />)
    expect(tree.getByTestId(id(ApproverOfferIds.faceId)).props.children).toBe(
      'Approver.AcceptAsksLock|CreateAgent.Lock.fingerprint'
    )
    tree.unmount()
    lock.mockResolvedValue('unknown')
    const other = await show(<ApproverOfferModal />)
    expect(other.getByTestId(id(ApproverOfferIds.faceId)).props.children).toBe(
      'Approver.AcceptAsksLock|CreateAgent.Lock.unknown'
    )
  })

  test('Accept asks Face ID first, with its reason, then names the DID this phone approves as on its own agent', async () => {
    linked('did:webvh:jordans-agent.example')
    approverRole.roleOfferPromptStore.set(offerFrom())
    const confirm = owner({ ok: true })
    jest.spyOn(vtaAgent, 'approverDid').mockResolvedValue(JORDAN)
    const respond = jest.spyOn(approverRole, 'respondToRoleOffer').mockResolvedValue(undefined)
    const tree = await show(<ApproverOfferModal />)
    expect(tree.getByText('Approver.Action.shareCredential', { exact: false })).toBeTruthy()
    expect(tree.getByTestId(id(ApproverOfferIds.faceId)).props.children).toBe('Approver.AcceptAsksLock')
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(ApproverOfferIds.yes)))
    })
    expect(confirm).toHaveBeenCalledWith('Approver.AcceptReason')
    expect(respond).toHaveBeenCalledWith(AGENT, 'c-sam', true, JORDAN)
  })

  test('not confirmed at Face ID, nothing is read or sent and the offer stays; cancelling is not an error (control: the one above)', async () => {
    linked('did:webvh:jordans-agent.example')
    approverRole.roleOfferPromptStore.set(offerFrom())
    const did = jest.spyOn(vtaAgent, 'approverDid').mockResolvedValue(JORDAN)
    const respond = jest.spyOn(approverRole, 'respondToRoleOffer').mockResolvedValue(undefined)
    owner({ ok: false, reason: 'cancelled' })
    const tree = await show(<ApproverOfferModal />)
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(ApproverOfferIds.yes)))
    })
    expect(did).not.toHaveBeenCalled()
    expect(respond).not.toHaveBeenCalled()
    expect(tree.getByTestId(id(ApproverOfferIds.sheet))).toBeTruthy()
    expect(tree.queryByTestId(id(ApproverOfferIds.failed))).toBeNull()
    // A check that could not run is said, and still sends nothing.
    owner({ ok: false, reason: 'unavailable' })
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(ApproverOfferIds.yes)))
    })
    expect(respond).not.toHaveBeenCalled()
    expect(tree.getByTestId(id(ApproverOfferIds.failed))).toBeTruthy()
  })

  test('Decline and Not now ask no Face ID', async () => {
    linked('did:webvh:jordans-agent.example')
    approverRole.roleOfferPromptStore.set(offerFrom('c-sam', 'Sam'))
    approverRole.roleOfferPromptStore.set(offerFrom('c-riley', 'Riley'))
    const confirm = owner({ ok: true })
    const respond = jest.spyOn(approverRole, 'respondToRoleOffer').mockResolvedValue(undefined)
    const tree = await show(<ApproverOfferModal />)
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(ApproverOfferIds.notNow)))
    })
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(ApproverOfferIds.no)))
    })
    expect(respond).toHaveBeenCalledWith(AGENT, 'c-riley', false, undefined)
    expect(confirm).not.toHaveBeenCalled()
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
    owner({ ok: true })
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

describe('People I approve for: stepping down', () => {
  const SAM_CONN = 'c-sam'
  const approving = (): approverRole.RoleOfferPrompt => ({
    open: false,
    connectionId: SAM_CONN,
    asker: 'Sam',
    agentDid: SAM_AGENT,
    actions: ['joinCommunity', 'changeApprovers'],
    request: {},
    receivedAt: '2026-11-09T10:00:00Z',
    answered: 'accepted',
    answeredAs: JORDAN,
  })
  const kept = () => {
    jest.spyOn(approverRole, 'acceptedRoleOffers').mockResolvedValue([])
    jest.spyOn(approverRole, 'approverNames').mockResolvedValue({})
    jest.spyOn(approverRole, 'approvingFor').mockResolvedValue([approving()])
    jest.spyOn(vtaAgent, 'trustedApprovers').mockResolvedValue({
      view: { approvers: [], keys: [], heldElsewhere: [] },
      version: 0,
    } as TrustedApproversState)
  }
  const press = async (tree: Awaited<ReturnType<typeof show>>, key: string) =>
    act(async () => {
      fireEvent.press(tree.getByTestId(id(key)))
    })

  test('Step down asks first and sends nothing; confirming sends it for that contact', async () => {
    kept()
    const step = jest.spyOn(approverRole, 'stepDownAsApprover').mockResolvedValue('sent')
    const tree = await show(<VtaTrustedApprovers />)
    await press(tree, TrustedApproversIds.stepDown(SAM_CONN))
    expect(step).not.toHaveBeenCalled()
    expect(tree.getByText('Approver.StepDownConfirmTitle')).toBeTruthy()
    await press(tree, TrustedApproversIds.stepDownConfirm(SAM_CONN))
    expect(step).toHaveBeenCalledWith(AGENT, SAM_CONN)
    expect(tree.queryByTestId(id(TrustedApproversIds.stepDownConfirm(SAM_CONN)))).toBeNull()
  })

  test('Cancel sends nothing (control for the one above)', async () => {
    kept()
    const step = jest.spyOn(approverRole, 'stepDownAsApprover').mockResolvedValue('sent')
    const tree = await show(<VtaTrustedApprovers />)
    await press(tree, TrustedApproversIds.stepDown(SAM_CONN))
    await press(tree, TrustedApproversIds.stepDownCancel(SAM_CONN))
    expect(step).not.toHaveBeenCalled()
    expect(tree.getByTestId(id(TrustedApproversIds.stepDown(SAM_CONN)))).toBeTruthy()
  })

  test('a step-down that did not go says so and keeps the confirmation open to try again', async () => {
    kept()
    jest.spyOn(approverRole, 'stepDownAsApprover').mockRejectedValue(new Error('mediator down'))
    const tree = await show(<VtaTrustedApprovers />)
    await press(tree, TrustedApproversIds.stepDown(SAM_CONN))
    await press(tree, TrustedApproversIds.stepDownConfirm(SAM_CONN))
    expect(tree.getByTestId(id(TrustedApproversIds.stepDownError)).props.children).toBe('Approver.StepDownFailed')
    expect(tree.getByTestId(id(TrustedApproversIds.stepDownConfirm(SAM_CONN)))).toBeTruthy()
  })

  test("on the person's phone, an approver who stepped down says so on their card (control: another approver does not)", async () => {
    jest.spyOn(approverRole, 'acceptedRoleOffers').mockResolvedValue([])
    jest.spyOn(approverRole, 'approverNames').mockResolvedValue({ [JORDAN]: 'Jordan' })
    jest.spyOn(approverRole, 'approvingFor').mockResolvedValue([])
    jest.spyOn(approverRole, 'steppedDownApprovers').mockResolvedValue([JORDAN])
    jest.spyOn(vtaAgent, 'trustedApprovers').mockResolvedValue({
      view: { approvers: [AMY, JORDAN], keys: ['joinCommunity'], heldElsewhere: [] },
      version: 2,
    } as TrustedApproversState)
    const tree = await show(<VtaTrustedApprovers />)
    expect(tree.getByTestId(id(TrustedApproversIds.steppedDown(JORDAN)))).toBeTruthy()
    expect(tree.queryByTestId(id(TrustedApproversIds.steppedDown(AMY)))).toBeNull()
    expect(tree.getByTestId(id(TrustedApproversIds.remove(JORDAN)))).toBeTruthy()
  })

  test('a stepped-down note that cannot be read leaves the rest of the screen as it was', async () => {
    jest.spyOn(approverRole, 'acceptedRoleOffers').mockResolvedValue([ask({ state: 'accepted', acceptedAs: AMY })])
    jest.spyOn(approverRole, 'approverNames').mockResolvedValue({})
    jest.spyOn(approverRole, 'approvingFor').mockResolvedValue([approving()])
    jest.spyOn(approverRole, 'steppedDownApprovers').mockRejectedValue(new Error('store locked'))
    jest.spyOn(vtaAgent, 'trustedApprovers').mockResolvedValue({
      view: { approvers: [], keys: [], heldElsewhere: [] },
      version: 0,
    } as TrustedApproversState)
    const tree = await show(<VtaTrustedApprovers />)
    expect(tree.getByTestId(id(TrustedApproversIds.add(CONN)))).toBeTruthy()
    expect(tree.getByTestId(id(TrustedApproversIds.stepDown(SAM_CONN)))).toBeTruthy()
  })
})

describe('who a held task waits on', () => {
  const PERSONA_MINT = 'https://trusttasks.org/spec/vta/webvh/dids/create/1.2'
  const agentState = (over: Partial<ReturnType<typeof vtaAgent.getState>>) => {
    const real = vtaAgent.getState()
    jest.spyOn(vtaAgent, 'getState').mockReturnValue({ ...real, ...over })
  }

  test("while a task is held and it is the approvers' to approve, it names them and says they may need to open Keyring", async () => {
    agentState({ awaitingConsentFor: PERSONA_MINT })
    const who = jest.spyOn(approverRole, 'approversWaitedOn').mockResolvedValue(['Jordan'])
    const tree = await show(<ApproverWaitNote />)
    expect(who).toHaveBeenCalledWith(AGENT, PERSONA_MINT)
    expect(tree.getByTestId(id(ApproverWaitNoteIds.waiting))).toBeTruthy()
    expect(tree.getByText('Approver.WaitingFor')).toBeTruthy()
    expect(tree.getByTestId(id(ApproverWaitNoteIds.open))).toBeTruthy()
  })

  test('a hold no approver of theirs covers shows nothing (control: the one above)', async () => {
    agentState({ awaitingConsentFor: PERSONA_MINT })
    jest.spyOn(approverRole, 'approversWaitedOn').mockResolvedValue([])
    const tree = await show(<ApproverWaitNote />)
    expect(tree.queryByTestId(id(ApproverWaitNoteIds.waiting))).toBeNull()
  })

  test('with the switch off, or turned off remotely, it shows nothing and asks nothing', async () => {
    agentState({ awaitingConsentFor: PERSONA_MINT })
    const who = jest.spyOn(approverRole, 'approversWaitedOn').mockResolvedValue(['Jordan'])
    setTrustedApproversEnabled(false)
    expect((await show(<ApproverWaitNote />)).queryByTestId(id(ApproverWaitNoteIds.waiting))).toBeNull()
    setTrustedApproversEnabled(true)
    TRUSTED_APPROVERS_REMOTE_OFF.off = true
    expect((await show(<ApproverWaitNote />)).queryByTestId(id(ApproverWaitNoteIds.waiting))).toBeNull()
    expect(who).not.toHaveBeenCalled()
  })

  test("after the agent's grant notice it says who approved, for a while, then nothing, on the note already on screen", async () => {
    jest.useFakeTimers({ now: new Date('2026-11-10T19:00:00Z') })
    try {
      agentState({ awaitingConsentFor: undefined, consentGranted: { taskType: PERSONA_MINT, at: Date.now() } })
      jest.spyOn(approverRole, 'approversWaitedOn').mockResolvedValue(['Jordan'])
      const tree = await show(<ApproverWaitNote />)
      expect(tree.getByTestId(id(ApproverWaitNoteIds.approved))).toBeTruthy()
      expect(tree.queryByTestId(id(ApproverWaitNoteIds.waiting))).toBeNull()
      // Nothing about the agent changes: only the clock moves, and the same mounted note must clear itself.
      await act(async () => {
        jest.advanceTimersByTime(APPROVED_SHOWN_MS - 1000)
      })
      expect(tree.getByTestId(id(ApproverWaitNoteIds.approved))).toBeTruthy()
      await act(async () => {
        jest.advanceTimersByTime(2000)
      })
      expect(tree.queryByTestId(id(ApproverWaitNoteIds.approved))).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  test('a grant notice already older than the window shows nothing when the note mounts', async () => {
    agentState({
      awaitingConsentFor: undefined,
      consentGranted: { taskType: PERSONA_MINT, at: Date.now() - APPROVED_SHOWN_MS - 1000 },
    })
    jest.spyOn(approverRole, 'approversWaitedOn').mockResolvedValue(['Jordan'])
    const tree = await show(<ApproverWaitNote />)
    expect(tree.queryByTestId(id(ApproverWaitNoteIds.approved))).toBeNull()
  })

  test("after the question changed it says they didn't approve and names the action, never that they said no", async () => {
    agentState({ awaitingConsentFor: undefined, consentNotGiven: { taskType: PERSONA_MINT, at: Date.now() } })
    jest.spyOn(approverRole, 'approversWaitedOn').mockResolvedValue(['Jordan'])
    const tree = await show(<ApproverWaitNote />)
    expect(tree.getByTestId(id(ApproverWaitNoteIds.notGiven))).toBeTruthy()
    expect(tree.getByText('Approver.NotGivenBy')).toBeTruthy()
    expect(tree.getByTestId(id(ApproverWaitNoteIds.notGivenAction))).toHaveTextContent('Approver.Action.joinCommunity')
    expect(tree.queryByTestId(id(ApproverWaitNoteIds.approved))).toBeNull()
    expect(tree.queryByTestId(id(ApproverWaitNoteIds.waiting))).toBeNull()
  })

  test('"didn\'t approve" clears on its own, on the note already on screen', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-10T19:00:00Z') })
    try {
      agentState({ awaitingConsentFor: undefined, consentNotGiven: { taskType: PERSONA_MINT, at: Date.now() } })
      jest.spyOn(approverRole, 'approversWaitedOn').mockResolvedValue(['Jordan'])
      const tree = await show(<ApproverWaitNote />)
      expect(tree.getByTestId(id(ApproverWaitNoteIds.notGiven))).toBeTruthy()
      // Only the clock moves; the mounted note must clear itself.
      await act(async () => {
        jest.advanceTimersByTime(NOT_GIVEN_SHOWN_MS - 1000)
      })
      expect(tree.getByTestId(id(ApproverWaitNoteIds.notGiven))).toBeTruthy()
      await act(async () => {
        jest.advanceTimersByTime(2000)
      })
      expect(tree.queryByTestId(id(ApproverWaitNoteIds.notGiven))).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  test('the newer of a yes and a not-given is the one shown; an old not-given is not shown', async () => {
    jest.spyOn(approverRole, 'approversWaitedOn').mockResolvedValue(['Jordan'])
    agentState({
      consentGranted: { taskType: PERSONA_MINT, at: Date.now() - 1000 },
      consentNotGiven: { taskType: PERSONA_MINT, at: Date.now() },
    })
    expect((await show(<ApproverWaitNote />)).getByTestId(id(ApproverWaitNoteIds.notGiven))).toBeTruthy()
    agentState({
      consentGranted: { taskType: PERSONA_MINT, at: Date.now() },
      consentNotGiven: { taskType: PERSONA_MINT, at: Date.now() - 1000 },
    })
    expect((await show(<ApproverWaitNote />)).getByTestId(id(ApproverWaitNoteIds.approved))).toBeTruthy()
    agentState({
      consentGranted: undefined,
      consentNotGiven: { taskType: PERSONA_MINT, at: Date.now() - NOT_GIVEN_SHOWN_MS - 1000 },
    })
    expect((await show(<ApproverWaitNote />)).queryByTestId(id(ApproverWaitNoteIds.notGiven))).toBeNull()
  })
})
