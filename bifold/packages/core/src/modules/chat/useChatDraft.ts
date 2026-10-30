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

export function useChatDraft(agent: Agent | undefined, connectionId: string): ChatDraft {
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
    saveChatDraft(agent, connectionId, text).catch((error) => {
      agent.config?.logger?.warn(`[Chat:draft] the draft for ${connectionId} was not saved`, { error })
    })
  }, [agent, connectionId])

  const onTextChange = useCallback(
    (text: string) => {
      // An empty field reported empty again (gifted-chat lays it out): nothing changed.
      if (text === '' && field.current === '') return
      field.current = text
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
    loadChatDraft(agent, connectionId)
      .then((text) => {
        if (!live || touched.current === connectionId) return
        field.current = text ?? ''
        setSaved(text)
      })
      .catch((error) => {
        agent.config?.logger?.warn(`[Chat:draft] the draft for ${connectionId} could not be read`, { error })
      })
    return () => {
      live = false
    }
  }, [agent, connectionId])

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
