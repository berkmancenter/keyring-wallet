/**
 * A member's polls: read them, take a ticket, vote, and see the vote through to a kept receipt, however the app is
 * interrupted on the way.
 *
 * **One record per poll on this phone**, across every agent linked to it (`PollRecord`), written before anything is
 * asked of anyone. It says which identity and which agent took the ticket and when the member voted, and while a
 * vote is on its way it holds the built cast, then the receipt, and nothing else. It lives in the wallet's encrypted
 * store, which is out of device backups (Android `allowBackup="false"`; iOS excludes the store's folder), and nothing
 * here logs what it holds.
 *
 * **One vote per membership, kept on this phone only.** A second ticket is refused once a vote is recorded, or while
 * another agent still linked to this phone holds one. Upstream counts memberships, not people, so this is a courtesy:
 * two agents on two phones share nothing this can see.
 *
 * **The cast is a persisted state machine** — built, sent, receipt kept — because the agent builds a fresh cast on
 * every `vta/pcs/vote` (new randomness, a new one-time key) while the ticket fixes its tag. The only safe retry after
 * a kill, a background or a lost answer is the same bytes again, which the ballot box answers with the first receipt.
 * So the cast is stored before it is sent, from build to receipt, and dropped once the receipt is kept; the receipt is
 * held only until the agent keeps it. After that the record says when the member voted and nothing that proves how:
 * on an open poll the cast and its receipt would be that proof. A crash before the cast was stored builds a new one:
 * nothing went out. A crash between the record and the ticket is safe: the agent answers a second register from its
 * record (`ticketHeld`), and the community answers a resent ticket request from its own.
 *
 * **The pause before a cast** (`sendAfter`, up to `MAX_CAST_DELAY_MS`) blurs the order in which casts sent close
 * together arrive. It does not stop a community and a ballot box that compare notes from pairing a ticket's issue
 * time with a vote's arrival when few members vote in that window, and it does not hide the phone's IP address from
 * the ballot box.
 *
 * @module polls/pollService
 */
import { CastFailure, castDelayMs, postCast, type BallotBoxDoor } from './ballotBox'
import { ballotOf, ballotRefusal, type BallotRefusal, type GivenAnswer } from './ballot'
import {
  POLL_TASK,
  VOTER_AGENT_TASKS,
  acceptPayload,
  parsePollList,
  parsePollShown,
  parseRegistered,
  parseVoted,
  receiptPayload,
  refusalName,
  registerPayload,
  votePayload,
  type PollListItem,
  type PollShown,
  type VoterTarget,
} from './pollTasks'

/** A vote on its way: the built cast until its receipt is kept, then the receipt until the agent keeps it. */
export type PendingVote =
  | { stage: 'cast'; cast: Record<string, unknown>; ballotBox: string; sendAfter: number }
  | { stage: 'receipt'; receipt: Record<string, unknown> }

/**
 * This phone's record of one poll, keyed by the community its manifest names and the poll's id: a poll id is unique
 * only within that community, and the member may reach the poll through another (`via`).
 */
export interface PollRecord {
  /** The community the poll's manifest names. */
  community: string
  electionId: string
  /** The community the member reached the poll through: whose session, and whose identity, the ticket was asked as. */
  via: string
  /** The identity the ticket was asked for. */
  member: string
  /** The agent that holds the ticket. */
  agent: string
  ticketRequestedAt: number
  ticketAt?: number
  votedAt?: number
  pending?: PendingVote
  /** Why the last try at the pending vote stopped: a refusal code, never anything about the choice. */
  stopped?: { kind: CastFailure['kind'] | 'agent'; code?: string; at: number }
}

export interface PollRecordStore {
  get(community: string, electionId: string): Promise<PollRecord | undefined>
  put(record: PollRecord): Promise<void>
  list(): Promise<PollRecord[]>
}

