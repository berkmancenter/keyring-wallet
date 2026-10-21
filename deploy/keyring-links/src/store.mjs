/**
 * The link store: one file per link, `<id>.json` =
 * {"expiresAt": <ms>, "invitation": "<json text>", "fetched": true?}.
 * Nothing else is kept: no IP, no fetch count or time.
 *
 * Lifetime: a new link expires after `unfetchedTtlMs` (24 h). The first fetch marks
 * it fetched and extends it to `fetchedTtlMs` (7 days) from its creation. A link is
 * not consumed on fetch (message previews fetch it). So a link nobody opens, such
 * as one made to fill the store, is gone in a day.
 *
 * Each file's mtime is set to its expiry, so a sweep needs only a stat per file,
 * never a read. The file's content stays the authority when a link is read.
 *
 * The number of stored links is kept in memory: counted once at start, adjusted on
 * put and on removal, and re-anchored by each sweep. So a POST never lists the
 * directory. When the store looks full, expired links are swept before refusing,
 * at most once every FULL_SWEEP_INTERVAL_MS, so a store full of live links isn't
 * re-scanned on every POST.
 */
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ID_RE } from './links.mjs'

const FULL_SWEEP_INTERVAL_MS = 10 * 60_000

export const createStore = ({ dir, unfetchedTtlMs, fetchedTtlMs, maxLinks, now = () => Date.now() }) => {
  const fileFor = (id) => {
    if (!ID_RE.test(id)) throw new Error('invalid id')
    return path.join(dir, `${id}.json`)
  }

  const listIds = async () =>
    (await readdir(dir)).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5))

  /** Write a record atomically, with mtime = its expiry. */
  const write = async (id, record) => {
    const file = fileFor(id)
    const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
    await writeFile(tmp, JSON.stringify(record), { mode: 0o600, flag: 'wx' })
    const expires = new Date(record.expiresAt)
    await utimes(tmp, expires, expires)
    await rename(tmp, file)
  }

  let count = 0
  let lastFullSweep = -Infinity
  const ready = (async () => {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    count = (await listIds()).length
  })()

  /** Remove one link's file, keeping the count right. */
  const remove = async (id) => {
    try {
      await rm(fileFor(id))
      count = Math.max(0, count - 1)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  const store = {
    /** Store an invitation under a new id; false when the store is full. */
    async put(id, invitationText) {
      await ready
      if (count >= maxLinks && now() - lastFullSweep >= FULL_SWEEP_INTERVAL_MS) {
        lastFullSweep = now()
        await store.sweep()
      }
      if (count >= maxLinks) return false
      const expiresAt = now() + unfetchedTtlMs
      await write(id, { expiresAt, invitation: invitationText })
      count += 1
      return { expiresAt }
    },

    /**
     * The stored invitation text, or null if unknown or expired (an expired file is
     * removed). The first fetch extends the link to fetchedTtlMs from its creation.
     */
    async fetch(id) {
      await ready
      if (!ID_RE.test(id)) return null
      let record
      try {
        record = JSON.parse(await readFile(fileFor(id), 'utf8'))
      } catch {
        return null
      }
      if (typeof record?.expiresAt !== 'number' || record.expiresAt <= now()) {
        await remove(id)
        return null
      }
      if (record.fetched !== true) {
        // Extend to the fetched lifetime. If that write fails (a full disk, the very
        // case a flood produces), still serve the link: failing to extend costs it the
        // 7-day life, not the rest of its current one.
        const createdAt = record.expiresAt - unfetchedTtlMs
        const extended = { expiresAt: createdAt + fetchedTtlMs, invitation: record.invitation, fetched: true }
        try {
          await write(id, extended)
          record = extended
        } catch {
          // Keep the current record; the next fetch tries again.
        }
      }
      return { invitation: record.invitation, expiresAt: record.expiresAt }
    },

    /** Remove every expired link (by mtime) and stale temp files; returns how many links were removed. */
    async sweep() {
      await ready
      const t = now()
      let removed = 0
      for (const name of await readdir(dir)) {
        const file = path.join(dir, name)
        if (name.includes('.json.tmp-')) {
          // A crash between write and rename leaves one. A temp file's mtime is its
          // record's expiry, so drop those already expired, plus any unknown leftovers.
          const info = await stat(file).catch(() => null)
          if (info && info.mtimeMs <= t) await rm(file, { force: true })
          continue
        }
        if (!name.endsWith('.json') || !ID_RE.test(name.slice(0, -5))) continue
        const info = await stat(file).catch(() => null)
        if (info && info.mtimeMs <= t) {
          await rm(file, { force: true })
          removed += 1
        }
      }
      // Re-anchor the in-memory count on what is actually there.
      count = (await listIds()).length
      return removed
    },

    count: async () => {
      await ready
      return count
    },
  }
  return store
}
