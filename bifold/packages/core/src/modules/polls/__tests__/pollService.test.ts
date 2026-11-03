/**
 * The ticket and the cast, through every interruption the plan names ("Sending a vote"): the record is written before
 * anything is asked; a stored cast is the only one ever sent, and the same bytes go again after a kill or a lost
 * answer; once the agent keeps the receipt the phone holds only when the member voted.
 */
import { CastFailure, type BallotBoxDoor } from '../ballotBox'
import { POLL_TASK } from '../pollTasks'
import { PollRefusal, createPollService, type PollRecord, type PollsBackend } from '../pollService'

const COMMUNITY = 'did:webvh:QmCommunity:vtc.example.org'
const BOX = 'did:webvh:QmVote:vote.example.net'
const MEMBER = 'did:webvh:QmPersona:vtc.example.org:p'
const AGENT = 'did:webvh:QmAgent:agents.example'
const OTHER_AGENT = 'did:webvh:QmAgent2:agents.example'
const POLL = 'motion-7'
const CHOICE = 'option-the-member-chose'

const manifest = {
  electionId: POLL,
  community: COMMUNITY,
  questions: [
    {
      key: 'motion',
      type: 'choice',
      options: [{ key: CHOICE }, { key: 'other' }],
      minSelections: 1,
      maxSelections: 1,
      optional: false,
    },
  ],
  secrecy: 'open',
  roll: { rule: 'members' },
  registrationOpensAt: '2026-11-01T00:00:00Z',
  votingOpensAt: '2026-11-03T00:00:00Z',
  votingClosesAt: '2026-11-07T18:00:00Z',
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
  parameters: { suite: 'ps-ddh-bls12381', votingKey: 'z6MkvotingKey' },
  disclosure: { ballotBox: BOX },
}

/** A cast as the agent builds it: a new one-time key, so new bytes, every time it is asked. */
let builds = 0
const buildCast = (ballot: unknown) => {
  builds++
  return {
    id: `urn:uuid:00000000-0000-4000-8000-00000000000${builds}`,
    type: `${POLL_TASK.cast}#request`,
    issuer: `did:key:z6MkoneTime${builds}`,
    recipient: BOX,
    payload: { community: COMMUNITY, electionId: POLL, cast: { ballot } },
    proof: {},
  }
}

const receiptFor = (cast: Record<string, unknown>) => ({
  type: `${POLL_TASK.cast}#response`,
  issuer: BOX,
  recipient: cast.issuer,
  threadId: cast.id,
  payload: { electionId: POLL, outcome: 'counted', leafIndex: 0 },
  proof: {},
})

class Killed extends Error {}