export interface PollsBackend {
  /** A community task sent as this phone's identity there, the session held while it runs. */
  communityTask(community: string, type: string, payload: Record<string, unknown>): Promise<Record<string, unknown>>
  /** A document the agent signed as that identity, sent to the community unchanged. */
  sendCompleted(community: string, document: Record<string, unknown>): Promise<Record<string, unknown>>
  /** A task to the agent this phone acts with now. */
  agentTask(type: string, payload: object): Promise<Record<string, unknown>>
  /** What that agent serves, when it says. */
  agentServedTypes(): Promise<string[] | undefined>
  /** The agent this phone acts with now, and every agent still linked to it. */
  currentAgent(): string | undefined
  linkedAgents(): string[]
  /** The identity this phone holds in `community` under the current agent, and the agent context it was made in. */
  voterTarget(community: string): Promise<VoterTarget | undefined>
  records: PollRecordStore
  door: BallotBoxDoor
  /** Work for one poll, one piece at a time: a resume and a screen never send the same cast at once. */
  serially<T>(key: string, work: () => Promise<T>): Promise<T>
  now(): number
  random(): number
  sleep(ms: number): Promise<void>
  warn(message: string): void
}

export type PollRefusalReason =
  | 'noAgent'
  | 'agentTooOld'
  | 'limited'
  | 'noIdentity'
  | 'unreadable'
  | 'voted'
  | 'heldByAnotherAgent'
  | 'pollChanged'
  | 'noTicket'
  | 'notOpen'
  | 'unsupportedSecrecy'
  | 'ballotInvalid'
  | 'refused'

/**
 * Where a vote is, for a screen to show while it goes: the agent building it (`ready`), the pause before it is sent,
 * with when the pause ends (`until`), sending it, and handing the receipt to the agent. Never what was chosen.
 */
export type VoteStep =
  | { step: 'ready' }
  | { step: 'pause'; from: number; until: number }
  | { step: 'sending' }
  | { step: 'receipt' }

/** Why the phone did not go on: said before anything was sent, or a party's refusal read by its name. */
export class PollRefusal extends Error {
  constructor(
    readonly reason: PollRefusalReason,
    readonly code?: string,
    readonly ballot?: BallotRefusal
  ) {
    super(code ? `${reason} (${code})` : reason)
    this.name = 'PollRefusal'
  }
}

/** The refusal code a Trust Task failure carries (`VtiRefusal` and the agent client's both carry `code`). */
export function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | undefined)?.code
  return typeof code === 'string' && code ? code : undefined
}

/** How many list pages are read: a community with more polls than this shows the newest pages' worth. */
const LIST_PAGES = 5

/** One poll's work runs one piece at a time, keyed as the member reaches it. */
const workKey = (via: string, electionId: string) => `${via} ${electionId}`

