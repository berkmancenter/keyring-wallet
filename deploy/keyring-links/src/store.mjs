/**
 * The link store: one file per link, `<id>.json` = {"expiresAt": <ms>, "invitation": "<json text>"}.
 * Nothing else is kept: no creation time beyond expiry, no IP, no fetch count.
 * A link is not consumed on fetch (message previews fetch it); it lives until it expires.
 *
 * The number of stored links is kept in memory: counted once at start, adjusted on
 * put and on removal, and re-anchored by each sweep. So a POST never lists the
 * directory. When the store looks full, expired links are swept before refusing
 * (at most once a minute, so a store full of live links isn't re-read on every
 * POST); a store full of links that have already expired does not refuse new
 * ones until the hourly sweep.
 */
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ID_RE } from './links.mjs'

const FULL_SWEEP_INTERVAL_MS = 60_000

export const createStore = ({ dir, ttlMs, maxLinks, now = () => Date.now() }) => {
  const fileFor = (id) => {
    if (!ID_RE.test(id)) throw new Error('invalid id')
    return path.join(dir, `${id}.json`)
  }

  const listIds = async () =>
    (await readdir(dir)).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5))

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
      const expiresAt = now() + ttlMs
      const file = fileFor(id)
      const tmp = `${file}.tmp-${process.pid}`
      await writeFile(tmp, JSON.stringify({ expiresAt, invitation: invitationText }), { mode: 0o600, flag: 'wx' })
      await rename(tmp, file)
      count += 1
      return { expiresAt }
    },

    /** The stored invitation text, or null if unknown or expired (an expired file is removed). */
    async get(id) {
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
      return { invitation: record.invitation, expiresAt: record.expiresAt }
    },

    /** Remove every expired link (and stale temp files); returns how many links were removed. */
    async sweep() {
      await ready
      // A crash between write and rename leaves a temp file; drop those older than a
      // minute (a younger one may belong to a put in flight).
      for (const name of await readdir(dir)) {
        if (!name.includes('.json.tmp-')) continue
        const file = path.join(dir, name)
        const info = await stat(file).catch(() => null)
        if (info && now() - info.mtimeMs > 60_000) await rm(file, { force: true })
      }
      let removed = 0
      for (const id of await listIds()) {
        if (!ID_RE.test(id)) continue
        if ((await store.get(id)) === null) removed += 1
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
