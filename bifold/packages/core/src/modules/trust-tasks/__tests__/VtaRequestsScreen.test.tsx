/**
 * The Requests screen: only what waits for the person's decision, each
 * request in full with Approve / Decline, and a plain state otherwise —
 * getting them, nothing waiting, can't reach the agent, done.
 */
import { useNavigation } from '@react-navigation/native'
import { act, fireEvent, render, within } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent, type VtiApproval } from '../module/vtaAgent'
import { QUIET_MS } from '../screens/requestsView'
import VtaRequests from '../screens/VtaRequests'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

type Setter = { set(next: Record<string, unknown>): void }
const controller = vtaAgent as unknown as Setter
const id = (key: string) => testIdWithKey(key)

const NOW = new Date('2026-10-02T12:00:00Z')
const DIGEST = 'zQmf5rfwvL4jQpuZwstydtxnz83Be8ZjvVCpVRavEnd1aCJ'
const request = (rid: string, over: Partial<VtiApproval> = {}): VtiApproval =>
  ({
    id: rid,
    challenge: `challenge-${rid}`,
    payloadDigest: rid === 'a' ? DIGEST : `zQmDigest${rid}`,
    requester: 'did:peer:2.Vz6MkrequesterXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    taskType: 'https://trusttasks.org/spec/vta/webvh/dids/create/1.0',
    receivedAt: '2026-10-02T11:59:00Z',
    expiresAt: '2026-10-02T12:05:00Z',
    status: 'pending',
    matchCode: 'f8cc7d',
    ...over,
  }) as VtiApproval

const link = (connection: unknown) => ({
  kind: 'linked',
  vtaDid: 'did:webvh:example:vta',
  label: 'bob',
  linkedAt: '2026-10-01T00:00:00Z',
  connection,
})