export function createPollService(b: PollsBackend) {
  const target = async (community: string): Promise<VoterTarget> => {
    if (!b.currentAgent()) throw new PollRefusal('noAgent')
    const t = await b.voterTarget(community)
    if (!t) throw new PollRefusal('noIdentity')
    return t
  }

  /** An agent from before VTA 0.69 serves no voter task: said before anything is asked of it. */
  const agentServesVoting = async () => {
    const served = await b.agentServedTypes().catch(() => undefined)
    if (served && !VOTER_AGENT_TASKS.every((type) => served.includes(type))) throw new PollRefusal('agentTooOld')
  }

  const readPolls = async (community: string, filter: { state?: string } = {}): Promise<PollListItem[]> => {
    const polls: PollListItem[] = []
    let cursor: string | undefined
    for (let page = 0; page < LIST_PAGES; page++) {
      const answer = parsePollList(
        await b.communityTask(community, POLL_TASK.list, {
          ...(filter.state ? { state: filter.state } : {}),
          ...(cursor ? { cursor } : {}),
        })
      )
      polls.push(...answer.polls)
      cursor = answer.nextCursor
      if (!cursor) break
    }
    return polls
  }

  const readPoll = async (community: string, electionId: string): Promise<PollShown> => {
    const shown = parsePollShown(await b.communityTask(community, POLL_TASK.show, { electionId }))
    if (!shown || shown.manifest.electionId !== electionId) throw new PollRefusal('unreadable')
    return shown
  }

  /** Whether this phone may ask for a ticket: no vote recorded, and no other agent still linked holding one. */
  const mayTakeTicket = (record: PollRecord | undefined, agent: string) => {
    if (!record) return
    if (record.votedAt !== undefined || record.pending) throw new PollRefusal('voted')
    if (record.agent !== agent && b.linkedAgents().includes(record.agent)) throw new PollRefusal('heldByAnotherAgent')
  }

  /**
   * Take a ticket for a poll the member has been shown (its disclosure first, VTI-VOT-090): the agent's blinded
   * request, signed as the member, to the community; the community's blind answer back to the agent.
   */
  const takeTicket = (via: string, electionId: string): Promise<PollRecord> =>
    b.serially(workKey(via, electionId), async () => {
      const t = await target(via)
      const agent = b.currentAgent() as string
      await agentServesVoting()
      const shown = await readPoll(via, electionId)
      const community = shown.manifest.community
      const earlier = await b.records.get(community, electionId)
      mayTakeTicket(earlier, agent)
      if (earlier?.agent === agent && earlier.member === t.member && earlier.ticketAt !== undefined) return earlier
      // Written before anything is asked: a crash from here on finds the record, and both parties answer a resend
      // from their own.
      const record: PollRecord = { community, electionId, via, member: t.member, agent, ticketRequestedAt: b.now() }
      await b.records.put(record)
      let registered: ReturnType<typeof parseRegistered>
      try {
        registered = parseRegistered(await b.agentTask(POLL_TASK.register, registerPayload(t, shown)))
      } catch (e) {
        if (refusalName(codeOf(e)) === 'ticketHeld') return held(record)
        throw refused(e)
      }
      if (!registered) throw new PollRefusal('unreadable')
      if (registered.manifestDigest !== shown.manifestDigest) throw new PollRefusal('pollChanged')
      try {
        const issued = await b.sendCompleted(via, registered.ticketDocument)
        await b.agentTask(POLL_TASK.accept, acceptPayload(t, electionId, shown.parameters, issued))
      } catch (e) {
        throw refused(e)
      }
      return held(record)
    })

  const held = async (record: PollRecord) => {
    const next = { ...record, ticketAt: b.now() }
    await b.records.put(next)
    return next
  }

  // An agent refuses a phone whose role carries no voter capability (`pcsVoter`: admin and initiator only) as
  // `permissionDenied`: the phone's access, not the agent, is what stops it.
  const refused = (e: unknown) => {
    if (e instanceof PollRefusal) return e
    const code = codeOf(e)
    return new PollRefusal(refusalName(code) === 'permissionDenied' ? 'limited' : 'refused', code)
  }

  /**
   * Vote: the ballot checked here, the cast built by the agent, stored, and sent after its pause. Returns once the
   * receipt is kept, or throws: a `CastFailure` of kind `unreachable` leaves the cast stored, and `resumePending` (or
   * voting again) sends the same one. `onStep` hears each step as it starts.
   */
  const vote = (
    via: string,
    electionId: string,
    given: Record<string, GivenAnswer>,
    onStep?: (step: VoteStep) => void
  ): Promise<PollRecord> =>
    b.serially(workKey(via, electionId), async () => {
      onStep?.({ step: 'ready' })
      const shown = await readPoll(via, electionId)
      const record = await b.records.get(shown.manifest.community, electionId)
      if (record?.pending) return carryOn(record, onStep)
      if (record?.votedAt !== undefined) throw new PollRefusal('voted')
      if (record?.ticketAt === undefined) throw new PollRefusal('noTicket')
      const t = await target(via)
      if (t.member !== record.member || b.currentAgent() !== record.agent) throw new PollRefusal('heldByAnotherAgent')
      if (shown.manifest.secrecy !== 'open') throw new PollRefusal('unsupportedSecrecy')
      if (shown.state !== 'voting') throw new PollRefusal('notOpen')
      const ballot = ballotOf(shown.manifest, shown.manifestDigest, given)
      const wrong = ballotRefusal(shown.manifest, shown.manifestDigest, ballot)
      if (wrong) throw new PollRefusal('ballotInvalid', undefined, wrong)
      let voted: ReturnType<typeof parseVoted>
      try {
        voted = parseVoted(await b.agentTask(POLL_TASK.vote, votePayload(t, shown, ballot)))
      } catch (e) {
        throw refused(e)
      }
      if (!voted) throw new PollRefusal('unreadable')
      if (voted.castDocument.recipient !== shown.manifest.ballotBox) throw new PollRefusal('pollChanged')
      // Stored before it is sent: from here a retry is the same bytes.
      const pending: PendingVote = {
        stage: 'cast',
        cast: voted.castDocument,
        ballotBox: shown.manifest.ballotBox,
        sendAfter: b.now() + castDelayMs(() => b.random()),
      }
      const next = { ...record, pending }
      await b.records.put(next)
      return carryOn(next, onStep)
    })

  /** Take a pending vote one stage further, as far as it goes. */
  const carryOn = async (record: PollRecord, onStep?: (step: VoteStep) => void): Promise<PollRecord> => {
    let current = record
    if (current.pending?.stage === 'cast') {
      const { cast, ballotBox, sendAfter } = current.pending
      const now = b.now()
      const wait = sendAfter - now
      if (wait > 0) {
        onStep?.({ step: 'pause', from: now, until: sendAfter })
        await b.sleep(wait)
      }
      onStep?.({ step: 'sending' })
      let receipt: Record<string, unknown>
      try {
        receipt = await postCast(cast, ballotBox, b.door)
      } catch (e) {
        const failure = e instanceof CastFailure ? e : new CastFailure('unreachable', String(e))
        if (failure.kind === 'refused') {
          // Refused: the same cast again changes nothing. It goes; why it stopped stays.
          const stopped = {
            ...current,
            pending: undefined,
            stopped: { kind: failure.kind, code: failure.code, at: b.now() },
          }
          await b.records.put(stopped)
        } else {
          await b.records.put({ ...current, stopped: { kind: failure.kind, at: b.now() } })
        }
        b.warn(
          `[polls] a cast for ${current.electionId} stopped: ${failure.kind}${failure.code ? ` (${failure.code})` : ''}`
        )
        throw failure
      }
      current = { ...current, pending: { stage: 'receipt', receipt }, stopped: undefined }
      await b.records.put(current)
    }
    if (current.pending?.stage === 'receipt') {
      onStep?.({ step: 'receipt' })
      // The receipt goes to the agent that built the cast, in the context its voter key is in.
      const voter = await b.voterTarget(current.via)
      if (!voter || voter.member !== current.member || b.currentAgent() !== current.agent)
        throw new PollRefusal('heldByAnotherAgent')
      try {
        await b.agentTask(POLL_TASK.receipt, receiptPayload(voter, current.electionId, current.pending.receipt))
      } catch (e) {
        await b.records.put({ ...current, stopped: { kind: 'agent', code: codeOf(e), at: b.now() } })
        throw refused(e)
      }
      current = { ...current, pending: undefined, stopped: undefined, votedAt: b.now() }
      await b.records.put(current)
    }
    return current
  }

  /** Every vote this phone left on its way (a kill, a background, no network), taken on once more. Never throws. */
  const resumePending = async (): Promise<void> => {
    for (const record of await b.records.list().catch(() => [])) {
      // A stored cast goes whichever agent is current: it needs none. Its receipt waits for the agent that built it.
      if (!record.pending) continue
      await b
        .serially(workKey(record.via, record.electionId), async () => {
          const now = await b.records.get(record.community, record.electionId)
          return now?.pending ? carryOn(now) : now
        })
        .catch(() => undefined)
    }
  }

  /**
   * This phone's record of a poll as reached through `via`: by the manifest's community when it is known, else by the
   * community reached through, which names it for every poll that community runs itself.
   */
  const recordOf = async (via: string, electionId: string, pollCommunity?: string): Promise<PollRecord | undefined> => {
    const own = await b.records.get(pollCommunity ?? via, electionId)
    if (own || pollCommunity) return own
    return (await b.records.list()).find((r) => r.via === via && r.electionId === electionId)
  }

  /** Whether this phone can vote at all, read before any ballot from what the agent serves: never from a failed vote. */
  const agentReadiness = async (): Promise<'ready' | 'noAgent' | 'tooOld'> => {
    if (!b.currentAgent()) return 'noAgent'
    try {
      await agentServesVoting()
      return 'ready'
    } catch {
      return 'tooOld'
    }
  }

  return {
    readPolls,
    readPoll,
    takeTicket,
    vote,
    resumePending,
    agentReadiness,
    record: recordOf,
  }
}

export type PollService = ReturnType<typeof createPollService>
