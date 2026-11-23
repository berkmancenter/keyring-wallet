/**
 * The Chat screen's side of a kept draft (chat/draft.ts): what the composer
 * holds is saved shortly after it changes, and what was saved is handed back
 * when the chat opens.
 *
 * The save that matters is the one when the app leaves the foreground: the app
 * locks only after a while away, and locking shuts the agent down in the same
 * moment it unmounts this screen, so a save on unmount may find the store
 * already closed. That last one is still tried, for a screen left by
 * navigating, but it is never the only copy.
 *
 * A sent draft must not come back. A field emptied (gifted-chat reports '' after
 * a send) is saved at once rather than after the pause, so the kept draft is
 * gone before anything can read it again; and a read that answers once the
 * field has been touched in this chat is ignored, so a re-read (the agent
 * restarting on lock and unlock) or a slow first read can't put old words into
 * a field the person has typed in or sent from.
 *
 * gifted-chat also reports '' when it first lays out the empty field. That is
 * not a change: it neither touches the field nor clears the kept draft, which
 * it used to do 400 ms after the chat opened, while the draft was on screen.
 * It is told apart from a send only by the field being empty then, so it
 * relies on that '' arriving before the first read answers (gifted-chat sends
 * it as it mounts, before an awaited store read can resolve). Were the read to
 * answer first, the '' would read as a send and clear the kept draft.
 *
 * The draft handed back (`saved`) is spent once the field is touched, so a
 * composer drawn afresh later (a room's, when it was swapped out a while)
 * can't put back words since sent or changed.
 *
 * A room's composer keeps its draft through the same hook, useKeptDraft, with
 * the room's own store (rooms/useRoomDraft.ts).
 *
 * @module chat/useChatDraft
 */

import type { Agent } from '@credo-ts/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'

import { loadChatDraft, saveChatDraft } from './draft'

/** How long typing pauses before the draft is saved. */
export const DRAFT_SAVE_DELAY_MS = 400

export interface ChatDraft {
  /** Pass to the composer as its onTextChange. */
  onTextChange: (text: string) => void
  /** The draft saved for this chat, once read; undefined while reading or when there is none. */
  saved: string | undefined
}

/** Where a composer's draft is kept: how to read and save it by its id, and the name its log lines go by. */
export interface DraftStore {
  load: (agent: Agent, id: string) => Promise<string | undefined>
  save: (agent: Agent, id: string, text: string) => Promise<void>
  log: string
}

const CHAT_DRAFTS: DraftStore = {
  load: (agent, id) => loadChatDraft(agent, id),
  save: (agent, id, text) => saveChatDraft(agent, id, text),
  log: 'Chat:draft',
}

export function useChatDraft(agent: Agent | undefined, connectionId: string): ChatDraft {
  return useKeptDraft(agent, connectionId, CHAT_DRAFTS)
}

/** A composer's kept draft, by the id it is kept under (a chat's connection, a room's id) in `store`. */
export function useKeptDraft(agent: Agent | undefined, connectionId: string, store: DraftStore): ChatDraft {
  const pending = useRef<string | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [saved, setSaved] = useState<string | undefined>(undefined)
  // The chat whose field has been touched (typed in, or emptied by a send) since this screen opened it.
  const touched = useRef<string | undefined>(undefined)
  // What the field holds as far as this hook knows: what was typed, or the kept draft handed back.
  const field = useRef('')
  // The chat this hook last read for. A new one starts untouched and empty; the same chat read again (the agent
  // restarting) keeps both, so a draft already sent stays gone. The screen may be reused for another chat (a deep
  // link or a message wake updates its params) rather than mounted afresh.
  const openFor = useRef<string | undefined>(undefined)

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = undefined
    const text = pending.current
    pending.current = undefined
    if (text === undefined || !agent) return
    store.save(agent, connectionId, text).catch((error) => {
      agent.config?.logger?.warn(`[${store.log}] the draft for ${connectionId} was not saved`, { error })
    })
  }, [agent, connectionId, store])

  const onTextChange = useCallback(
    (text: string) => {
      // An empty field reported empty again (gifted-chat lays it out): nothing changed.
      if (text === '' && field.current === '') return
      field.current = text
      if (touched.current !== connectionId) setSaved(undefined)
      touched.current = connectionId
      pending.current = text
      if (timer.current) clearTimeout(timer.current)
      if (text === '') flush()
      else timer.current = setTimeout(flush, DRAFT_SAVE_DELAY_MS)
    },
    [flush, connectionId]
  )

  useEffect(() => {
    setSaved(undefined)
    if (openFor.current !== connectionId) {
      openFor.current = connectionId
      touched.current = undefined
      field.current = ''
    }
    if (!agent) return
    let live = true
    store
      .load(agent, connectionId)
      .then((text) => {
        if (!live || touched.current === connectionId) return
        field.current = text ?? ''
        setSaved(text)
      })
      .catch((error) => {
        agent.config?.logger?.warn(`[${store.log}] the draft for ${connectionId} could not be read`, { error })
      })
    return () => {
      live = false
    }
  }, [agent, connectionId, store])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flush()
    })
    return () => subscription.remove()
  }, [flush])

  // Leaving the chat (or the chat changing under this screen) saves what is still waiting.
  useEffect(() => () => flush(), [flush])

  return { onTextChange, saved }
}
