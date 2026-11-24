/**
 * The vote carried on behind the ballot (POLLS_VOTE_BEHIND), through the real service, hook and screens:
 * - the ballot goes back once the cast is stored, before it is sent; off, or killed, it holds (controls);
 * - a refusal before anything is stored keeps the member on the ballot, with it said there (control);
 * - the poll shows the vote on its way and then in, as each step is written behind;
 * - a failure after the member left shows on the poll: a refused cast on the ticket, a send that did not get through
 *   on the vote on its way (control: a vote that went shows it in);
 * - a kill during the pause leaves the cast stored, and the next start sends the same bytes.
 */
import { useRoute } from '@react-navigation/native'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { createKeyLock } from '../../../utils/keyLock'
import { PollsIds } from '../components/Polls.ids'
import { testIdWithKey } from '../../../utils/testable'
import type { BallotBoxDoor } from '../ballotBox'
import { createPollService, type PollRecord, type PollsBackend } from '../pollService'
import { POLLS_VOTE_BEHIND } from '../pollsVoteBehindSwitch'
import { POLL_GENERATIONS, POLL_TASK } from '../pollTasks'
import Poll from '../screens/Poll'
import PollBallot from '../screens/PollBallot'
import { pollServiceFor, resetPollService } from '../usePolls'

const COMMUNITY = 'did:webvh:QmCommunity:vtc.example.org'
const BOX = 'did:webvh:QmVote:vote.example.net'
const MEMBER = 'did:webvh:QmPersona:p'
const AGENT = 'did:webvh:QmAgent:a'
const POLL = 'charter'
const G1 = POLL_GENERATIONS[POLL_GENERATIONS.length - 1]

// React Native's jest setup reports a font scale of 2, which these screens read as large text. Default text is 1.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}))

// Focus as a screen has it: once on mounting, with no blur after. Going back is watched.
const mockNavigation = { goBack: jest.fn(), navigate: jest.fn() }
jest.mock('@react-navigation/native', () => {
  const ReactInMock = jest.requireActual('react')
  const base = jest.requireActual('../../../../__mocks__/@react-navigation/native')
  return {
    ...base,
    useNavigation: () => mockNavigation,
    useFocusEffect: (callback: () => void | (() => void)) => ReactInMock.useEffect(callback, [callback]),
  }
})

const mockAgent = {}
jest.mock('@bifold/react-hooks', () => ({ useAgent: () => ({ agent: mockAgent }) }))
const mockWorld: { backend?: PollsBackend } = {}
jest.mock('../agentPollsBackend', () => ({ createAgentPollsBackend: () => mockWorld.backend }))

const manifest = {
  electionId: POLL,
  community: COMMUNITY,
  title: 'Adopt the community charter?',
  questions: [
    {
      key: 'motion',
      type: 'choice',
      text: 'Adopt it?',
      options: [
        { key: 'option-yes', text: 'Yes' },
        { key: 'option-no', text: 'No' },
      ],
      minSelections: 1,
      maxSelections: 1,
      optional: false,
    },
  ],
  secrecy: 'open',
  roll: { rule: 'members' },
  // jestSetup fixes Date.now() at 2024-01-01 inside tests, so the poll is open then.
  registrationOpensAt: '2023-12-01T00:00:00Z',
  votingOpensAt: '2023-12-01T00:00:00Z',
  votingClosesAt: '2099-11-08T17:00:00Z',
  revote: 'refuse',
  board: { visibility: 'public', auditors: [] },
  ballotBox: BOX,
  binding: false,
  allowEarlyClose: true,
  resultsBeforeClose: false,
  textReleaseThreshold: 10,
}
const shown = {
  manifest,
  manifestDigest: 'zQmDigest',
  state: 'voting',
  parameters: { suite: 'ps-ddh-bls12381', votingKey: 'z6Mkkey' },
  disclosure: {
    ballotBox: BOX,
    ballotBoxOperator: 'Independent Ballots Ltd',
    sameOperator: false,
    boardVisibility: 'public',
    auditors: [],
    revote: 'refuse',
    coercionResistance: false,
  },
}

class Killed extends Error {}
const never = <T,>() => new Promise<T>(() => undefined)

