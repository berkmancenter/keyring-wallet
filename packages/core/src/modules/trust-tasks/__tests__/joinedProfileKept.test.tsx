/**
 * The profile a person joins a community as is kept (vtiJoinSeed), so screens can name them by it when they hold
 * several profiles. Kept per community, replaced by a later join, and a store that fails never fails the join.
 */
import { useNavigation } from '@react-navigation/native'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import type { JoinAsks, JoinWay } from '../module/joinManifest'
import { vtaAgent } from '../module/vtaAgent'
import { vtiAgent } from '../module/vtiAgent'
import { communityTarget } from '../module/vtiCommunityLink'
import { keepJoinedProfile, loadJoinedProfileId } from '../module/vtiJoinSeed'
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

// Two profiles, the second one active: "Join as" offers the active one first and chooses it.
type Profile = { id: string; name: string }
const mockState = {
  rCard: {
    profiles: [
      { id: 'personal', name: 'Pat' },
      { id: 'work', name: 'Dr Pat' },
    ] as Profile[],
    activeProfileId: 'work',
  },
}
jest.mock('../../../contexts/store', () => ({
  ...jest.requireActual('../../../contexts/store'),
  useStore: () => [mockState, jest.fn()],
}))
jest.mock('../../vrc/types/rcard', () => ({
  ...jest.requireActual('../../vrc/types/rcard'),
  formInputFromTemplate: (p: Profile) => ({ firstName: p.name, lastName: '', label: p.id }),
}))

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
const review = way({ id: 'review', admission: 'review', requiresNothing: true })
const asks: JoinAsks = { wire: '0.3', accepting: true, ways: [review], suggested: review, outcomeIfMet: 'reviewed' }

type Kept = { id: string; content: Record<string, unknown>; tags?: Record<string, unknown> }

// The agent's generic records, in memory. Saving an id that is already kept fails, as the store does.
function makeAgent() {
  const kept = new Map<string, Kept>()
  const genericRecords = {
    findById: jest.fn(async (recordId: string) => kept.get(recordId) ?? null),
    findAllByQuery: jest.fn(async () => []),
    save: jest.fn(async (record: Kept) => {
      if (kept.has(record.id)) throw new Error(`a record with id ${record.id} already exists`)
      kept.set(record.id, { ...record })
    }),
    update: jest.fn(async (record: Kept) => void kept.set(record.id, { ...record })),
    delete: jest.fn(),
  }
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return { agent: { genericRecords, config: { logger } } as never, kept, genericRecords, logger }
}

describe('the profile a community was joined as', () => {
  it('is kept per community, read back, and replaced by a later join', async () => {
    const { agent, kept } = makeAgent()
    await expect(loadJoinedProfileId(agent, community)).resolves.toBeUndefined()
    await keepJoinedProfile(agent, community, 'work')
    await keepJoinedProfile(agent, 'did:webvh:other', 'personal')
    await expect(loadJoinedProfileId(agent, community)).resolves.toBe('work')
    await keepJoinedProfile(agent, community, 'personal')
    await expect(loadJoinedProfileId(agent, community)).resolves.toBe('personal')
    await expect(loadJoinedProfileId(agent, 'did:webvh:other')).resolves.toBe('personal')
    expect(kept.size).toBe(2)
    expect(kept.get(`joined-profile:${community}`)?.tags).toEqual({ type: 'joined-profile', communityDid: community })
  })

  it('a store that fails is logged and never fails the join', async () => {
    const { agent, genericRecords, logger } = makeAgent()
    genericRecords.findById.mockRejectedValueOnce(new Error('store closed'))
    await expect(keepJoinedProfile(agent, community, 'work')).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  describe('on the Join screen', () => {
    let store: ReturnType<typeof makeAgent>

    beforeEach(() => {
      jest.useFakeTimers()
      communityTarget.clear()
      mockEnsurePersona.mockClear()
      mockJoinCommunity.mockClear()
      mockReadJoinState.mockImplementation(async () => ({ kind: 'none' }))
      mockHolds.mockImplementation(async () => ({}))
      mockJoinAsks.mockReturnValue(asks)
      jest.spyOn(vtiAgent, 'fetchManifest').mockResolvedValue({ wire: '0.3', criteria: [] } as never)
      store = makeAgent()
      ;(useAgent as jest.Mock).mockReturnValue({ agent: store.agent })
      ;(vtaAgent as unknown as Setter).set({
        link: {
          kind: 'linked',
          vtaDid: 'did:webvh:example:vta',
          label: 'bob',
          linkedAt: '2026-10-02T00:00:00Z',
          connection: { kind: 'online', since: 0 },
        },
      })
      ;(useNavigation() as unknown as { navigate: jest.Mock }).navigate.mockClear()
    })
    afterEach(() => {
      jest.useRealTimers()
      jest.restoreAllMocks()
    })

    it('asking to join keeps the profile chosen at "Join as", not the first one listed', async () => {
      const tree = render(
        <BasicAppContext>
          <VtiJoin config={config} />
        </BasicAppContext>
      )
      await act(async () => {
        jest.advanceTimersByTime(10)
      })
      await act(async () => fireEvent.press(tree.getByTestId(id('JoinThisCommunity'))))
      await act(async () => fireEvent.press(tree.getByTestId(id('JoinStart'))))
      await act(async () => fireEvent.press(tree.getByTestId(id('JoinAsContinue'))))
      expect(mockJoinCommunity).toHaveBeenCalledTimes(1)
      expect(store.kept.get(`joined-profile:${community}`)?.content).toEqual({ profileId: 'work' })
    })
  })
})
