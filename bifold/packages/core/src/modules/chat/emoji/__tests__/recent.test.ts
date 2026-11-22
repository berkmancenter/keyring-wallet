import { PersistentStorage } from '../../../../services/storage'
import { MAX_RECENT, RECENT_EMOJI_KEY, addRecent, loadRecent, saveRecent } from '../recent'

jest.mock('../../../../services/storage', () => ({
  PersistentStorage: { fetchValueForKey: jest.fn(), storeValueForKey: jest.fn() },
}))

const fetchValue = PersistentStorage.fetchValueForKey as jest.Mock
const storeValue = PersistentStorage.storeValueForKey as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('addRecent', () => {
  it('puts the new emoji first and drops its earlier copy', () => {
    expect(addRecent(['😀', '👍', '❤️'], '👍')).toEqual(['👍', '😀', '❤️'])
  })

  it('keeps at most the limit', () => {
    const many = Array.from({ length: MAX_RECENT }, (_, i) => String(i))
    const next = addRecent(many, '🐱')
    expect(next).toHaveLength(MAX_RECENT)
    expect(next[0]).toBe('🐱')
    expect(next).not.toContain(String(MAX_RECENT - 1))
  })
})

describe('loadRecent', () => {
  it('reads the stored list from this device', async () => {
    fetchValue.mockResolvedValue(['👍', '🐱'])
    await expect(loadRecent()).resolves.toEqual(['👍', '🐱'])
    expect(fetchValue).toHaveBeenCalledWith(RECENT_EMOJI_KEY)
  })

  it('keeps only valid emoji, fully-qualified and without duplicates', async () => {
    fetchValue.mockResolvedValue(['❤', '❤️', 'not an emoji', 42, '👍👍', '👍'])
    await expect(loadRecent()).resolves.toEqual(['❤️', '👍'])
  })

  it('treats nothing stored, or something that is not a list, as empty', async () => {
    fetchValue.mockResolvedValue(undefined)
    await expect(loadRecent()).resolves.toEqual([])
    fetchValue.mockResolvedValue({ '👍': 1 })
    await expect(loadRecent()).resolves.toEqual([])
  })
})

describe('saveRecent', () => {
  it('stores at most the limit under the recent key', async () => {
    const many = Array.from({ length: MAX_RECENT + 5 }, () => '👍')
    await saveRecent(many)
    expect(storeValue).toHaveBeenCalledWith(RECENT_EMOJI_KEY, many.slice(0, MAX_RECENT))
  })
})
