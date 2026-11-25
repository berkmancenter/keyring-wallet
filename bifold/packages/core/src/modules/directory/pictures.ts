/**
 * Members' pictures, as the directory shows them (VTC 0.13 and later): read with `images/get` only where a card names
 * one, and shown only once the bytes match the digest the card named (`AgentDirectoryService.showPicture`).
 *
 * Pictures are kept in memory only, for this run, by community and digest: never on disk, and never by entry or by
 * member, so nothing here can be read back as a list of who is in a community. At most {@link PICTURE_READS_AT_ONCE}
 * are read at a time, so a members page doesn't queue two dozen reads ahead of the community's other tasks. A picture
 * that could not be read is asked for again only when a screen next shows it.
 *
 * "Your card" on a community's screen shows the member's own picture once the Your card screen has read the card in
 * this run: that row never reads the card itself (`card/show` creates one).
 *
 * @module directory/pictures
 */
import { useEffect, useState, useSyncExternalStore } from 'react'

import type { CardPicture, DirectoryService } from './types'

/** How many pictures are kept, the least recently shown dropped first. */
export const PICTURES_KEPT = 64
/** How many pictures are read at once. */
export const PICTURE_READS_AT_ONCE = 2

// What a read answered, by community and digest: the `data:` URI, or null for no picture to show.
const kept = new Map<string, string | null>()
const reading = new Map<string, Promise<string | null>>()
const waiting: Array<() => void> = []
let running = 0

const keyOf = (communityDid: string, picture: CardPicture) => `${communityDid}\n${picture.sha256}`

function keep(key: string, value: string | null) {
  kept.delete(key)
  kept.set(key, value)
  while (kept.size > PICTURES_KEPT) kept.delete(kept.keys().next().value as string)
}

async function inTurn<T>(work: () => Promise<T>): Promise<T> {
  if (running >= PICTURE_READS_AT_ONCE) await new Promise<void>((go) => waiting.push(go))
  running++
  try {
    return await work()
  } finally {
    running--
    waiting.shift()?.()
  }
}

function read(service: DirectoryService, communityDid: string, entryId: string, picture: CardPicture) {
  const key = keyOf(communityDid, picture)
  const already = reading.get(key)
  if (already) return already
  const next = inTurn(() => service.showPicture(communityDid, entryId, picture))
    .then((uri) => {
      keep(key, uri ?? null)
      return uri ?? null
    })
    // A read that failed (no answer) is not kept: the next screen that shows the picture asks again.
    .catch(() => null)
    .finally(() => reading.delete(key))
  reading.set(key, next)
  return next
}

/**
 * The picture a card names, as a `data:` URI to show; undefined while it is read, and when there is none to show (no
 * picture, not shown to you, bytes that don't match, no answer): the screen shows initials instead.
 */
export function useDirectoryPicture(
  service: DirectoryService | undefined,
  communityDid: string,
  entryId: string | undefined,
  picture: CardPicture | undefined
): string | undefined {
  const key = picture ? keyOf(communityDid, picture) : undefined
  const [shown, setShown] = useState<{ key?: string; uri?: string }>(() => ({
    key,
    uri: key ? (kept.get(key) ?? undefined) : undefined,
  }))

  useEffect(() => {
    if (!key || !picture) return
    const known = kept.get(key)
    if (known !== undefined) {
      keep(key, known)
      setShown({ key, uri: known ?? undefined })
      return
    }
    if (!service || !entryId) return
    let live = true
    void read(service, communityDid, entryId, picture).then((uri) => {
      if (live) setShown({ key, uri: uri ?? undefined })
    })
    return () => {
      live = false
    }
    // `picture` is named by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, communityDid, entryId, key])

  return shown.key === key ? shown.uri : undefined
}

// The member's own entry and picture, by community, as the Your card screen last read the card this run.
const mine = new Map<string, { entryId: string; picture?: CardPicture }>()
const listeners = new Set<() => void>()

/** Called by the Your card screen with each card it reads, so the community's screen can show the same picture. */
export function noteMyCardPicture(communityDid: string, entryId: string, picture: CardPicture | undefined): void {
  const was = mine.get(communityDid)
  if (was?.entryId === entryId && was.picture?.sha256 === picture?.sha256) return
  mine.set(communityDid, { entryId, picture })
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The member's own entry and picture in a community, once Your card was read this run. */
export function useMyCardPicture(communityDid: string): { entryId: string; picture?: CardPicture } | undefined {
  return useSyncExternalStore(subscribe, () => mine.get(communityDid))
}

/** Forget every picture, read and noted (tests). */
export function resetDirectoryPictures(): void {
  kept.clear()
  reading.clear()
  mine.clear()
  waiting.splice(0).forEach((go) => go())
  running = 0
}
