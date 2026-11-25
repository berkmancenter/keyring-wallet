/**
 * Unit tests for PersistentJsonStore
 *
 * Verifies file-backed key-value store behaviour:
 * - CRUD operations
 * - Persistence across instances (simulating a server restart)
 * - Graceful handling of missing / corrupt files
 * - Directory auto-creation
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import path from 'path'
import os from 'os'
import { PersistentJsonStore } from '../../src/PersistentJsonStore'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `pjs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PersistentJsonStore', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
  })

  afterEach(() => {
    cleanup(dir)
  })

  // ── Basic CRUD ────────────────────────────────────────────────────────────

  describe('set / get', () => {
    it('returns undefined for an unknown key', () => {
      const store = new PersistentJsonStore<string>(path.join(dir, 'store.json'))
      expect(store.get('missing')).toBeUndefined()
    })

    it('stores and retrieves a string value', () => {
      const store = new PersistentJsonStore<string>(path.join(dir, 'store.json'))
      store.set('key1', 'hello')
      expect(store.get('key1')).toBe('hello')
    })

    it('stores and retrieves an object value', () => {
      const store = new PersistentJsonStore<{ a: number }>(path.join(dir, 'store.json'))
      store.set('obj', { a: 42 })
      expect(store.get('obj')).toEqual({ a: 42 })
    })

    it('overwrites an existing value', () => {
      const store = new PersistentJsonStore<string>(path.join(dir, 'store.json'))
      store.set('key', 'first')
      store.set('key', 'second')
      expect(store.get('key')).toBe('second')
    })
  })

  describe('has', () => {
    it('returns false when key does not exist', () => {
      const store = new PersistentJsonStore<string>(path.join(dir, 'store.json'))
      expect(store.has('nope')).toBe(false)
    })

    it('returns true when key exists', () => {
      const store = new PersistentJsonStore<string>(path.join(dir, 'store.json'))
      store.set('x', 'y')
      expect(store.has('x')).toBe(true)
    })
  })

  describe('delete', () => {
    it('removes a key that was set', () => {
      const store = new PersistentJsonStore<string>(path.join(dir, 'store.json'))
      store.set('del', 'value')
      store.delete('del')
      expect(store.get('del')).toBeUndefined()
      expect(store.has('del')).toBe(false)
    })

    it('does not throw when deleting a missing key', () => {
      const store = new PersistentJsonStore<string>(path.join(dir, 'store.json'))
      expect(() => store.delete('ghost')).not.toThrow()
    })
  })

  describe('size / getAll', () => {
    it('starts empty', () => {
      const store = new PersistentJsonStore<string>(path.join(dir, 'store.json'))
      expect(store.size()).toBe(0)
      expect(store.getAll()).toEqual({})
    })

    it('size grows with insertions', () => {
      const store = new PersistentJsonStore<number>(path.join(dir, 'store.json'))
      store.set('a', 1)
      store.set('b', 2)
      expect(store.size()).toBe(2)
    })

    it('getAll returns a shallow copy', () => {
      const store = new PersistentJsonStore<string>(path.join(dir, 'store.json'))
      store.set('k', 'v')
      const all = store.getAll()
      all['k'] = 'mutated'
      // Original store should not be affected
      expect(store.get('k')).toBe('v')
    })
  })

  // ── Persistence (simulating restart) ─────────────────────────────────────

  describe('persistence across instances', () => {
    it('reloads data written by a previous instance', () => {
      const filePath = path.join(dir, 'persist.json')
      const store1 = new PersistentJsonStore<string>(filePath)
      store1.set('did:peer:alice', 'did:peer:reporting-alice')
      store1.set('did:peer:bob', 'did:peer:reporting-bob')

      // Simulate restart — new instance reading same file
      const store2 = new PersistentJsonStore<string>(filePath)
      expect(store2.get('did:peer:alice')).toBe('did:peer:reporting-alice')
      expect(store2.get('did:peer:bob')).toBe('did:peer:reporting-bob')
      expect(store2.size()).toBe(2)
    })

    it('does not see data deleted before restart', () => {
      const filePath = path.join(dir, 'persist2.json')
      const store1 = new PersistentJsonStore<string>(filePath)
      store1.set('keep', 'yes')
      store1.set('remove', 'no')
      store1.delete('remove')

      const store2 = new PersistentJsonStore<string>(filePath)
      expect(store2.get('keep')).toBe('yes')
      expect(store2.get('remove')).toBeUndefined()
    })
  })

  // ── Edge cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('starts fresh when file does not exist', () => {
      const store = new PersistentJsonStore<string>(path.join(dir, 'nonexistent.json'))
      expect(store.size()).toBe(0)
    })

    it('starts fresh when file contains corrupt JSON', () => {
      const filePath = path.join(dir, 'corrupt.json')
      writeFileSync(filePath, '{ this is not valid json }', 'utf-8')
      const store = new PersistentJsonStore<string>(filePath)
      expect(store.size()).toBe(0)
    })

    it('auto-creates nested parent directories', () => {
      const nested = path.join(dir, 'a', 'b', 'c', 'store.json')
      expect(() => new PersistentJsonStore<string>(nested)).not.toThrow()
      expect(existsSync(path.dirname(nested))).toBe(true)
    })

    it('handles idempotent set (same value)', () => {
      const store = new PersistentJsonStore<string>(path.join(dir, 'idem.json'))
      store.set('k', 'v')
      store.set('k', 'v')
      expect(store.size()).toBe(1)
    })
  })
})
