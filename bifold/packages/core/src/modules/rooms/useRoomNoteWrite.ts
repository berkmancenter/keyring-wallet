/**
 * Writing a note (rooms member features, chunk 2): a titled record in an open room, written through the member's
 * agent in the service's two steps. `review` asks the service for the preview, which names who it posts as and who
 * can read it before anything leaves the phone; `save` writes exactly what the preview showed.
 *
 * A new note carries one id for as long as its editor is open, the same on every retry, so a note that reached the
 * room before an answer was lost is not written twice. The id lives as long as this hook is mounted: whoever renders
 * it must mount it afresh for each note (`RoomNoteEditor` does, rendering its body only while it has a note), or a
 * second note would go out under the first one's id and the room would take it for a retry and drop it.
 *
 * An edit replaces the member's own note with a new version; if the note changed after the preview, nothing is
 * written and the editor offers to read it again. An edit carries no id of its own: a retry after a lost answer
 * prepares against whatever version is current, so it may save one more version with the same words, but never a
 * second note.
 *
 * @module rooms/useRoomNoteWrite
 */
import { useCallback, useRef, useState } from 'react'

import { newEventId } from '../chat/eventId'

import { NOTE_BODY_MAX, NOTE_TITLE_MAX, type RoomsService, type WriteDraft, type WritePreview } from './types'

export type NoteWriteState =
  | { step: 'editing' }
  | { step: 'preparing' }
  | { step: 'confirming'; preview: WritePreview }
  | { step: 'saving'; preview: WritePreview }
  | { step: 'saved'; key: string; version: number }
  /** The note changed after the preview: nothing was written. */
  | { step: 'conflict' }
  /** Couldn't get it ready (`prepare`) or couldn't write it (`save`): the words are kept, to try again. */
  | { step: 'failed'; during: 'prepare' | 'save' }

export interface RoomNoteWrite {
  state: NoteWriteState
  /** Asks for the preview of `title` (trimmed) and `body`; false when there is no title or body to write. */
  review: (title: string, body: string) => boolean
  /** Writes what the preview showed. */
  save: () => void
  /** Back to the words, from the preview or a failure. */
  edit: () => void
}

const isExpired = (e: unknown): boolean => e instanceof Error && e.name === 'RoomsPreviewExpired'
const isConflict = (e: unknown): boolean => e instanceof Error && e.name === 'RoomsConflict'

/** What the service is asked to write: a title is what makes a record a note, so both are required. */
export function noteDraft(title: string, body: string, replaceKey?: string, idempotencyKey?: string): WriteDraft {
  return {
    title: title.trim().slice(0, NOTE_TITLE_MAX),
    body: body.slice(0, NOTE_BODY_MAX),
    ...(replaceKey ? { replaceKey } : idempotencyKey ? { idempotencyKey } : {}),
  }
}

/** `replaceKey`: the member's own note being edited; none writes a new note. */
export function useRoomNoteWrite(
  service: RoomsService | undefined,
  roomId: string,
  replaceKey?: string
): RoomNoteWrite {
  const [state, setState] = useState<NoteWriteState>({ step: 'editing' })
  // One id per mount (see above): a new note's retries are the same write. An edit is keyed by the note it replaces.
  const noteId = useRef(newEventId()).current
  const draft = useRef<WriteDraft | undefined>(undefined)

  const review = useCallback(
    (title: string, body: string) => {
      const next = noteDraft(title, body, replaceKey, noteId)
      if (!service || !next.title || !next.body.trim()) return false
      draft.current = next
      setState({ step: 'preparing' })
      service
        .prepareWrite(roomId, next)
        .then((preview) => setState({ step: 'confirming', preview }))
        .catch(() => setState({ step: 'failed', during: 'prepare' }))
      return true
    },
    [service, roomId, replaceKey, noteId]
  )

  const save = useCallback(() => {
    if (!service || !draft.current || state.step !== 'confirming') return
    const written = draft.current
    const { preview } = state
    setState({ step: 'saving', preview })
    const write = async () => {
      try {
        return await service.confirmWrite(preview.token)
      } catch (e) {
        // A preview gone stale (an app sent to the background on the sheet): prepare the same words once more.
        if (!isExpired(e)) throw e
        return service.confirmWrite((await service.prepareWrite(roomId, written)).token)
      }
    }
    write()
      .then(({ key, version }) => setState({ step: 'saved', key, version }))
      .catch((e) => setState(isConflict(e) ? { step: 'conflict' } : { step: 'failed', during: 'save' }))
  }, [service, roomId, state])

  const edit = useCallback(() => setState({ step: 'editing' }), [])

  return { state, review, save, edit }
}