function world() {
  const records = new Map<string, PollRecord>()
  const asked: string[] = []
  const posted: Record<string, unknown>[] = []
  const warnings: string[] = []
  const linked = [AGENT]
  let current: string | undefined = AGENT
  let clock = 1_000_000
  const state = {
    served: [POLL_TASK.register, POLL_TASK.accept, POLL_TASK.vote, POLL_TASK.receipt] as string[] | undefined,
    registerRefusal: undefined as string | undefined,
    postFails: 0,
    receiptFails: 0,
    killDuringPause: false,
    random: 0.5,
  }
  const door: BallotBoxDoor = {
    endpointOf: async () => 'https://vote.example.net/trust-tasks',
    post: async (_url, document) => {
      posted.push(document)
      if (state.postFails > 0) {
        state.postFails--
        throw new Error('offline')
      }
      return { status: 200, body: receiptFor(document) }
    },
    verify: async () => ({ ok: true, signer: BOX }),
  }
  const backend: PollsBackend = {
    communityTask: async (_community, type) => {
      asked.push(type)
      if (type === POLL_TASK.show) return shown as never
      if (type === POLL_TASK.list) return { elections: [] }
      throw new Error(`unexpected ${type}`)
    },
    sendCompleted: async (_community, document) => {
      asked.push(String(document.type))
      return { electionId: POLL, label: `voter/${POLL}`, preCredential: 'z3pre' }
    },
    agentTask: async (type, payload) => {
      asked.push(type)
      // Each record write is seen in order: the ticket's must come before the agent is asked.
      if (type === POLL_TASK.register) {
        if (state.registerRefusal) throw Object.assign(new Error('refused'), { code: state.registerRefusal })
        return {
          electionId: POLL,
          manifestDigest: 'zQmDigest',
          request: {},
          ticketDocument: { type: `${POLL_TASK.ticketsIssue}#request`, payload: {} },
        }
      }
      if (type === POLL_TASK.accept) return { electionId: POLL, ticketHeld: true }
      if (type === POLL_TASK.vote)
        return { castDocument: buildCast((payload as { ballot: unknown }).ballot), tag: 'z3tag' }
      if (type === POLL_TASK.receipt) {
        if (state.receiptFails > 0) {
          state.receiptFails--
          throw Object.assign(new Error('agent offline'), { code: 'keyring/agent:unreachable' })
        }
        return { electionId: POLL, status: 'kept', leafIndex: 0 }
      }
      throw new Error(`unexpected ${type}`)
    },
    agentServedTypes: async () => state.served,
    currentAgent: () => current,
    linkedAgents: () => linked,
    voterTarget: async (community) => ({ contextId: 'vta', community, member: MEMBER }),
    records: {
      get: async (community, electionId) => {
        const r = records.get(`${community} ${electionId}`)
        return r && JSON.parse(JSON.stringify(r))
      },
      put: async (record) => {
        asked.push(`put:${record.pending?.stage ?? (record.votedAt ? 'voted' : record.ticketAt ? 'ticket' : 'asked')}`)
        records.set(`${record.community} ${record.electionId}`, JSON.parse(JSON.stringify(record)))
      },
      list: async () => [...records.values()].map((r) => JSON.parse(JSON.stringify(r))),
    },
    door,
    serially: (_key, work) => work(),
    now: () => clock,
    random: () => state.random,
    sleep: async (ms) => {
      if (state.killDuringPause) throw new Killed('the app was killed during the pause')
      clock += ms
    },
    warn: (message) => warnings.push(message),
  }
  return {
    backend,
    service: createPollService(backend),
    records,
    asked,
    posted,
    warnings,
    state,
    linked,
    setCurrent: (did: string | undefined) => (current = did),
    record: () => records.get(`${COMMUNITY} ${POLL}`),
  }
}

const vote = (w: ReturnType<typeof world>) => w.service.vote(COMMUNITY, POLL, { motion: { choice: [CHOICE] } })

beforeEach(() => {
  builds = 0
})

