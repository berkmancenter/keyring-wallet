/**
 * One journey state per community, re-read when the community changes — the
 * mechanism the journey screens stand on (a member offered "Apply to join", a
 * finished step still pending, My Agent late to a new membership).
 */
import type { Agent } from '@credo-ts/core'
import { useFocusEffect } from '@react-navigation/native'
import { act, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { DeviceEventEmitter, Text } from 'react-native'

import {
  COMMUNITY_CHANGED_EVENT,
  VTI_PERSONA_DELIVERIES_EVENT,
  changeOfHeldCredential,
  emitCommunityChanged,
  useCommunityChanged,
} from '../module/communityChanged'
import { useCommunityJourney, type CommunityJourneyReaders } from '../module/communityJourney'
import { GenericRecordsCommunityStore, type VtiMembership } from '../module/VtiCommunityStore'
import type { CommunityJoinState } from '../module/vtiJoin'
import { GenericRecordsVettingStore } from '../module/vtiVetting'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const A = 'did:webvh:QmA:community-a.example'
const B = 'did:webvh:QmB:community-b.example'
const agent = {} as Agent
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 5)))

/** A generic-records store in memory, enough for the two stores' writes. */
const fakeRecordsAgent = () => {
  const records: { content: Record<string, unknown>; tags: Record<string, string> }[] = []
  const matches = (tags: Record<string, string>, q: Record<string, string>) =>
    Object.entries(q).every(([k, v]) => tags[k] === v)
  return {
    records,
    agent: {
      genericRecords: {
        findAllByQuery: jest.fn(async (q: Record<string, string>) => records.filter((r) => matches(r.tags, q))),
        save: jest.fn(async (r: { content: Record<string, unknown>; tags: Record<string, string> }) => {
          records.push(r)
        }),
        update: jest.fn(async () => undefined),
        delete: jest.fn(async (r: unknown) => {
          records.splice(records.indexOf(r as (typeof records)[number]), 1)
        }),
      },
    } as unknown as Agent,
  }
}

const listen = () => {
  const heard: unknown[] = []
  const sub = DeviceEventEmitter.addListener(COMMUNITY_CHANGED_EVENT, (e) => heard.push(e))
  return { heard, stop: () => sub.remove() }
}

describe('the community-changed event', () => {
  test('is announced after the write returns, not during it', async () => {
    const { heard, stop } = listen()
    emitCommunityChanged(A, 'membership')
    expect(heard).toEqual([])
    await settle()
    expect(heard).toEqual([{ communityDid: A, what: 'membership' }])
    stop()
  })

  test('a listener that throws never reaches the writer', async () => {
    const sub = DeviceEventEmitter.addListener(COMMUNITY_CHANGED_EVENT, () => {
      throw new Error('listener broke')
    })
    expect(() => emitCommunityChanged(A, 'membership')).not.toThrow()
    await settle()
    sub.remove()
  })

  test('says nothing without a community', async () => {
    const { heard, stop } = listen()
    emitCommunityChanged(undefined, 'membership')
    await settle()
    expect(heard).toEqual([])
    stop()
  })

  test('a held credential names what it changes', () => {
    expect(changeOfHeldCredential('vetter-grant')).toBe('grant')
    expect(changeOfHeldCredential('role')).toBe('membership')
    expect(changeOfHeldCredential('vetting-statement')).toBe('application')
  })
})

describe('the stores announce their writes', () => {
  test('a saved membership is announced once it is stored', async () => {
    const { agent: recordsAgent, records } = fakeRecordsAgent()
    const { heard, stop } = listen()
    await new GenericRecordsCommunityStore(recordsAgent).saveMembership({ communityDid: A } as VtiMembership)
    expect(records).toHaveLength(1)
    await settle()
    expect(heard).toEqual([{ communityDid: A, what: 'membership' }])
    stop()
  })

  test('a vetter grant arriving is announced as the grant', async () => {
    const { agent: recordsAgent } = fakeRecordsAgent()
    const { heard, stop } = listen()
    await new GenericRecordsCommunityStore(recordsAgent).saveHeldCredential({
      kind: 'vetter-grant',
      communityDid: A,
      credential: { id: 'urn:grant:1' },
      receivedAt: '2026-09-25T00:00:00Z',
    } as never)
    await settle()
    expect(heard).toEqual([{ communityDid: A, what: 'grant' }])
    stop()
  })

  test('a saved vetting application is announced', async () => {
    const { agent: recordsAgent } = fakeRecordsAgent()
    const { heard, stop } = listen()
    await new GenericRecordsVettingStore(recordsAgent).saveApplication({ communityDid: A } as never)
    await settle()
    expect(heard).toEqual([{ communityDid: A, what: 'application' }])
    stop()
  })

  test('a failed write announces nothing', async () => {
    const { agent: recordsAgent } = fakeRecordsAgent()
    ;(recordsAgent.genericRecords.save as jest.Mock).mockRejectedValueOnce(new Error('disk full'))
    const { heard, stop } = listen()
    await expect(
      new GenericRecordsCommunityStore(recordsAgent).saveMembership({ communityDid: A } as VtiMembership)
    ).rejects.toThrow('disk full')
    await settle()
    expect(heard).toEqual([])
    stop()
  })
})

