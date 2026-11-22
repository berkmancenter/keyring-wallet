import { getEmojiSet } from '../data'
import { MAX_EMOJI_LENGTH, emojiName, emojiVersion, normalizeEmoji } from '../validate'

describe('normalizeEmoji', () => {
  it('accepts a fully-qualified emoji as it is', () => {
    expect(normalizeEmoji('👍')).toBe('👍')
    expect(normalizeEmoji('❤️')).toBe('❤️')
  })

  it('normalises a minimally-qualified or unqualified form to the fully-qualified one', () => {
    expect(normalizeEmoji('❤')).toBe('❤️') // ❤ → ❤️
    expect(normalizeEmoji('1⃣')).toBe('1️⃣') // keycap 1
    expect(normalizeEmoji('\u{1F3F3}‍\u{1F308}')).toBe('\u{1F3F3}️‍\u{1F308}') // rainbow flag
  })

  it('accepts skin-tone variants, ZWJ sequences, keycaps and flags', () => {
    expect(normalizeEmoji('👍🏽')).toBe('👍🏽')
    expect(normalizeEmoji('👨‍👩‍👧')).toBe('👨‍👩‍👧')
    expect(normalizeEmoji('🧑🏻‍❤️‍💋‍🧑🏼')).toBe('🧑🏻‍❤️‍💋‍🧑🏼')
    expect(normalizeEmoji('#️⃣')).toBe('#️⃣')
    expect(normalizeEmoji('🇲🇽')).toBe('🇲🇽')
    expect(normalizeEmoji('🏴󠁧󠁢󠁳󠁣󠁴󠁿')).toBe('🏴󠁧󠁢󠁳󠁣󠁴󠁿')
  })

  it('rejects two emoji where one is expected', () => {
    expect(normalizeEmoji('👍👍')).toBeUndefined()
    expect(normalizeEmoji('❤️👍')).toBeUndefined()
    expect(normalizeEmoji('🇲🇽🇲🇽')).toBeUndefined()
  })

  it('rejects text, components on their own, and broken sequences', () => {
    expect(normalizeEmoji('a')).toBeUndefined()
    expect(normalizeEmoji(':+1:')).toBeUndefined()
    expect(normalizeEmoji(' 👍')).toBeUndefined()
    expect(normalizeEmoji('\u{1F3FD}')).toBeUndefined() // a bare skin-tone modifier
    expect(normalizeEmoji('‍')).toBeUndefined()
    expect(normalizeEmoji('\u{1F1F2}')).toBeUndefined() // half a flag
  })

  // A received reaction is untrusted: a name that exists on every plain object
  // must not pass as an emoji (review of #552).
  it.each(['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__', 'isPrototypeOf', 'toLocaleString'])(
    'rejects %s, which every plain object inherits',
    (name) => {
      expect(normalizeEmoji(name)).toBeUndefined()
      expect(emojiName(name)).toBeUndefined()
      expect(emojiVersion(name)).toBeUndefined()
    }
  )

  it('rejects empty, over-long and non-string input', () => {
    expect(normalizeEmoji('')).toBeUndefined()
    expect(normalizeEmoji('👍'.repeat(MAX_EMOJI_LENGTH))).toBeUndefined()
    expect(normalizeEmoji(undefined)).toBeUndefined()
    expect(normalizeEmoji(1)).toBeUndefined()
    expect(normalizeEmoji({ toString: () => '👍' })).toBeUndefined()
  })

  it('accepts every emoji in the set, all within the length cap', () => {
    const set = getEmojiSet()
    for (const emoji of set.byEmoji.keys()) {
      expect(emoji.length).toBeLessThanOrEqual(MAX_EMOJI_LENGTH)
      expect(normalizeEmoji(emoji)).toBe(emoji)
    }
    for (const [alias, fq] of set.aliases) expect(normalizeEmoji(alias)).toBe(fq)
  })
})

describe('emojiName and emojiVersion', () => {
  it('give the CLDR name and the emoji version, for any accepted form', () => {
    expect(emojiName('🐱')).toBe('cat face')
    expect(emojiName('❤')).toBe('red heart')
    expect(emojiVersion('🐱')).toBe(0.6)
    expect(emojiVersion('🫩')).toBe(16)
  })

  it('give nothing for something that is not an emoji', () => {
    expect(emojiName('cat')).toBeUndefined()
    expect(emojiVersion('👍👍')).toBeUndefined()
  })
})

describe('the emoji set', () => {
  it('is loaded once and reused', () => {
    expect(getEmojiSet()).toBe(getEmojiSet())
  })

  it('marks skin-tone variants so the picker can leave them out', () => {
    const set = getEmojiSet()
    expect(set.byEmoji.get('👍🏽')?.skinTone).toBe(true)
    expect(set.byEmoji.get('👍')?.skinTone).toBe(false)
    expect(set.byEmoji.get('👍')?.keywords).toContain('like')
  })
})