describe('taking a ticket', () => {
  test('the poll is recorded before the agent is asked, then the request goes to the community and back', async () => {
    const w = world()
    const record = await w.service.takeTicket(COMMUNITY, POLL)
    expect(w.asked).toEqual([
      POLL_TASK.show,
      'put:asked',
      POLL_TASK.register,
      `${POLL_TASK.ticketsIssue}#request`,
      POLL_TASK.accept,
      'put:ticket',
    ])
    expect(record).toMatchObject({ member: MEMBER, agent: AGENT })
    expect(record.ticketAt).toBeDefined()
  })

  test('after a crash between the record and the ticket, a ticket the agent already holds is taken as held', async () => {
    const w = world()
    w.state.registerRefusal = 'vta/pcs/voter/register:ticketHeld'
    const record = await w.service.takeTicket(COMMUNITY, POLL)
    expect(record.ticketAt).toBeDefined()
    expect(w.asked).not.toContain(`${POLL_TASK.ticketsIssue}#request`)
  })

  test('an agent that serves no voter task is said to be too old before anything is asked of it', async () => {
    const w = world()
    w.state.served = ['https://trusttasks.org/spec/vta/contexts/list/0.1']
    await expect(w.service.takeTicket(COMMUNITY, POLL)).rejects.toMatchObject({ reason: 'agentTooOld' })
    expect(w.asked).toEqual([])
  })

  test('a second ticket is refused once a vote is recorded', async () => {
    const w = world()
    await w.service.takeTicket(COMMUNITY, POLL)
    await vote(w)
    await expect(w.service.takeTicket(COMMUNITY, POLL)).rejects.toMatchObject({ reason: 'voted' })
  })

  test('another agent still linked to this phone holding the ticket refuses a second; once it is unlinked, it does not', async () => {
    const w = world()
    await w.service.takeTicket(COMMUNITY, POLL)
    w.linked.push(OTHER_AGENT)
    w.setCurrent(OTHER_AGENT)
    await expect(w.service.takeTicket(COMMUNITY, POLL)).rejects.toMatchObject({ reason: 'heldByAnotherAgent' })
    w.linked.splice(w.linked.indexOf(AGENT), 1)
    await expect(w.service.takeTicket(COMMUNITY, POLL)).resolves.toMatchObject({ agent: OTHER_AGENT })
  })

  test('a poll reached through another community is the same poll: a second ticket is refused once voted', async () => {
    const w = world()
    await w.service.takeTicket(COMMUNITY, POLL)
    await vote(w)
    expect(w.record()?.via).toBe(COMMUNITY)
    await expect(w.service.takeTicket('did:webvh:QmOtherCommunity:vtc.example.net', POLL)).rejects.toMatchObject({
      reason: 'voted',
    })
    expect(await w.service.record('did:webvh:QmOtherCommunity:vtc.example.net', POLL, COMMUNITY)).toMatchObject({
      votedAt: expect.any(Number),
    })
  })

  test('with no agent linked, nothing is asked', async () => {
    const w = world()
    w.setCurrent(undefined)
    await expect(w.service.takeTicket(COMMUNITY, POLL)).rejects.toMatchObject({ reason: 'noAgent' })
    expect(w.asked).toEqual([])
  })
})