describe('listening for changes', () => {
  const Listener: React.FC<{ refresh: () => void; communityDid?: string }> = ({ refresh, communityDid }) => {
    useCommunityChanged(refresh, communityDid)
    return null
  }

  test("hears its own community and the inbox's deliveries, not another community", async () => {
    const refresh = jest.fn()
    render(<Listener refresh={refresh} communityDid={A} />)
    emitCommunityChanged(B, 'membership')
    await settle()
    expect(refresh).not.toHaveBeenCalled()
    emitCommunityChanged(A, 'membership')
    await settle()
    expect(refresh).toHaveBeenCalledTimes(1)
    DeviceEventEmitter.emit(VTI_PERSONA_DELIVERIES_EVENT, { communityDid: A, kinds: ['membership'] })
    await settle()
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  test('changes that land together refresh once', async () => {
    const refresh = jest.fn()
    render(<Listener refresh={refresh} communityDid={A} />)
    // A delivery: the store's own announcement, then the inbox's.
    DeviceEventEmitter.emit(COMMUNITY_CHANGED_EVENT, { communityDid: A, what: 'membership' })
    DeviceEventEmitter.emit(VTI_PERSONA_DELIVERIES_EVENT, { communityDid: A, kinds: ['membership'] })
    await settle()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  test('never refreshes after unmount', async () => {
    const refresh = jest.fn()
    const tree = render(<Listener refresh={refresh} communityDid={A} />)
    DeviceEventEmitter.emit(COMMUNITY_CHANGED_EVENT, { communityDid: A, what: 'membership' })
    tree.unmount()
    await settle()
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('the journey hook', () => {
  // Coming into view once, as a screen would, rather than on every render.
  beforeEach(() => {
    jest.mocked(useFocusEffect).mockImplementation((effect) => React.useEffect(effect, [effect]))
  })

  const member: CommunityJoinState = { kind: 'member', membership: { communityDid: A } as VtiMembership }
  const none: CommunityJoinState = { kind: 'none' }

  const Journey: React.FC<{ readers: Partial<CommunityJourneyReaders>; poll?: boolean }> = ({ readers, poll }) => {
    const { journey } = useCommunityJourney(agent, A, { readers, poll })
    return <Text testID="join">{journey ? journey.join.kind : 'loading'}</Text>
  }

  const readersWith = (join: jest.Mock): Partial<CommunityJourneyReaders> => ({
    join,
    application: jest.fn(async () => undefined),
    vetterGrant: jest.fn(async () => ({ state: 'none' as const })),
  })

  test('reads where the phone stands when it comes into view', async () => {
    const join = jest.fn(async () => none)
    const tree = render(<Journey readers={readersWith(join)} />)
    await waitFor(() => expect(tree.getByTestId('join')).toHaveTextContent('none'))
    expect(join).toHaveBeenCalledWith(agent, A, { poll: false })
  })

  test('a local write moves it on at once, without asking the community', async () => {
    let stored: CommunityJoinState = none
    const join = jest.fn(async () => stored)
    const tree = render(<Journey readers={readersWith(join)} poll />)
    await waitFor(() => expect(tree.getByTestId('join')).toHaveTextContent('none'))
    expect(join).toHaveBeenLastCalledWith(agent, A, { poll: true })

    stored = member
    emitCommunityChanged(A, 'membership')
    await waitFor(() => expect(tree.getByTestId('join')).toHaveTextContent('member'))
    expect(join).toHaveBeenLastCalledWith(agent, A, { poll: false })
  })

  test('a remount reads the finished step again, not the start', async () => {
    const join = jest.fn(async () => member)
    const first = render(<Journey readers={readersWith(join)} />)
    await waitFor(() => expect(first.getByTestId('join')).toHaveTextContent('member'))
    first.unmount()
    const again = render(<Journey readers={readersWith(join)} />)
    await waitFor(() => expect(again.getByTestId('join')).toHaveTextContent('member'))
  })

  test('an older reading finishing late does not put back an old state', async () => {
    let release: (s: CommunityJoinState) => void = () => undefined
    const slow = new Promise<CommunityJoinState>((resolve) => (release = resolve))
    const join = jest.fn().mockReturnValueOnce(slow).mockResolvedValue(member)
    const tree = render(<Journey readers={readersWith(join)} />)
    emitCommunityChanged(A, 'membership')
    await waitFor(() => expect(tree.getByTestId('join')).toHaveTextContent('member'))
    release(none)
    await settle()
    expect(tree.getByTestId('join')).toHaveTextContent('member')
  })

  test('a part that cannot be read reads as nothing', async () => {
    const join = jest.fn(async () => {
      throw new Error('store locked')
    })
    const tree = render(<Journey readers={readersWith(join)} />)
    await waitFor(() => expect(tree.getByTestId('join')).toHaveTextContent('none'))
  })
})
