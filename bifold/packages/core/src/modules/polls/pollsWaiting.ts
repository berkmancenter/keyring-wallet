/**
 * The polls waiting for the member, for the Waiting for you stack on Messages (community-polls-plan.md, "Where polls
 * appear"): an open poll in a community they belong to, that they haven't voted in and haven't hidden.
 *
 * **When it asks.** Only while the app is in the foreground: when the app opens, when it comes back to the foreground,
 * and once an hour while it stays open. Never in the background, and never on a screen's focus: each
 * check is one signed list read per community, and the community sees each one. Messages coming into focus re-reads
 * only this phone's own records, so a poll voted in leaves the stack at once, with nothing asked of anyone.
 *
 * **What it keeps.** The list in memory, and what the member hid ("Not now") in one record in the agent's encrypted
 * store: per poll, its close and when it comes back. Never the question, the title or which identity is the member's:
 * the card names the community and the closing date only, and nothing here is logged or said in a notice.
 *
 * **Not now.** It hides the card on this phone, and the card comes back once, at a random time before the close, so it
 * never prompts a vote at a moment that could be paired with the ticket. Hidden again after that, it stays hidden until
 * the poll closes. The record is rewritten, never deleted: a poll that has closed falls out of it on the next write.
 *
 * @module polls/pollsWaiting
 */
import type { Agent } from '@credo-ts/core'
import { useAgent } from '@bifold/react-hooks'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'

import { createKeyLock } from '../../utils/keyLock'
import { GenericRecordsCommunityStore, isCurrentMembership } from '../trust-tasks/module/VtiCommunityStore'
import { vtaAgent } from '../trust-tasks/module/vtaAgent'

import type { PollService } from './pollService'
import { usePollService } from './usePolls'

/** One poll waiting for the member: which community, which poll, and when it closes. Nothing it asks or says. */
export interface PollWaiting {
  communityDid: string
  electionId: string
  votingClosesAt: string
}

/** Once an hour while the app is open. */
export const POLLS_CHECK_MS = 60 * 60 * 1000

/** The shortest gap between two checks: the app opening and coming to the foreground often arrive together. */
export const POLLS_CHECK_FLOOR_MS = 60_000

const keyOf = (communityDid: string, electionId: string) => `${communityDid} ${electionId}`

// ---- the list, in memory ----

const waiting: { items?: readonly PollWaiting[]; listeners: Set<() => void> } = { listeners: new Set() }
const NONE: readonly PollWaiting[] = []

function publish(items: readonly PollWaiting[]) {
  waiting.items = items
  waiting.listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  waiting.listeners.add(listener)
  return () => void waiting.listeners.delete(listener)
}

/** The polls the last check found, all or one community's, without any that has closed since. */
export function usePollsWaiting(communityDid?: string, now: number = Date.now()): readonly PollWaiting[] {
  const items = useSyncExternalStore(subscribe, () => waiting.items ?? NONE)
  return useMemo(
    () => items.filter((p) => (!communityDid || p.communityDid === communityDid) && now < Date.parse(p.votingClosesAt)),
    [items, communityDid, now]
  )
}

/** Put a list in place, as a check does (tests). */
export const publishPollsWaiting = (items: readonly PollWaiting[]): void => publish(items)

/** Forget the list (tests). */
export function resetPollsWaiting(): void {
  waiting.items = undefined
  waiting.listeners.forEach((listener) => listener())
}

// ---- what the member hid ----

/** A hidden poll: its close, and when it comes back. No `returnAt`: hidden until the close (the second Not now). */
export interface HiddenPoll {
  closesAt: number
  returnAt?: number
}
export type HiddenPolls = Readonly<Record<string, HiddenPoll>>

export function isHidden(hidden: HiddenPolls, communityDid: string, electionId: string, now: number): boolean {
  const h = hidden[keyOf(communityDid, electionId)]
  if (!h) return false
  return h.returnAt === undefined || now < h.returnAt
}

/** A random time before the close: somewhere in the middle three fifths of what is left, never at once, never at it. */
export function returnTime(now: number, closesAt: number, random: () => number = Math.random): number | undefined {
  const left = closesAt - now
  if (left <= 0) return undefined
  return Math.floor(now + left * (0.2 + 0.6 * random()))
}

/**
 * Not now. The first time, the poll comes back once at a random time before its close; once it has come back, Not now
 * hides it until the close. Polls that have closed are dropped on the way.
 */
export function hideOnce(
  hidden: HiddenPolls,
  poll: PollWaiting,
  now: number,
  random: () => number = Math.random
): HiddenPolls {
  const key = keyOf(poll.communityDid, poll.electionId)
  const closesAt = Date.parse(poll.votingClosesAt)
  const next: Record<string, HiddenPoll> = {}
  for (const [k, h] of Object.entries(hidden)) if (h.closesAt > now) next[k] = h
  next[key] = hidden[key] ? { closesAt } : { closesAt, returnAt: returnTime(now, closesAt, random) }
  return next
}

const HIDDEN_ID = 'polls-card-hidden'
const inTurn = createKeyLock()

const asHidden = (content: unknown): HiddenPolls => {
  const hidden = (content as { hidden?: unknown } | undefined)?.hidden
  if (!hidden || typeof hidden !== 'object') return {}
  const out: Record<string, HiddenPoll> = {}
  for (const [k, v] of Object.entries(hidden as Record<string, unknown>)) {
    const h = v as { closesAt?: unknown; returnAt?: unknown }
    if (typeof h?.closesAt !== 'number') continue
    out[k] = typeof h.returnAt === 'number' ? { closesAt: h.closesAt, returnAt: h.returnAt } : { closesAt: h.closesAt }
  }
  return out
}

