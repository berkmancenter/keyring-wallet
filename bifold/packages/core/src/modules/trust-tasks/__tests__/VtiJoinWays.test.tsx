/**
 * Join, for a community that answers manifest 0.3: the screen lists its ways
 * in and what follows each, and the main button does what the way the phone
 * meets leads to — never "join" where an administrator decides. A 0.2
 * community keeps today's screen (VtiJoinScreen.test.tsx).
 */
import { useNavigation } from '@react-navigation/native'
import { act, fireEvent, render, within } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import type { JoinAsks, JoinWay } from '../module/joinManifest'
import { vtaAgent } from '../module/vtaAgent'
import { VtiRefusal, vtiAgent } from '../module/vtiAgent'
import { communityTarget } from '../module/vtiCommunityLink'
import VtiJoin from '../screens/VtiJoin'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('../../vrc/vrc-biometric', () => ({
  requestBiometricConfirmationWithUI: jest.fn(async () => ({ success: true, reason: 'confirmed' })),
}))
const mockEnsurePersona = jest.fn(async () => ({ did: 'did:webvh:QmPersona:p' }))
const mockReadJoinState = jest.fn(async (): Promise<unknown> => ({ kind: 'none' }))
const mockJoinCommunity = jest.fn(async (): Promise<unknown> => ({ verdict: { effect: 'refer' } }))
jest.mock('../module/vtiJoin', () => ({
  ensurePersonaFor: (...args: unknown[]) => mockEnsurePersona(...(args as [])),
  readJoinState: (...args: unknown[]) => mockReadJoinState(...(args as [])),
  joinCommunity: (...args: unknown[]) => mockJoinCommunity(...(args as [])),
}))
// What the reader makes of the manifest, and what the phone holds: given by each test.
const mockJoinAsks = jest.fn()
jest.mock('../module/joinManifest', () => ({
  ...jest.requireActual('../module/joinManifest'),
  joinAsks: (...args: unknown[]) => mockJoinAsks(...args),
}))
const mockHolds = jest.fn(async () => ({}))
jest.mock('../screens/joinHolds', () => ({ readJoinHolds: (...args: unknown[]) => mockHolds(...(args as [])) }))

type Setter = { set(next: Record<string, unknown>): void }
const community = 'did:webvh:QmSuggested:vtc.suggested.example'
const config = { mediatorDid: 'did:peer:2:mediator', communityDid: community }
const id = (key: string) => testIdWithKey(key)

const way = (over: Partial<JoinWay> & Pick<JoinWay, 'id'>): JoinWay => ({
  admission: 'automatic',
  requires: { invitation: false },
  requiresNothing: false,
  usable: true,
  meets: 'yes',
  digest: `digest-${over.id}`,
  ...over,
})
const invited = way({ id: 'invited', requires: { invitation: true } })
const memberCredential = way({
  id: 'member-credential',
  requires: { invitation: false, credentials: { issuers: 'recognised', types: ['MembershipCredential'] } },
  meets: 'unknown',
})
const review = way({ id: 'review', admission: 'review', requiresNothing: true })
const vetted = way({
  id: 'vetted-member',
  meets: 'no',
  requires: { invitation: false, vetting: { statements: 1, claims: ['name.legal'], methods: [] } },
})
const defaults: JoinAsks = {
  wire: '0.3',
  accepting: true,
  ways: [{ ...invited, meets: 'no' }, memberCredential, review],
  suggested: review,
  outcomeIfMet: 'reviewed',
}

