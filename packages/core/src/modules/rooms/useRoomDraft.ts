/**
 * A room's unsent post, kept per room so it outlives the Room screen: an inactivity lock brings the member back to
 * the open room (#772), and the post they were writing comes back with it. The chat's kept draft does this for a
 * one-to-one chat (chat/draft.ts, chat/useChatDraft.ts), and a room's goes through the same store and hook: saved a
 * moment after it changes and as the app leaves the foreground, handed back when the room opens, cleared at once
 * when it is sent, and waited for by locking.
 *
 * Only the text is kept. A picked file is not: it is a copy the picker made for this post, and a later session may
 * no longer have it.
 *
 * @module rooms/useRoomDraft
 */
import type { Agent } from '@credo-ts/core'

import { loadDraft, saveDraft } from '../chat/draft'
import { type ChatDraft, type DraftStore, useKeptDraft } from '../chat/useChatDraft'

const ROOM_DRAFTS: DraftStore = {
  load: (agent, roomId) => loadDraft(agent, 'room', roomId),
  save: (agent, roomId, text) => saveDraft(agent, 'room', roomId, text),
  log: 'Rooms:draft',
}

export function useRoomDraft(agent: Agent | undefined, roomId: string): ChatDraft {
  return useKeptDraft(agent, roomId, ROOM_DRAFTS)
}
