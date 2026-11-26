/**
 * PersistentJsonStore - A simple file-backed key-value store
 *
 * Provides synchronous read/write access to a JSON file so that small
 * data sets (e.g., reporting DIDs, graph edges) survive process restarts
 * without requiring a full database.
 *
 * Writes are synchronous so that data is never lost on unclean shutdown.
 * For large data sets, replace with a proper database.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'

export class PersistentJsonStore<T> {
  private data: Record<string, T> = {}
  private readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
    // Ensure parent directory exists
    const dir = path.dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    this.load()
  }

  get(key: string): T | undefined {
    return this.data[key]
  }

  set(key: string, value: T): void {
    this.data[key] = value
    this.save()
  }

  delete(key: string): void {
    delete this.data[key]
    this.save()
  }

  has(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.data, key)
  }

  getAll(): Record<string, T> {
    return { ...this.data }
  }

  size(): number {
    return Object.keys(this.data).length
  }

  // ──────────────────────────────────────────────────────────────────────────
  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const content = readFileSync(this.filePath, 'utf-8')
      this.data = JSON.parse(content)
    } catch {
      // Corrupt or empty file — start fresh
      this.data = {}
    }
  }

  private save(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
    } catch (error) {
      console.warn(`[PersistentJsonStore] Failed to save ${this.filePath}: ${(error as Error).message}`)
    }
  }
}