describe('Join, at manifest 0.3', () => {
  let navigation: { navigate: jest.Mock }

  beforeEach(() => {
    jest.useFakeTimers()
    communityTarget.clear()
    mockEnsurePersona.mockClear()
    mockJoinCommunity.mockClear()
    mockReadJoinState.mockImplementation(async () => ({ kind: 'none' }))
    mockHolds.mockImplementation(async () => ({}))
    mockJoinAsks.mockReset()
    jest.spyOn(vtiAgent, 'fetchManifest').mockResolvedValue({ wire: '0.3', criteria: [] } as never)
    ;(useAgent as jest.Mock).mockReturnValue({ agent: { config: { logger: { info: jest.fn(), error: jest.fn() } } } })
    const controller = vtaAgent as unknown as Setter
    controller.set({
      link: {
        kind: 'linked',
        vtaDid: 'did:webvh:example:vta',
        label: 'bob',
        linkedAt: '2026-10-02T00:00:00Z',
        connection: { kind: 'online', since: 0 },
      },
    })
    navigation = useNavigation() as unknown as { navigate: jest.Mock }
    navigation.navigate.mockClear()
  })
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  /** Render, and go on to "what it asks". */
  const toAsks = async (asks: JoinAsks) => {
    mockJoinAsks.mockReturnValue(asks)
    const tree = render(
      <BasicAppContext>
        <VtiJoin config={config} />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    await act(async () => fireEvent.press(tree.getByTestId(id('JoinThisCommunity'))))
    return tree
  }

  it('a new community, a phone holding nothing: its three ways, and "Ask to join"', async () => {
    const tree = await toAsks(defaults)
    expect(tree.getByTestId(id('JoinWaysTitle'))).toHaveTextContent(/Join\.Ways\.Title/)
    expect(tree.getByTestId(id('JoinWays'))).toBeTruthy()
    // Today's card is for a community that states no admission.
    expect(tree.queryByTestId(id('JoinAsks'))).toBeNull()
    expect(tree.getByTestId(id('JoinStart'))).toHaveTextContent(/Join\.Ways\.ButtonAsk/)
    // No vetting way: one button, as before.
    expect(tree.queryByTestId(id('JoinAsk'))).toBeNull()
  })

  it('asking sends a plain request once the identity is made, and never opens vetting', async () => {
    const tree = await toAsks(defaults)
    await act(async () => fireEvent.press(tree.getByTestId(id('JoinStart'))))
    expect(tree.getByTestId(id('JoinMakeIdentity'))).toBeTruthy()
    await act(async () => fireEvent.press(tree.getByTestId(id('JoinAsContinue'))))
    expect(mockJoinCommunity).toHaveBeenCalledTimes(1)
    const [deps, invitation] = mockJoinCommunity.mock.calls[0] as unknown as [Record<string, unknown>, unknown]
    expect(deps).toMatchObject({ communityDid: community, mediatorDid: config.mediatorDid })
    expect(invitation).toBeUndefined()
    expect(navigation.navigate).not.toHaveBeenCalledWith(Screens.VtiVetting)
  })

  it('once asked under review: says an administrator will review it, not that the community "is deciding"', async () => {
    const tree = await toAsks(defaults)
    mockReadJoinState.mockImplementation(async () => ({ kind: 'pending', submission: { withInvitation: false } }))
    await act(async () => fireEvent.press(tree.getByTestId(id('JoinStart'))))
    await act(async () => fireEvent.press(tree.getByTestId(id('JoinAsContinue'))))
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    expect(tree.getByTestId(id('JoinStandingText'))).toHaveTextContent(/Join\.Ways\.SentForReview/)
  })

  it('a phone holding the invitation: "Join", through "I was invited", where the invitation is', async () => {
    mockHolds.mockImplementation(async () => ({ invitation: true }))
    const tree = await toAsks({
      ...defaults,
      ways: [invited, memberCredential, review],
      suggested: invited,
      outcomeIfMet: 'joined',
    })
    expect(tree.getByTestId(id('JoinStart'))).toHaveTextContent(/Join\.Ways\.ButtonJoin/)
    await act(async () => fireEvent.press(tree.getByTestId(id('JoinStart'))))
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.VtiInvited)
    expect(mockJoinCommunity).not.toHaveBeenCalled()
  })

  /**
   * The ordinary vetting community: an invitation way, a vetting way, and a
   * review way that asks nothing — which every phone meets. Vetting must be
   * what the screen leads with; asking is the other door.
   */
  describe('a vetting way beside a review way', () => {
    const vettingCommunity: JoinAsks = {
      wire: '0.3',
      accepting: true,
      ways: [{ ...invited, meets: 'no' }, vetted, review],
      suggested: review,
      outcomeIfMet: 'reviewed',
    }

    it('offers both: "Meet a vetter" first, "Ask to join" beside it, and the vetting row says it can be started', async () => {
      const tree = await toAsks(vettingCommunity)
      expect(tree.getByTestId(id('JoinStart'))).toHaveTextContent(/Join\.Ways\.ButtonVetting/)
      expect(tree.getByTestId(id('JoinAsk'))).toHaveTextContent(/Join\.Ways\.ButtonAsk/)
      expect(tree.getByTestId(id('JoinWayStart_vetted-member'))).toHaveTextContent(/Join\.Ways\.VettingToDo/)
      // What follows each way is still said on its own row.
      expect(tree.getByTestId(id('JoinWayFollows_vetted-member'))).toHaveTextContent('Join.Ways.FollowsAutomatic')
      expect(tree.getByTestId(id('JoinWayFollows_review'))).toHaveTextContent('Join.Ways.FollowsReview')
    })

    it('keeps the fixed button area to the two buttons: "A different community" scrolls with the list', async () => {
      // Three buttons under the list covered the last way's lines on a phone.
      const tree = await toAsks(vettingCommunity)
      const fixed = within(tree.getByTestId(id('JoinActions')))
      expect(fixed.getByTestId(id('JoinStart'))).toBeTruthy()
      expect(fixed.getByTestId(id('JoinAsk'))).toBeTruthy()
      expect(fixed.queryByTestId(id('JoinScanCommunity'))).toBeNull()
      // Still on the screen, and still the way to another community.
      expect(tree.getByTestId(id('JoinScanCommunity'))).toBeTruthy()
    })

    it('"Meet a vetter" makes the identity and opens vetting; no request is sent', async () => {
      const tree = await toAsks(vettingCommunity)
      await act(async () => fireEvent.press(tree.getByTestId(id('JoinStart'))))
      await act(async () => fireEvent.press(tree.getByTestId(id('JoinAsContinue'))))
      expect(mockEnsurePersona).toHaveBeenCalledTimes(1)
      expect(navigation.navigate).toHaveBeenCalledWith(Screens.VtiVetting)
      expect(mockJoinCommunity).not.toHaveBeenCalled()
    })

    it('"Ask to join" sends the plain request, and never opens vetting', async () => {
      const tree = await toAsks(vettingCommunity)
      await act(async () => fireEvent.press(tree.getByTestId(id('JoinAsk'))))
      await act(async () => fireEvent.press(tree.getByTestId(id('JoinAsContinue'))))
      expect(mockJoinCommunity).toHaveBeenCalledTimes(1)
      const [, invitation] = mockJoinCommunity.mock.calls[0] as unknown as [unknown, unknown]
      expect(invitation).toBeUndefined()
      expect(navigation.navigate).not.toHaveBeenCalledWith(Screens.VtiVetting)
    })

    it('having asked once does not turn "Meet a vetter" into a request: each button does its own thing', async () => {
      const tree = await toAsks(vettingCommunity)
      // The ask comes back to the ways (the community changed what it asks).
      mockJoinCommunity.mockRejectedValueOnce(new VtiRefusal('vtc/join-requests/submit:criterionUnknown', 'unknown'))
      await act(async () => fireEvent.press(tree.getByTestId(id('JoinAsk'))))
      await act(async () => fireEvent.press(tree.getByTestId(id('JoinAsContinue'))))
      await act(async () => {
        jest.advanceTimersByTime(10)
      })
      expect(mockJoinCommunity).toHaveBeenCalledTimes(1)
      // Now vetting: the identity and the Vetting screen, and no second request ahead of it.
      await act(async () => fireEvent.press(tree.getByTestId(id('JoinStart'))))
      await act(async () => fireEvent.press(tree.getByTestId(id('JoinAsContinue'))))
      expect(navigation.navigate).toHaveBeenCalledWith(Screens.VtiVetting)
      expect(mockJoinCommunity).toHaveBeenCalledTimes(1)
    })
  })

  it('invitation only, no invitation: no Start; the way to "I was invited"', async () => {
    const tree = await toAsks({ wire: '0.3', accepting: true, ways: [{ ...invited, meets: 'no' }] })
    expect(tree.queryByTestId(id('JoinStart'))).toBeNull()
    await act(async () => fireEvent.press(tree.getByTestId(id('JoinGoInvited'))))
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.VtiInvited)
  })

  it('vetting to do: "Start", then the identity, then vetting, as today', async () => {
    const tree = await toAsks({ wire: '0.3', accepting: true, ways: [vetted] })
    expect(tree.getByTestId(id('JoinStart'))).toHaveTextContent('Join.Start')
    expect(tree.queryByTestId(id('JoinAsk'))).toBeNull()
    await act(async () => fireEvent.press(tree.getByTestId(id('JoinStart'))))
    await act(async () => fireEvent.press(tree.getByTestId(id('JoinAsContinue'))))
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.VtiVetting)
    expect(mockJoinCommunity).not.toHaveBeenCalled()
  })

  it('only a credential way: nothing to press', async () => {
    const tree = await toAsks({ wire: '0.3', accepting: true, ways: [memberCredential] })
    expect(tree.queryByTestId(id('JoinStart'))).toBeNull()
    expect(tree.queryByTestId(id('JoinGoInvited'))).toBeNull()
    expect(tree.getByTestId(id('JoinWay_member-credential'))).toHaveTextContent(/Join\.Ways\.CredentialNotYet/)
  })

  it('a community that accepts no applications says so, with nothing to start', async () => {
    const tree = await toAsks({ wire: '0.3', accepting: false, ways: [] })
    expect(tree.getByTestId(id('JoinNotAccepting'))).toHaveTextContent(/Join\.Ways\.NotAccepting/)
    expect(tree.queryByTestId(id('JoinStart'))).toBeNull()
    expect(tree.queryByTestId(id('JoinWays'))).toBeNull()
  })

  it('a community whose join version this app cannot read says so, not "unreachable"', async () => {
    jest.spyOn(vtiAgent, 'fetchManifest').mockRejectedValue(new VtiRefusal('unsupportedVersion', 'no such version'))
    const tree = await toAsks(defaults)
    expect(tree.getByTestId(id('JoinVersionUnsupported'))).toHaveTextContent(/Join\.Ways\.VersionUnsupported/)
    expect(tree.queryByTestId(id('JoinStart'))).toBeNull()
  })

  it('the community changed what it asks while the request went: says so, and reads it again', async () => {
    const tree = await toAsks(defaults)
    mockJoinCommunity.mockRejectedValueOnce(new VtiRefusal('vtc/join-requests/submit:criterionUnknown', 'unknown'))
    const fetch = jest.spyOn(vtiAgent, 'fetchManifest')
    const before = fetch.mock.calls.length
    await act(async () => fireEvent.press(tree.getByTestId(id('JoinStart'))))
    await act(async () => fireEvent.press(tree.getByTestId(id('JoinAsContinue'))))
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    expect(tree.getByTestId(id('JoinChanged'))).toHaveTextContent(/Join\.Ways\.Changed/)
    // Back on what it asks, read afresh.
    expect(tree.getByTestId(id('JoinWays'))).toBeTruthy()
    expect(fetch.mock.calls.length).toBeGreaterThan(before)
  })

  it('a 0.2 community: today’s card and today’s Start', async () => {
    jest.spyOn(vtiAgent, 'fetchManifest').mockResolvedValue({
      criteria: [{ vetting: { minStatements: 1, requiredClaims: ['name.legal'] } }],
    } as never)
    const tree = await toAsks({ wire: '0.2', accepting: true, ways: [{ ...vetted, admission: 'unstated' }] })
    expect(tree.getByTestId(id('JoinAsks'))).toBeTruthy()
    expect(tree.queryByTestId(id('JoinWays'))).toBeNull()
    expect(tree.getByTestId(id('JoinStart'))).toHaveTextContent('Join.Start')
  })
})
