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
      pending.current = text
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, DRAFT_SAVE_DELAY_MS)
    },
    [flush]
  )

  useEffect(() => {
    setSaved(undefined)
    if (!agent) return
    let live = true
    loadChatDraft(agent, connectionId)
      .then((text) => {
        if (live) setSaved(text)
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
