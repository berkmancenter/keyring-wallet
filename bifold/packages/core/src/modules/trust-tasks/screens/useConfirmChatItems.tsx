/**
 * The "Confirm it's you" cards for one chat (ConfirmChatCard.tsx), as items the chat lists among its messages.
 *
 * Read from the records Confirm it's you already keeps, never written to the chat: this phone's requests to the
 * contact (confirmAsksOn; the newest is a full card, older ones a quiet line each) and the contact's request to this
 * phone (the live prompt, else the kept CONFIRM_PROMPT record). So nothing here is in a chat export or backup, Clear
 * chat does not touch a request, and each card follows the request's own expiry, not the chat's timer.
 *
 * Read again on every Confirm it's you event for this connection, and on a clock at the soonest expiry, since no
 * event says a request ran out of time. With the switch off (or either remote off) there are no items at all.
 *
 * @module trust-tasks/screens/useConfirmChatItems
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useCallback, useEffect, useMemo, useState } from 'react'

import type { ExtendedChatMessage } from '../../../components/chat/ChatMessage'
import { Role } from '../../../types/chat'
import {
  CONFIRM_PROMPT,
  confirmAsksOn,
  confirmEvents,
  confirmPromptStore,
  confirmStatusOf,
  type ConfirmAsk,
  type ConfirmPrompt,
} from '../confirmItsYou'
import { isConfirmItsYouEnabled } from '../module/confirmItsYouFlag'

import ConfirmChatCard, { theirStatusOf, type ConfirmChatEntry } from './ConfirmChatCard'

/** The contact's request as this phone keeps it, with the time it was answered when the record says. */
type Theirs = { prompt: ConfirmPrompt; answeredAt?: string }

async function theirsOn(
  agent: { genericRecords: { findAllByQuery: (query: Record<string, string>) => Promise<{ content: unknown }[]> } },
  connectionId: string
): Promise<Theirs | undefined> {
  const live = confirmPromptStore.get(connectionId)
  if (live) return { prompt: live }
  const [record] = (await agent.genericRecords.findAllByQuery({ recordType: CONFIRM_PROMPT, connectionId })) ?? []
  const kept = record?.content as ConfirmPrompt | undefined
  if (!kept?.connectionId || !kept.expiresAt) return undefined
  return { prompt: kept, ...(kept.answeredAt ? { answeredAt: kept.answeredAt } : {}) }
}

/** The soonest time a card changes on its own: a waiting request or an open prompt running out. */
function nextDue(asks: ConfirmAsk[], theirs: Theirs | undefined, now = Date.now()): number | undefined {
  const times = [
    ...asks.filter((ask) => confirmStatusOf(ask, now) === 'waiting').map((ask) => Date.parse(ask.expiresAt)),
    ...(theirs && theirStatusOf(theirs.prompt, now) === 'open' ? [Date.parse(theirs.prompt.expiresAt)] : []),
  ].filter((at) => Number.isFinite(at) && at > now)
  return times.length > 0 ? Math.min(...times) : undefined
}

export function useConfirmChatItems(connectionId: string | undefined, name: string): ExtendedChatMessage[] {
  const { agent } = useAgent()
  const on = isConfirmItsYouEnabled()
  const [asks, setAsks] = useState<ConfirmAsk[]>([])
  const [theirs, setTheirs] = useState<Theirs | undefined>()
  const [tick, setTick] = useState(0)

  const load = useCallback(async () => {
    if (!agent || !connectionId) return
    setAsks(await confirmAsksOn(agent, connectionId).catch(() => []))
    setTheirs(await theirsOn(agent as never, connectionId).catch(() => undefined))
  }, [agent, connectionId])

  useEffect(() => {
    if (!on) return
    void load()
    const refresh = (event: { connectionId?: string }) => {
      if (event?.connectionId === connectionId) void load()
    }
    const names = ['asked', 'answered', 'prompt', 'promptCleared'] as const
    for (const event of names) confirmEvents.on(event, refresh)
    return () => {
      for (const event of names) confirmEvents.off(event, refresh)
    }
  }, [on, load, connectionId])

  // A clock, not only events: no answer may ever come, and the card must still change when the time is up.
  useEffect(() => {
    if (!on) return
    const due = nextDue(asks, theirs)
    if (due === undefined) return
    const timer = setTimeout(() => setTick((n) => n + 1), Math.min(due - Date.now() + 50, 30000))
    return () => clearTimeout(timer)
  }, [on, asks, theirs, tick])

  return useMemo(() => {
    if (!on || !connectionId) return []
    const reload = () => void load()
    const item = (id: string, createdAt: string, role: Role, entry: ConfirmChatEntry): ExtendedChatMessage => ({
      _id: id,
      text: '',
      createdAt: new Date(createdAt),
      user: { _id: role },
      confirmCard: true,
      renderEvent: () => <ConfirmChatCard entry={entry} connectionId={connectionId} name={name} onChanged={reload} />,
    })
    const items = asks.map((ask, index) =>
      item(`confirm-ask-${ask.threadId}`, ask.askedAt, Role.me, { side: 'mine', ask, newest: index === 0 })
    )
    if (theirs)
      items.push(
        item(`confirm-prompt-${connectionId}-${theirs.prompt.receivedAt}`, theirs.prompt.receivedAt, Role.them, {
          side: 'theirs',
          prompt: theirs.prompt,
          ...(theirs.answeredAt ? { answeredAt: theirs.answeredAt } : {}),
        })
      )
    return items
    // tick: re-render the cards when a time runs out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, connectionId, asks, theirs, name, load, tick])
}

export default useConfirmChatItems