export function loadHiddenPolls(agent: Agent): Promise<HiddenPolls> {
  return inTurn(HIDDEN_ID, async () => asHidden((await agent.genericRecords.findById(HIDDEN_ID))?.content))
}

async function saveHiddenPolls(agent: Agent, hidden: HiddenPolls): Promise<void> {
  const record = await agent.genericRecords.findById(HIDDEN_ID)
  if (record) {
    record.content = { hidden }
    await agent.genericRecords.update(record)
  } else {
    await agent.genericRecords.save({ id: HIDDEN_ID, content: { hidden }, tags: { type: HIDDEN_ID } })
  }
}

/**
 * Not now on a card: it leaves the stack at once, and what was hidden is kept. Resolves to whether this was the first
 * Not now (the card comes back once) and an undo that puts both back as they were.
 */
export async function hidePollCard(
  agent: Agent,
  poll: PollWaiting,
  now: number = Date.now(),
  random: () => number = Math.random
): Promise<{ comesBack: boolean; undo: () => Promise<void> }> {
  const before = waiting.items ?? NONE
  const { previous, next } = await inTurn(HIDDEN_ID, async () => {
    const previous = asHidden((await agent.genericRecords.findById(HIDDEN_ID))?.content)
    const next = hideOnce(previous, poll, now, random)
    await saveHiddenPolls(agent, next)
    return { previous, next }
  })
  publish(before.filter((p) => !(p.communityDid === poll.communityDid && p.electionId === poll.electionId)))
  return {
    comesBack: next[keyOf(poll.communityDid, poll.electionId)]?.returnAt !== undefined,
    undo: async () => {
      await inTurn(HIDDEN_ID, () => saveHiddenPolls(agent, previous))
      publish(before)
    },
  }
}

// ---- the check ----

/**
 * The polls waiting in these communities: voting open, not closed, not voted in or on its way, not hidden. A community
 * that can't be read is skipped this time.
 */
export async function findPollsWaiting(
  service: Pick<PollService, 'readPolls' | 'record'>,
  communityDids: readonly string[],
  hidden: HiddenPolls,
  now: number
): Promise<PollWaiting[]> {
  const found = new Map<string, PollWaiting>()
  for (const communityDid of communityDids) {
    let polls
    try {
      polls = await service.readPolls(communityDid, { state: 'voting' })
    } catch {
      continue
    }
    for (const poll of polls) {
      if (poll.state !== 'voting') continue
      if (now < Date.parse(poll.votingOpensAt) || now >= Date.parse(poll.votingClosesAt)) continue
      const record = await service.record(communityDid, poll.electionId).catch(() => undefined)
      if (record?.votedAt !== undefined || record?.pending) continue
      if (isHidden(hidden, communityDid, poll.electionId, now)) continue
      found.set(keyOf(communityDid, poll.electionId), {
        communityDid,
        electionId: poll.electionId,
        votingClosesAt: poll.votingClosesAt,
      })
    }
  }
  return [...found.values()]
}

/** The communities this phone is a current member of, once each. */
async function memberCommunities(agent: Agent): Promise<string[]> {
  const memberships = await new GenericRecordsCommunityStore(agent).listMemberships()
  return [...new Set(memberships.filter(isCurrentMembership).map((m) => m.communityDid))]
}

/**
 * Messages coming into focus: drop any poll voted in since the last check, from this phone's own records. Nothing is
 * asked of a community.
 */
export async function dropVotedPolls(service: Pick<PollService, 'record'>): Promise<void> {
  const items = waiting.items
  if (!items?.length) return
  const keep: PollWaiting[] = []
  for (const p of items) {
    const record = await service.record(p.communityDid, p.electionId).catch(() => undefined)
    if (record?.votedAt === undefined && !record?.pending) keep.push(p)
  }
  if (keep.length !== items.length) publish(keep)
}

/**
 * The check, run from the tab navigator: when the app opens, when it comes back to the foreground, and once an hour
 * while it stays there; never in the background. Nothing is asked without a linked agent.
 */
export function usePollsWaitingCheck(): void {
  const { agent } = useAgent()
  const service = usePollService()
  const linked = useSyncExternalStore(vtaAgent.subscribe, () => vtaAgent.getState().link.kind === 'linked')
  const [active, setActive] = useState(AppState.currentState !== 'background')

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state !== 'background'))
    return () => subscription?.remove()
  }, [])

  useEffect(() => {
    if (!agent || !service || !linked || !active) return
    let live = true
    const check = async () => {
      if (Date.now() - lastCheck < POLLS_CHECK_FLOOR_MS) return
      lastCheck = Date.now()
      try {
        const [communities, hidden] = await Promise.all([
          memberCommunities(agent as Agent),
          loadHiddenPolls(agent as Agent),
        ])
        const found = await findPollsWaiting(service, communities, hidden, Date.now())
        if (live) publish(found)
      } catch {
        // The stack keeps what the last check found.
      }
    }
    void check()
    const timer = setInterval(() => void check(), POLLS_CHECK_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [agent, service, linked, active])
}

let lastCheck = 0

/** Forget when the last check ran (tests). */
export function resetPollsCheckFloor(): void {
  lastCheck = 0
}