/** This phone, its agent, the community and the ballot box, as far as a vote goes. The store outlives a service. */
function world() {
  const records = new Map<string, PollRecord>()
  const posted: Record<string, unknown>[] = []
  let builds = 0
  const state = {
    /** The pause before the cast: over at once, never over, or the app killed in it. */
    pause: 'over' as 'over' | 'never' | 'kill',
    /** What the ballot box does with a cast. */
    box: 'receipt' as 'receipt' | 'never' | 'offline' | 'refuse',
    voteRefusal: undefined as string | undefined,
    /** Holds the agent's answer to a receipt until it resolves. */
    receiptGate: undefined as Promise<void> | undefined,
  }
  const receiptFor = (cast: Record<string, unknown>) => ({
    type: `${POLL_TASK.cast}#response`,
    issuer: BOX,
    recipient: cast.issuer,
    threadId: cast.id,
    payload: { electionId: POLL, outcome: 'counted', leafIndex: 0 },
    proof: {},
  })
  const door: BallotBoxDoor = {
    endpointOf: async () => 'https://vote.example.net/trust-tasks',
    post: async (_url, document) => {
      posted.push(document)
      if (state.box === 'never') return never()
      if (state.box === 'offline') throw new Error('offline')
      if (state.box === 'refuse')
        return {
          status: 400,
          body: { type: 'https://trusttasks.org/spec/trust-task-error/0.1', payload: { code: 'alreadyVoted' } },
        }
      return { status: 200, body: receiptFor(document) }
    },
    verify: async () => ({ ok: true, signer: BOX }),
  }
  const lock = createKeyLock()
  const backend: PollsBackend = {
    communityTask: async () => JSON.parse(JSON.stringify(shown)),
    sendCompleted: async () => ({}),
    agentTask: async (type, payload) => {
      if (type === G1.vote) {
        if (state.voteRefusal) throw Object.assign(new Error('refused'), { code: state.voteRefusal })
        builds++
        return {
          castDocument: {
            id: `urn:uuid:00000000-0000-4000-8000-00000000000${builds}`,
            type: `${POLL_TASK.cast}#request`,
            issuer: `did:key:z6MkoneTime${builds}`,
            recipient: BOX,
            payload: {
              community: COMMUNITY,
              electionId: POLL,
              cast: { ballot: (payload as { ballot: unknown }).ballot },
            },
            proof: {},
          },
          tag: 'z3tag',
        }
      }
      if (type === POLL_TASK.receipt) {
        await state.receiptGate
        return { electionId: POLL, status: 'kept', leafIndex: 0 }
      }
      throw new Error(`unexpected ${type}`)
    },
    agentServedTypes: async () => [G1.register, POLL_TASK.accept, G1.vote, POLL_TASK.receipt],
    currentAgent: () => AGENT,
    linkedAgents: () => [AGENT],
    voterTarget: async (community) => ({ contextId: 'vta', community, member: MEMBER }),
    records: {
      get: async (community, electionId) => {
        const r = records.get(`${community} ${electionId}`)
        return r && JSON.parse(JSON.stringify(r))
      },
      put: async (record) =>
        void records.set(`${record.community} ${record.electionId}`, JSON.parse(JSON.stringify(record))),
      list: async () => [...records.values()].map((r) => JSON.parse(JSON.stringify(r))),
    },
    door,
    serially: (key, work) => lock(key, work),
    now: () => Date.now(),
    random: () => 0.5,
    sleep: async () => {
      if (state.pause === 'kill') throw new Killed('the app was killed during the pause')
      if (state.pause === 'never') return never()
    },
    warn: () => undefined,
  }
  // The member holds a ticket for the poll.
  records.set(`${COMMUNITY} ${POLL}`, {
    community: COMMUNITY,
    electionId: POLL,
    via: COMMUNITY,
    member: MEMBER,
    agent: AGENT,
    ticketRequestedAt: Date.now() - 3 * 3600_000,
    ticketAt: Date.now() - 3 * 3600_000,
  })
  return { backend, records, posted, state, builds: () => builds, record: () => records.get(`${COMMUNITY} ${POLL}`) }
}

const id = (key: string) => testIdWithKey(key)
const goBack = () => mockNavigation.goBack
const show = (screen: React.ReactElement) => render(<BasicAppContext>{screen}</BasicAppContext>)
const flush = () =>
  act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve()
  })

