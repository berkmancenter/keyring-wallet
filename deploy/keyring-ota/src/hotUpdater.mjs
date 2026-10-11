/**
 * The hot-updater server instance: bundle metadata in SQLite, bundles on disk.
 * `npm run db:migrate` reads this file to create the schema.
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { createHotUpdater } from '@hot-updater/server'
import { kyselyAdapter } from '@hot-updater/server/adapters/kysely'
import Database from 'better-sqlite3'
import { Kysely, SqliteDialect } from 'kysely'

import { createDiskStore, diskStoragePlugin } from './diskStorage.mjs'

const dataDir = path.resolve(process.env.OTA_DATA_DIR ?? 'data')
mkdirSync(path.join(dataDir, 'files'), { recursive: true })

export const publicUrl = () => (process.env.OTA_PUBLIC_URL ?? 'http://localhost:3080').replace(/\/+$/, '')

export const store = createDiskStore({ filesDir: path.join(dataDir, 'files'), publicUrl })

const db = new Kysely({ dialect: new SqliteDialect({ database: new Database(path.join(dataDir, 'ota.db')) }) })

export const hotUpdater = createHotUpdater({
  database: kyselyAdapter({ db, provider: 'sqlite' }),
  storages: [diskStoragePlugin(store)],
  basePath: '/hot-updater',
  // Update checks for phones; bundle management for the publisher (token-protected in server.mjs).
  routes: { updateCheck: true, bundles: true },
})