describe('Requests', () => {
  let navigation: { navigate: jest.Mock; replace: jest.Mock; goBack: jest.Mock; getState: jest.Mock }
  let decide: jest.SpyInstance

  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(NOW)
    ;(useAgent as jest.Mock).mockReturnValue({ agent: { config: { logger: {} } } })
    navigation = useNavigation() as unknown as typeof navigation
    // A screen of the stack is under this one, as when opened from "Your agent".
    navigation.getState = jest.fn(() => ({ index: 1 }))
    navigation.replace.mockClear()
    navigation.goBack.mockClear()
    controller.set({ link: link({ kind: 'online' }), approvals: [], reconnectGaveUp: false })
    // The controller's own work, stood in for: sending the answer marks the request decided.
    decide = jest.spyOn(vtaAgent, 'decide').mockImplementation(async (rid: string, decision: 'approve' | 'deny') => {
      controller.set({
        approvals: vtaAgent
          .getState()
          .approvals.map((a) => (a.id === rid ? { ...a, status: decision === 'approve' ? 'approved' : 'denied' } : a)),
      })
    })
  })
  afterEach(() => {
    controller.set({ approvals: [], reconnectGaveUp: false })
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  const show = async () => {
    const tree = render(
      <BasicAppContext>
        <VtaRequests />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    return tree
  }

  it('shows a waiting request in full, with no extra tap: what it is, the code to compare, Approve and Decline', async () => {
    controller.set({ approvals: [request('a')] })
    const tree = await show()
    const card = tree.getByTestId(id('AgentApprovalCard'))
    expect(card).toHaveTextContent(/MyAgent\.ApprovalAsks/)
    expect(card).toHaveTextContent(/MyAgent\.ApprovalExpires/)
    expect(card).not.toHaveTextContent(/trusttasks\.org/)
    expect(tree.getByTestId(id('ApprovalMatchCode'))).toHaveTextContent('f8cc7d')
    expect(tree.getByTestId(id('ApproveConsentButton'))).toHaveTextContent('MyAgent.Approve')
    expect(tree.getByTestId(id('DenyConsentButton'))).toHaveTextContent('MyAgent.Deny')
    // Nothing else is said while something waits.
    for (const key of ['RequestsLoading', 'RequestsEmpty', 'RequestsDone', 'RequestsBackToAgent']) {
      expect(tree.queryByTestId(id(key))).toBeNull()
    }
  })

  it('names each card and its buttons by the request’s digest, the code the agent’s own tools print', async () => {
    controller.set({ approvals: [request('a'), request('b')] })
    const tree = await show()
    expect(tree.getAllByTestId(id('AgentApprovalCard'))).toHaveLength(2)
    const mine = within(tree.getByTestId(id(`AgentApprovalCard_${DIGEST}`)))
    expect(mine.getByTestId(id(`ApproveConsentButton_${DIGEST}`))).toBeTruthy()
    expect(mine.getByTestId(id(`DenyConsentButton_${DIGEST}`))).toBeTruthy()
    await act(async () => fireEvent.press(mine.getByTestId(id('ApproveConsentButton'))))
    expect(decide).toHaveBeenCalledWith('a', 'approve')
  })

  it('after approving the only request: says so, offers the way back, and lists it under Earlier', async () => {
    controller.set({ approvals: [request('a')] })
    const tree = await show()
    await act(async () => fireEvent.press(tree.getByTestId(id('ApproveConsentButton'))))
    expect(tree.getByTestId(id('RequestsDone'))).toHaveTextContent(/Requests\.DoneApproved/)
    expect(tree.queryByTestId(id('RequestsMore'))).toBeNull()
    expect(tree.queryByTestId(id('ApproveConsentButton'))).toBeNull()
    const earlier = within(tree.getByTestId(id('RequestsEarlier')))
    expect(earlier.getByTestId(id(`AgentApprovalDecided_${DIGEST}`))).toHaveTextContent('MyAgent.Approved')
    // Decided: what was asked and what was decided, not the advice for deciding.
    expect(earlier.queryByTestId(id('ApprovalMatchCode'))).toBeNull()
    expect(earlier.queryByTestId(id('ApprovalOutcomeUnknown'))).toBeNull()
    expect(earlier.getByTestId(id('AgentApprovalCard'))).toHaveTextContent(/MyAgent\.ApprovalAsks/)
    fireEvent.press(tree.getByTestId(id('RequestsBackToAgent')))
    expect(navigation.goBack).toHaveBeenCalledTimes(1)
  })

  it('after declining: says nothing was done', async () => {
    controller.set({ approvals: [request('a')] })
    const tree = await show()
    await act(async () => fireEvent.press(tree.getByTestId(id('DenyConsentButton'))))
    expect(decide).toHaveBeenCalledWith('a', 'deny')
    expect(tree.getByTestId(id('RequestsDone'))).toHaveTextContent(/Requests\.DoneDeclined/)
  })

  it('after deciding one of two: says so, and that another waits, above it', async () => {
    controller.set({ approvals: [request('a'), request('b')] })
    const tree = await show()
    await act(async () =>
      fireEvent.press(
        within(tree.getByTestId(id(`AgentApprovalCard_${DIGEST}`))).getByTestId(id('ApproveConsentButton'))
      )
    )
    expect(tree.getByTestId(id('RequestsDone'))).toHaveTextContent(/Requests\.DoneApproved/)
    expect(tree.getByTestId(id('RequestsMore'))).toHaveTextContent(/Requests\.More/)
    expect(tree.getAllByTestId(id('ApproveConsentButton'))).toHaveLength(1)
  })

  it('an answer that could not be sent is not called done: the request shows its failure', async () => {
    controller.set({ approvals: [request('a')] })
    decide.mockImplementation(async () => {
      controller.set({ approvals: [request('a', { status: 'failed', error: 'could not send' })] })
      throw new Error('could not send')
    })
    const tree = await show()
    await act(async () => fireEvent.press(tree.getByTestId(id('ApproveConsentButton'))))
    expect(tree.queryByTestId(id('RequestsDone'))).toBeNull()
    expect(tree.getByTestId(id('AgentApprovalDecided'))).toHaveTextContent('could not send')
  })

  it('a request past its expiry says so and has no buttons; it expires on screen with nothing else happening', async () => {
    controller.set({ approvals: [request('a')] })
    const tree = await show()
    expect(tree.getByTestId(id('ApproveConsentButton'))).toBeTruthy()
    await act(async () => {
      jest.advanceTimersByTime(5 * 60 * 1000 + 1000)
    })
    expect(tree.getByTestId(id('RequestExpired'))).toHaveTextContent('Requests.Expired')
    expect(tree.queryByTestId(id('ApprovalMatchCode'))).toBeNull()
    expect(tree.queryByTestId(id('ApproveConsentButton'))).toBeNull()
    expect(tree.queryByTestId(id('DenyConsentButton'))).toBeNull()
    // Not "nothing is waiting": the request that brought the person here is shown.
    expect(tree.queryByTestId(id('RequestsEmpty'))).toBeNull()
    expect(tree.getByTestId(id('RequestsBackToAgent'))).toBeTruthy()
  })

  it('opened with nothing received yet: says it is getting them, then that nothing waits once the agent has been quiet', async () => {
    const tree = await show()
    expect(tree.getByTestId(id('RequestsLoading'))).toHaveTextContent('Requests.Loading')
    expect(tree.queryByTestId(id('RequestsEmpty'))).toBeNull()
    await act(async () => {
      jest.advanceTimersByTime(QUIET_MS + 1000)
    })
    expect(tree.queryByTestId(id('RequestsLoading'))).toBeNull()
    expect(tree.getByTestId(id('RequestsEmpty'))).toHaveTextContent('Requests.Empty')
    expect(tree.getByTestId(id('RequestsBackToAgent'))).toBeTruthy()
  })

  it('a request that arrives after "nothing is waiting" still shows', async () => {
    const tree = await show()
    await act(async () => {
      jest.advanceTimersByTime(QUIET_MS + 1000)
    })
    expect(tree.getByTestId(id('RequestsEmpty'))).toBeTruthy()
    await act(async () => controller.set({ approvals: [request('a', { expiresAt: '2026-10-02T12:30:00Z' })] }))
    expect(tree.queryByTestId(id('RequestsEmpty'))).toBeNull()
    expect(tree.getByTestId(id('ApproveConsentButton'))).toBeTruthy()
  })

  it('while the connection comes up it keeps saying it is getting them, however long', async () => {
    controller.set({ link: link({ kind: 'connecting', since: NOW.getTime() }) })
    const tree = await show()
    await act(async () => {
      jest.advanceTimersByTime(QUIET_MS * 3)
    })
    expect(tree.getByTestId(id('RequestsLoading'))).toBeTruthy()
    // Up now: the quiet time is counted from here.
    await act(async () => controller.set({ link: link({ kind: 'online' }) }))
    await act(async () => {
      jest.advanceTimersByTime(QUIET_MS - 2000)
    })
    expect(tree.getByTestId(id('RequestsLoading'))).toBeTruthy()
    await act(async () => {
      jest.advanceTimersByTime(3000)
    })
    expect(tree.getByTestId(id('RequestsEmpty'))).toBeTruthy()
  })

  it('an agent that cannot be reached is said, with Try again', async () => {
    controller.set({ link: link({ kind: 'offline', since: NOW.getTime() }) })
    const tryAgain = jest.spyOn(vtaAgent, 'tryAgainNow').mockResolvedValue(undefined)
    const tree = await show()
    expect(tree.getByTestId(id('RequestsUnreachable'))).toHaveTextContent(/Requests\.Unreachable/)
    await act(async () => fireEvent.press(tree.getByTestId(id('RequestsTryAgain'))))
    expect(tryAgain).toHaveBeenCalledTimes(1)
  })

  it('a phone not linked to an agent is sent to My Agent', async () => {
    controller.set({ link: { kind: 'notLinked' } })
    await show()
    expect(navigation.replace).toHaveBeenCalledWith(Screens.MyAgent)
  })

  it('opened with nothing under it (a notification), the way back leads to "Your agent"', async () => {
    navigation.getState = jest.fn(() => ({ index: 0 }))
    const tree = await show()
    await act(async () => {
      jest.advanceTimersByTime(QUIET_MS + 1000)
    })
    fireEvent.press(tree.getByTestId(id('RequestsBackToAgent')))
    expect(navigation.goBack).not.toHaveBeenCalled()
    expect(navigation.replace).toHaveBeenCalledWith(Screens.VtaAgent)
  })
})
