import assert from 'node:assert/strict'
import { test } from 'node:test'

import Database from 'better-sqlite3'

import { withBooleanBinding } from './sqliteBooleans.mjs'

test('plain better-sqlite3 refuses booleans, the wrapped one stores them as 1/0', () => {
  const raw = new Database(':memory:')
  raw.exec('create table bundles (id text, enabled integer, should_force_update integer)')
  assert.throws(() => raw.prepare('insert into bundles values (?, ?, ?)').run(['a', true, false]), /can only bind/)

  const db = withBooleanBinding(raw)
  db.prepare('insert into bundles values (?, ?, ?)').run(['b', true, false])
  assert.deepEqual(db.prepare('select * from bundles where enabled = ?').all([true]), [
    { id: 'b', enabled: 1, should_force_update: 0 },
  ])
  assert.equal(db.prepare('select count(*) as n from bundles').reader, true)
})