describe('voting', () => {
  test('the cast is stored before it is sent, and once the agent keeps the receipt only "voted at" stays', async () => {
    const w = world()
    await w.service.takeTicket(COMMUNITY, POLL)
    w.asked.length = 0
    const record = await vote(w)
    expect(w.asked).toEqual([POLL_TASK.show, POLL_TASK.vote, 'put:cast', 'put:receipt', POLL_TASK.receipt, 'put:voted'])
    expect(record.votedAt).toBeDefined()
    expect(record.pending).toBeUndefined()
    // Nothing that proves how the member voted: no choice, no cast, no receipt.
    expect(JSON.stringify(w.record())).not.toContain(CHOICE)
    expect(JSON.stringify(w.record())).not.toContain('threadId')
  })

  test('it waits the random pause before sending', async () => {
    const w = world()
    await w.service.takeTicket(COMMUNITY, POLL)
    w.state.random = 0.25
    const sleeps: number[] = []
    const sleep = w.backend.sleep
    w.backend.sleep = async (ms) => {
      sleeps.push(ms)
      return sleep(ms)
    }
    await vote(w)
    expect(sleeps).toEqual([5_000])
  })

  test('a screen hears each step as it starts: ready, the pause and when it ends, sending, the receipt; never the choice', async () => {
    const w = world()
    await w.service.takeTicket(COMMUNITY, POLL)
    w.state.random = 0.25
    const steps: unknown[] = []
    await w.service.vote(COMMUNITY, POLL, { motion: { choice: [CHOICE] } }, (s) => steps.push(s))
    expect(steps.map((s) => (s as { step: string }).step)).toEqual(['ready', 'pause', 'sending', 'receipt'])
    const pause = steps[1] as { from: number; until: number }
    expect(pause.until - pause.from).toBe(5_000)
    expect(JSON.stringify(steps)).not.toContain(CHOICE)
  })

  test('with no pause left, no pause step is heard (control for the step above)', async () => {
    const w = world()
    await w.service.takeTicket(COMMUNITY, POLL)
    w.state.random = 0
    const steps: string[] = []
    await w.service.vote(COMMUNITY, POLL, { motion: { choice: [CHOICE] } }, (s) => steps.push(s.step))
    expect(steps).toEqual(['ready', 'sending', 'receipt'])
  })

  test('killed during the pause: the stored cast goes the next time, the same bytes, and no second cast is built', async () => {
    const w = world()
    await w.service.takeTicket(COMMUNITY, POLL)
    w.state.killDuringPause = true
    await expect(vote(w)).rejects.toThrow(Killed)
    const stored = w.record()?.pending
    expect(stored?.stage).toBe('cast')
    expect(w.posted).toEqual([])

    w.state.killDuringPause = false
    await createPollService(w.backend).resumePending()
    expect(w.posted).toEqual([stored?.stage === 'cast' ? stored.cast : undefined])
    expect(builds).toBe(1)
    expect(w.record()?.votedAt).toBeDefined()
  })

  test('sent and the answer lost: the same bytes again, never a new cast, and it counts once', async () => {
    const w = world()
    await w.service.takeTicket(COMMUNITY, POLL)
    w.state.postFails = 1
    await expect(vote(w)).rejects.toMatchObject({ kind: 'unreachable' })
    expect(w.record()?.stopped?.kind).toBe('unreachable')
    // Voting again takes the stored cast on: it does not ask the agent for another.
    await vote(w)
    expect(builds).toBe(1)
    expect(w.posted).toHaveLength(2)
    expect(w.posted[1]).toEqual(w.posted[0])
    expect(w.record()?.votedAt).toBeDefined()
  })

  test('the receipt kept but the agent not reached: the receipt, not the cast, waits, and goes to the agent next time', async () => {
    const w = world()
    await w.service.takeTicket(COMMUNITY, POLL)
    w.state.receiptFails = 1
    await expect(vote(w)).rejects.toMatchObject({ reason: 'refused' })
    expect(w.record()?.pending?.stage).toBe('receipt')
    expect(JSON.stringify(w.record())).not.toContain(CHOICE)
    await w.service.resumePending()
    expect(w.posted).toHaveLength(1)
    expect(w.record()?.votedAt).toBeDefined()
  })

  test('a refused cast is dropped, with why it stopped and nothing about the choice', async () => {
    const w = world()
    await w.service.takeTicket(COMMUNITY, POLL)
    w.backend.door = {
      ...w.backend.door,
      post: async (_url, document) => {
        w.posted.push(document)
        return {
          status: 400,
          body: {
            type: 'https://trusttasks.org/spec/trust-task-error/0.1',
            payload: { code: 'voting/ballot/cast:notOpen' },
          },
        }
      },
    }
    await expect(
      createPollService(w.backend).vote(COMMUNITY, POLL, { motion: { choice: [CHOICE] } })
    ).rejects.toBeInstanceOf(CastFailure)
    expect(w.record()?.pending).toBeUndefined()
    expect(w.record()?.stopped).toMatchObject({ kind: 'refused', code: 'voting/ballot/cast:notOpen' })
    expect(JSON.stringify(w.record())).not.toContain(CHOICE)
  })

  test('a ballot the rules refuse is said before the agent is asked', async () => {
    const w = world()
    await w.service.takeTicket(COMMUNITY, POLL)
    w.asked.length = 0
    await expect(w.service.vote(COMMUNITY, POLL, { motion: { choice: ['nonsense'] } })).rejects.toMatchObject({
      reason: 'ballotInvalid',
      ballot: { reason: 'unknownOption', question: 'motion' },
    })
    expect(w.asked).toEqual([POLL_TASK.show])
  })

  test('without a ticket, nothing is built', async () => {
    const w = world()
    await expect(vote(w)).rejects.toBeInstanceOf(PollRefusal)
    expect(builds).toBe(0)
  })

  test('nothing the phone logs carries the choice', async () => {
    const w = world()
    await w.service.takeTicket(COMMUNITY, POLL)
    w.state.postFails = 1
    await vote(w).catch(() => undefined)
    await vote(w)
    expect(w.warnings.length).toBeGreaterThan(0)
    expect(w.warnings.join('\n')).not.toContain(CHOICE)
  })
})
