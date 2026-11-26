/**
 * Tests for pseudonym utility
 */

import { describe, it, expect } from '@jest/globals'
import { generatePseudonym } from './pseudonym'

describe('pseudonym', () => {
  describe('generatePseudonym', () => {
    it('generates the same pseudonym for the same DID', () => {
      const did = 'did:peer:2.Ez6LSbty7ZpE4f5tLQVq5aL6GnXfXqTbL4d7f5g5d5x4'
      const pseudo1 = generatePseudonym(did)
      const pseudo2 = generatePseudonym(did)
      expect(pseudo1).toBe(pseudo2)
      expect(pseudo1).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
    })

    it('generates different pseudonyms for different DIDs', () => {
      const did1 = 'did:peer:2.Ez6LSbty7ZpE4f5tLQVq5aL6GnXfXqTbL4d7f5g5d5x4'
      const did2 = 'did:peer:2.Ez7LSbty8ZpE5g6uMRWr6bM7HoYgYrUcM5e8g6h6e6y5'
      const pseudo1 = generatePseudonym(did1)
      const pseudo2 = generatePseudonym(did2)
      expect(pseudo1).not.toBe(pseudo2)
    })

    it('generates pseudonyms with correct format', () => {
      const did = 'did:peer:2.Ez6LSbty7ZpE4f5tLQVq5aL6GnXfXqTbL4d7f5g5d5x4'
      const pseudo = generatePseudonym(did)
      // Should be "FirstName LastName"
      expect(pseudo).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
    })

    it('generates pseudonyms using different name categories', () => {
      const dids = [
        'did:peer:2.Ez6LSbty7ZpE4f5tLQVq5aL6GnXfXqTbL4d7f5g5d5x4',
        'did:peer:2.Ez7LSbty8ZpE5g6uMRWr6bM7HoYgYrUcM5e8g6h6e6y5',
        'did:peer:2.Ez8LSbty9ZpE6h7vNSXs7cN8IpZhZsVdN6f9i7i7f7z6',
        'did:peer:2.Ez9LSbty0ZqE7i8wOTYt8dO9JqAiAtWeO7g0j8j8g8a7',
      ]
      const pseudonyms = dids.map((d) => generatePseudonym(d))
      const uniqueCategories = new Set(
        pseudonyms.map((p) => {
          const [first] = p.split(' ')
          return first
        })
      )
      // With 4 different DIDs, we should get at least 2 different first names
      // (showing it uses multiple categories)
      expect(uniqueCategories.size).toBeGreaterThanOrEqual(2)
    })
  })
})