/** The ballot, an answer chosen, and Cast my vote tapped. */
async function castOnBallot() {
  const tree = show(<PollBallot />)
  await waitFor(() => expect(tree.getAllByTestId(id(PollsIds.option)).length).toBeGreaterThan(0))
  fireEvent.press(tree.getAllByTestId(id(PollsIds.option))[0])
  fireEvent.press(tree.getByTestId(id(PollsIds.cast)))
  return tree
}

let w: ReturnType<typeof world>
const SHIPPED = { ...POLLS_VOTE_BEHIND }
beforeEach(() => {
  resetPollService()
  w = world()
  mockWorld.backend = w.backend
  goBack().mockClear()
  ;(useRoute as jest.Mock).mockReturnValue({ params: { communityDid: COMMUNITY, electionId: POLL } })
})
afterEach(() => Object.assign(POLLS_VOTE_BEHIND, SHIPPED))

describe('leaving the ballot', () => {
  test('ships on, with no kill', () => {
    expect(SHIPPED).toEqual({ on: true, remoteOff: false })
  })

  test('the ballot goes back once the cast is stored, before it is sent: the pause goes on behind', async () => {
    w.state.pause = 'never'
    const tree = await castOnBallot()
    await waitFor(() => expect(goBack()).toHaveBeenCalledTimes(1))
    expect(w.record()?.pending?.stage).toBe('cast')
    expect(w.posted).toHaveLength(0)
    tree.unmount()
  })

  test.each([
    ['off: the ballot holds the member through the pause (control)', { on: false, remoteOff: false }],
    ['the kill reads as off: the ballot holds again', { on: true, remoteOff: true }],
  ])('%s', async (_name, value) => {
    Object.assign(POLLS_VOTE_BEHIND, value)
    w.state.pause = 'never'
    const tree = await castOnBallot()
    await waitFor(() => expect(w.record()?.pending?.stage).toBe('cast'))
    await flush()
    expect(goBack()).not.toHaveBeenCalled()
    expect(tree.getByTestId(id(PollsIds.casting))).toBeTruthy()
    tree.unmount()
  })

  test('a refusal before anything is stored keeps the member on the ballot, said there (control)', async () => {
    w.state.voteRefusal = 'keyring/agent:unreachable'
    const tree = await castOnBallot()
    await waitFor(() => expect(tree.getByTestId(id(PollsIds.castFailed))).toBeTruthy())
    expect(goBack()).not.toHaveBeenCalled()
    expect(w.record()?.pending).toBeUndefined()
    tree.unmount()
  })
})

describe('the poll, while the vote goes behind', () => {
  test('shows the vote on its way as soon as the cast is stored, then the vote in, without being opened again', async () => {
    let endPause: () => void = () => undefined
    w.backend.sleep = () => new Promise<void>((resolve) => (endPause = resolve))
    const tree = show(<Poll />)
    await waitFor(() => expect(tree.getByTestId(id(PollsIds.voteNow))).toBeTruthy())
    const service = pollServiceFor(mockAgent as never)
    const vote = service?.vote(COMMUNITY, POLL, { motion: { choice: ['option-yes'] } })
    await waitFor(() => expect(tree.getByTestId(id(PollsIds.sending))).toBeTruthy())
    await act(async () => endPause())
    await act(async () => void (await vote))
    await waitFor(() => expect(tree.getByTestId(id(PollsIds.voteIn))).toBeTruthy())
    expect(w.record()?.votedAt).toBeDefined()
    tree.unmount()
  })
})

