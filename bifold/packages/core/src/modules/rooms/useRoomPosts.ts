/**
 * A room's posts as RoomView shows them: newest first, {@link POSTS_PAGE} at a time, "load older" for the next
 * page, and a refresh (pull down) that reads the room again. Nothing pushes a post to a phone yet, so a refresh is
 * how new ones arrive.
 *
 * Until the rooms service pages from the newest itself, this lists the room once and reads each shown record:
 * a record that can't be read stays in its place as "couldn't be read", never hiding the rest.
 *
 * @module rooms/useRoomPosts
 */
import { useCallback, useEffect, useState } from 'react'

import { newestFirst, postOf, type RoomPost } from './roomPosts'
import type { HostCheck, Identity, NoteSummary, RoomsService } from './types'

export const POSTS_PAGE = 30

export interface RoomPosts {
  /** Newest first. Undefined until the first page is read. */
  posts?: RoomPost[]
  /** More, older posts can be loaded. */
  hasOlder: boolean
  /** The agent's check of the host's answer; a `conflict` is shown above the posts. */
  check?: HostCheck
  /** The host's listing stopped early. */
  incomplete: boolean
  /** The room could not be listed; what was shown before stays. */
  failed: boolean
  refreshing: boolean
  loadingOlder: boolean
  loadOlder: () => void
  refresh: () => void
}

export function useRoomPosts(
  service: RoomsService | undefined,
  roomId: string,
  actingAs: Identity | undefined,
  enabled: boolean
): RoomPosts {
  const [listing, setListing] = useState<{ notes: NoteSummary[]; check: HostCheck; complete: boolean }>()
  const [shown, setShown] = useState(POSTS_PAGE)
  const [posts, setPosts] = useState<RoomPost[]>()
  const [failed, setFailed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (!service || !enabled) return
    let live = true
    service.listNotes(roomId).then(
      (list) => {
        if (!live) return
        setListing({ notes: newestFirst(list.notes), check: list.check, complete: list.complete })
        setFailed(false)
      },
      () => {
        if (!live) return
        setFailed(true)
        setRefreshing(false)
      }
    )
    return () => {
      live = false
    }
  }, [service, roomId, enabled, generation])

  useEffect(() => {
    if (!service || !listing) return
    let live = true
    const page = listing.notes.slice(0, shown)
    void Promise.allSettled(
      page.map((summary) =>
        summary.status === 'retracted' ? Promise.resolve(summary) : service.readNote(roomId, summary.key)
      )
    ).then((results) => {
      if (!live) return
      setPosts(results.map((r, i) => postOf(r.status === 'fulfilled' ? r.value : page[i], actingAs)))
      setRefreshing(false)
      setLoadingOlder(false)
    })
    return () => {
      live = false
    }
  }, [service, roomId, listing, shown, actingAs])

  const loadOlder = useCallback(() => {
    setLoadingOlder(true)
    setShown((n) => n + POSTS_PAGE)
  }, [])
  const refresh = useCallback(() => {
    setRefreshing(true)
    setShown(POSTS_PAGE)
    setGeneration((g) => g + 1)
  }, [])

  return {
    posts,
    hasOlder: !!listing && listing.notes.length > shown,
    check: listing?.check,
    incomplete: !!listing && !listing.complete,
    failed,
    refreshing,
    loadingOlder,
    loadOlder,
    refresh,
  }
}
