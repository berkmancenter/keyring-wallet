/**
 * The reactions, quotes and earlier authors for the posts on a room's screen. A reply's target is usually on the page
 * already and costs nothing; one beyond it is read once, through the same read as any record, and a read that fails
 * marks it as not available. Nothing else is fetched because a record names it.
 *
 * @module rooms/useRoomThread
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import { postOf, type RoomPost, withRepliesToReactions } from './roomPosts'
import { foldRoomRecords, type HeldRecord, type RoomThread } from './roomThread'
import type { Identity, RoomsService } from './types'

export interface RoomThreadView extends RoomThread {
  /** The posts, with any that name a reaction read for a quote marked as answering one. */
  posts: RoomPost[]
  targets: ReadonlyMap<string, RoomPost>
  missing: ReadonlySet<string>
  held: ReadonlyMap<string, HeldRecord>
}

const NONE: RoomPost[] = []

export function useRoomThread(
  service: RoomsService | undefined,
  roomId: string,
  actingAs: Identity | undefined,
  feedPosts: RoomPost[] | undefined
): RoomThreadView {
  const posts = feedPosts ?? NONE
  const [targets, setTargets] = useState<ReadonlyMap<string, RoomPost>>(new Map())
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set())
  const asked = useRef(new Set<string>())
  const heldNow = useRef(new Map<string, HeldRecord>())
  const scope = useRef(roomId)
  if (scope.current !== roomId) {
    scope.current = roomId
    asked.current = new Set()
    heldNow.current = new Map()
  }
  useEffect(() => {
    setTargets(new Map())
    setMissing(new Set())
  }, [roomId])

  const offPage = useMemo(() => {
    const onPage = new Set(posts.map((post) => post.key))
    // Only a reply's quote is worth a read: a reaction waits until its target comes onto the page.
    const named = posts.flatMap((post) => (post.inReplyTo && post.kind !== 'reaction' ? [post.inReplyTo.key] : []))
    return [...new Set(named)].filter((key) => !onPage.has(key))
  }, [posts])
  useEffect(() => {
    if (!service) return
    for (const key of offPage) {
      if (asked.current.has(key)) continue
      asked.current.add(key)
      // Kept whenever it lands while this room is on screen: the page changing under it must not lose the answer, since
      // a key already asked is never asked again.
      service.readNote(roomId, key).then(
        (note) => {
          if (scope.current === roomId) setTargets((now) => new Map(now).set(key, postOf(note, actingAs)))
        },
        () => {
          if (scope.current === roomId) setMissing((now) => new Set(now).add(key))
        }
      )
    }
  }, [service, roomId, actingAs, offPage])

  return useMemo(() => {
    // Only what was read: a listing entry doesn't say what a record is, and the first version seen stays.
    for (const post of posts) {
      if (post.unread || post.retracted || heldNow.current.has(post.key)) continue
      heldNow.current.set(post.key, {
        author: post.author,
        kind: post.kind,
        reactsTo: post.kind === 'reaction' ? post.inReplyTo?.key : undefined,
      })
    }
    const marked = targets.size ? withAnswersToTargets(posts, targets) : posts
    return {
      ...foldRoomRecords(marked, targets, heldNow.current),
      posts: marked,
      targets,
      missing,
      held: heldNow.current,
    }
  }, [posts, targets, missing])
}

/** A record naming a reaction that was read only as a target is ignored like one naming a reaction on the page. */
const withAnswersToTargets = (posts: RoomPost[], targets: ReadonlyMap<string, RoomPost>): RoomPost[] => {
  const marked = withRepliesToReactions([...posts, ...targets.values()])
  return marked.slice(0, posts.length)
}