describe('what the poll and the vote hear', () => {
  test('a vote on another poll carried on behind leaves this poll as it was', async () => {
    // Another poll's vote, left on its way: the next start takes it on, and writes its records.
    w.records.set(`${COMMUNITY} other`, {
      community: COMMUNITY,
      electionId: 'other',
      via: COMMUNITY,
      member: MEMBER,
      agent: AGENT,
      ticketRequestedAt: Date.now() - 3 * 3600_000,
      ticketAt: Date.now() - 3 * 3600_000,
      pending: { stage: 'receipt', receipt: {} },
    })
    // Its receipt is kept only once this poll is on screen, so its record is written last.
    let keepReceipt: () => void = () => undefined
    w.state.receiptGate = new Promise<void>((resolve) => (keepReceipt = resolve))
    const tree = show(<Poll />)
    await waitFor(() => expect(tree.getByTestId(id(PollsIds.voteNow))).toBeTruthy())
    await act(async () => keepReceipt())
    await waitFor(() => expect(w.records.get(`${COMMUNITY} other`)?.votedAt).toBeDefined())
    await flush()
    expect(tree.getByTestId(id(PollsIds.voteNow))).toBeTruthy()
    expect(tree.queryByTestId(id(PollsIds.voteIn))).toBeNull()
    tree.unmount()
  })

  test('voting again on a vote already on its way goes at once, and sends the stored cast, not a new one', async () => {
    // The first vote is stored, then the app is killed in the pause.
    w.state.pause = 'kill'
    await expect(
      createPollService(w.backend).vote(COMMUNITY, POLL, { motion: { choice: ['option-yes'] } })
    ).rejects.toThrow('killed')
    const stored = w.record()?.pending
    expect(stored?.stage).toBe('cast')
    // After the restart, before anything takes it on, the member votes again.
    w.state.pause = 'never'
    const again = createPollService(w.backend)
    const gone = jest.fn()
    void again.vote(COMMUNITY, POLL, { motion: { choice: ['option-no'] } }, undefined, gone)
    await flush()
    expect(gone).toHaveBeenCalledTimes(1)
    expect(gone.mock.calls[0][0].pending).toEqual(stored)
    expect(w.builds()).toBe(1)
  })
})

describe('a failure after the member left', () => {
  const leaveThenOpenPoll = async () => {
    const ballot = await castOnBallot()
    await waitFor(() => expect(goBack()).toHaveBeenCalledTimes(1))
    // The vote goes on while the ballot closes: whatever happens to it is not said on the ballot, which is going.
    await flush()
    expect(ballot.queryByTestId(id(PollsIds.castFailed))).toBeNull()
    ballot.unmount()
    return show(<Poll />)
  }

  test('a cast the ballot box refused shows on the ticket when the poll is opened', async () => {
    w.state.box = 'refuse'
    const tree = await leaveThenOpenPoll()
    await waitFor(() => expect(tree.getByTestId(id(PollsIds.voteStopped))).toBeTruthy())
    expect(tree.getByText('Polls.CastAlreadyVoted')).toBeTruthy()
    expect(w.record()?.stopped).toMatchObject({ kind: 'refused', code: 'alreadyVoted' })
    tree.unmount()
  })

  test('a send that did not get through shows on the vote on its way', async () => {
    w.state.box = 'offline'
    const tree = await leaveThenOpenPoll()
    await waitFor(() => expect(tree.getByTestId(id(PollsIds.sendingStopped))).toBeTruthy())
    expect(w.record()?.pending?.stage).toBe('cast')
    tree.unmount()
  })

  test('a vote that went shows it in, with no failure (control)', async () => {
    const tree = await leaveThenOpenPoll()
    await waitFor(() => expect(tree.getByTestId(id(PollsIds.voteIn))).toBeTruthy())
    // Gone once, when the cast was stored: the receipt kept later does not go back again.
    expect(goBack()).toHaveBeenCalledTimes(1)
    expect(tree.queryByTestId(id(PollsIds.voteStopped))).toBeNull()
    expect(tree.queryByTestId(id(PollsIds.sendingStopped))).toBeNull()
    tree.unmount()
  })
})

describe('a kill during the pause', () => {
  test('leaves the cast stored, and the next start sends the same bytes and shows the vote in', async () => {
    w.state.pause = 'kill'
    const ballot = await castOnBallot()
    await waitFor(() => expect(goBack()).toHaveBeenCalledTimes(1))
    await flush()
    ballot.unmount()
    const stored = w.record()?.pending
    expect(stored?.stage).toBe('cast')
    expect(w.posted).toHaveLength(0)

    // The next start: a new service over the same store takes the vote on again.
    w.state.pause = 'over'
    resetPollService()
    const tree = show(<Poll />)
    await waitFor(() => expect(tree.getByTestId(id(PollsIds.voteIn))).toBeTruthy())
    expect(w.posted).toEqual([stored?.stage === 'cast' ? stored.cast : undefined])
    expect(w.record()?.pending).toBeUndefined()
    tree.unmount()
  })
})
