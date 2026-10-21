/**
 * The link store: one file per link, `<id>.json` = {"expiresAt": <ms>, "invitation": "<json text>"}.
 * Nothing else is kept: no creation time beyond expiry, no IP, no fetch count.
 * A link is not consumed on fetch (message previews fetch it); it lives until it expires.
 */
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ID_RE } from './links.mjs'

export const createStore = ({ dir, ttlMs, maxLinks, now = () => Date.now() }) => {
  const fileFor = (id) => {
    if (!ID_RE.test(id)) throw new Error('invalid id')
    return path.join(dir, `${id}.json`)
  }

  const ready = mkdir(dir, { recursive: true, mode: 0o700 })

  const ids = async () => {
    await ready
    return (await readdir(dir)).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5))
  }

  return {
    /** Store an invitation under a new id; false when the store is full. */
    async put(id, invitationText) {
      await ready
      if ((await ids()).length >= maxLinks) return false
      const expiresAt = now() + ttlMs
      const file = fileFor(id)
      const tmp = `${file}.tmp-${process.pid}`
      await writeFile(tmp, JSON.stringify({ expiresAt, invitation: invitationText }), { mode: 0o600, flag: 'wx' })
      await rename(tmp, file)
      return { expiresAt }
    },

    /** The stored invitation text, or null if unknown or expired (an expired file is removed). */
    async get(id) {
      if (!ID_RE.test(id)) return null
      let record
      try {
        record = JSON.parse(await readFile(fileFor(id), 'utf8'))
      } catch {
        return null
      }
      if (typeof record?.expiresAt !== 'number' || record.expiresAt <= now()) {
        await rm(fileFor(id), { force: true })
        return null
      }
      return { invitation: record.invitation, expiresAt: record.expiresAt }
    },

    /** Remove every expired link; returns how many were removed. */
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
      for (const id of await ids()) {
        if (!ID_RE.test(id)) continue
        if ((await this.get(id)) === null) removed += 1
      }
      return removed
    },

    count: async () => (await ids()).length,
  }
}
