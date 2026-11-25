import { getEmojiSet } from '../data'
import { offeredGroups, searchEmoji, toRows } from '../search'

const set = getEmojiSet()
const ALL = 99

describe('offeredGroups', () => {
  it('offers base emoji only, no skin-tone variants', () => {
    const offered = offeredGroups(set, ALL).flatMap((g) => g.entries)
    expect(offered.some((e) => e.skinTone)).toBe(false)
    expect(offered.map((e) => e.emoji)).toContain('👍')
    expect(offered.map((e) => e.emoji)).not.toContain('👍🏽')
  })

  it('hides every emoji newer than the device can draw', () => {
    const offered = offeredGroups(set, 13.0).flatMap((g) => g.entries)
    expect(offered.length).toBeGreaterThan(1000)
    expect(offered.every((e) => e.version <= 13.0)).toBe(true)
    expect(offered.map((e) => e.emoji)).not.toContain('🫠') // melting face, 14.0
  })

  it('keeps the Unicode group order and drops a group left empty', () => {
    expect(offeredGroups(set, ALL).map((g) => g.group)).toEqual([
      'Smileys & Emotion',
      'People & Body',
      'Animals & Nature',
      'Food & Drink',
      'Travel & Places',
      'Activities',
      'Objects',
      'Symbols',
      'Flags',
    ])
    expect(offeredGroups(set, 0)).toHaveLength(0)
  })
})

describe('searchEmoji', () => {
  it('finds 🐱 for "cat"', () => {
    expect(searchEmoji(set, 'cat', ALL).map((e) => e.emoji)).toContain('🐱')
  })

  it('matches every word of the query against name and keywords, case-insensitively', () => {
    const hits = searchEmoji(set, 'Red Heart', ALL).map((e) => e.emoji)
    expect(hits[0]).toBe('❤️')
    expect(searchEmoji(set, 'thumbs', ALL).map((e) => e.emoji)).toContain('👍')
  })

  it('puts exact word matches before prefix matches', () => {
    const hits = searchEmoji(set, 'cat', ALL)
    const firstPrefixOnly = hits.findIndex(
      (e) => ![...e.name.toLowerCase().split(/[\s:,]+/), ...e.keywords].includes('cat')
    )
    const lastExact = hits
      .map((e) => [...e.name.toLowerCase().split(/[\s:,]+/), ...e.keywords].includes('cat'))
      .lastIndexOf(true)
    if (firstPrefixOnly !== -1) expect(lastExact).toBeLessThan(firstPrefixOnly)
  })

  it('never returns skin-tone variants or emoji above the limit', () => {
    const hits = searchEmoji(set, 'face', 13.0, 1000)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((e) => !e.skinTone && e.version <= 13.0)).toBe(true)
  })

  it('returns nothing for an empty query or one that matches nothing', () => {
    expect(searchEmoji(set, '   ', ALL)).toEqual([])
    expect(searchEmoji(set, 'zzqqxx', ALL)).toEqual([])
  })

  it('caps the number of results', () => {
    expect(searchEmoji(set, 'a', ALL, 10)).toHaveLength(10)
  })
})

describe('toRows', () => {
  it('splits into rows of the column count, the last one short', () => {
    expect(toRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(toRows([], 8)).toEqual([])
  })
})
