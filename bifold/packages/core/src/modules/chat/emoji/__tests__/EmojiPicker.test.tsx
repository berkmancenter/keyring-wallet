import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { Platform } from 'react-native'

import { BasicAppContext } from '../../../../../__tests__/helpers/app'
import en from '../../../../localization/en/en.json'
import fr from '../../../../localization/fr/fr.json'
import ptBr from '../../../../localization/pt-br/pt-br.json'
import { testIdWithKey } from '../../../../utils/testable'
import EmojiPicker, { GROUP_LABEL_KEYS, groupLabel } from '../EmojiPicker'
import { EmojiPickerIds, emojiCodePoints } from '../EmojiPicker.ids'
import { loadRecent, saveRecent } from '../recent'

jest.mock('../recent', () => {
  const actual = jest.requireActual('../recent')
  return { ...actual, loadRecent: jest.fn(), saveRecent: jest.fn() }
})

const load = loadRecent as jest.Mock
const save = saveRecent as jest.Mock
const emojiId = (emoji: string) => testIdWithKey(`EmojiPickerEmoji_${emojiCodePoints(emoji)}`)

const renderPicker = (props: Partial<React.ComponentProps<typeof EmojiPicker>> = {}) => {
  const onSelect = jest.fn()
  const tree = render(
    <BasicAppContext>
      <EmojiPicker onSelect={onSelect} maxVersion={99} {...props} />
    </BasicAppContext>
  )
  return { tree, onSelect }
}

beforeEach(() => {
  jest.clearAllMocks()
  load.mockResolvedValue([])
  save.mockResolvedValue(undefined)
})

describe('EmojiPicker', () => {
  it('shows the first category and sends the chosen emoji', async () => {
    const { tree, onSelect } = renderPicker()
    await waitFor(() => expect(load).toHaveBeenCalled())
    fireEvent.press(tree.getByTestId(emojiId('😀')))
    expect(onSelect).toHaveBeenCalledWith('😀')
    expect(save).toHaveBeenCalledWith(['😀'])
  })

  it('finds 🐱 by searching "cat", and clears the search', async () => {
    const { tree, onSelect } = renderPicker()
    fireEvent.changeText(tree.getByTestId(testIdWithKey(EmojiPickerIds.search)), 'cat')
    fireEvent.press(tree.getByTestId(emojiId('🐱')))
    expect(onSelect).toHaveBeenCalledWith('🐱')
    fireEvent.press(tree.getByTestId(testIdWithKey(EmojiPickerIds.clearSearch)))
    expect(tree.queryByTestId(testIdWithKey(EmojiPickerIds.clearSearch))).toBeNull()
  })

  it('says so when a search finds nothing', () => {
    const { tree } = renderPicker()
    fireEvent.changeText(tree.getByTestId(testIdWithKey(EmojiPickerIds.search)), 'zzqqxx')
    expect(tree.getByTestId(testIdWithKey(EmojiPickerIds.noResults))).toBeTruthy()
  })

  it('does not offer an emoji newer than the device can draw, even in search', () => {
    const { tree } = renderPicker({ maxVersion: 13.0 })
    fireEvent.changeText(tree.getByTestId(testIdWithKey(EmojiPickerIds.search)), 'melting')
    expect(tree.queryByTestId(emojiId('🫠'))).toBeNull()
    expect(tree.getByTestId(testIdWithKey(EmojiPickerIds.noResults))).toBeTruthy()
  })

  it('offers base emoji only, not skin-tone variants', () => {
    const { tree } = renderPicker()
    fireEvent.changeText(tree.getByTestId(testIdWithKey(EmojiPickerIds.search)), 'thumbs up')
    expect(tree.getByTestId(emojiId('👍'))).toBeTruthy()
    expect(tree.queryByTestId(emojiId('👍🏽'))).toBeNull()
  })

  it('shows a recent row, newest first, and moves a re-chosen emoji to the front', async () => {
    load.mockResolvedValue(['🐱', '👍'])
    const { tree } = renderPicker()
    await waitFor(() => expect(tree.getByTestId(testIdWithKey(EmojiPickerIds.recent))).toBeTruthy())
    const thumbs = tree.getAllByTestId(emojiId('👍'))[0]
    await act(async () => fireEvent.press(thumbs))
    expect(save).toHaveBeenLastCalledWith(['👍', '🐱'])
  })

  it('hides a recent emoji the device cannot draw', async () => {
    // 🥲 (13.0) keeps the row, so the wait proves the read landed before 🫠 (14.0) is looked for.
    load.mockResolvedValue(['🫠', '🥲'])
    const { tree } = renderPicker({ maxVersion: 13.0 })
    await waitFor(() => expect(tree.getByTestId(testIdWithKey(EmojiPickerIds.recent))).toBeTruthy())
    expect(tree.getAllByTestId(emojiId('🥲'))).toHaveLength(2) // the recent row and the grid
    expect(tree.queryByTestId(emojiId('🫠'))).toBeNull()
  })

  it('names the emoji for screen readers', () => {
    const { tree } = renderPicker()
    expect(tree.getByTestId(emojiId('😀')).props.accessibilityLabel).toBe('grinning face')
  })
})

// The limit read from the device, not passed in: Android 11 (API level 30) draws up to Emoji 13.0 (osSupport.ts).
describe('on Android 11, from Platform', () => {
  const original = { os: Platform.OS, version: Platform.Version }
  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true })
    Object.defineProperty(Platform, 'Version', { value: 30, configurable: true })
  })
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: original.os, configurable: true })
    Object.defineProperty(Platform, 'Version', { value: original.version, configurable: true })
  })
  const renderOnDevice = () => renderPicker({ maxVersion: undefined })

  it('offers 🥲 (13.0) in the grid and not 🫠 (14.0)', async () => {
    const { tree } = renderOnDevice()
    await waitFor(() => expect(load).toHaveBeenCalled())
    // 🫠 sorts before 🥲 in Smileys & Emotion, so with 🥲's row drawn, 🫠's place has been too.
    expect(tree.getByTestId(emojiId('🥲'))).toBeTruthy()
    expect(tree.queryByTestId(emojiId('🫠'))).toBeNull()
  })

  it('finds 🥲 by searching, and not 🫠', () => {
    const { tree } = renderOnDevice()
    const search = tree.getByTestId(testIdWithKey(EmojiPickerIds.search))
    fireEvent.changeText(search, 'smiling face with tear')
    expect(tree.getByTestId(emojiId('🥲'))).toBeTruthy()
    fireEvent.changeText(search, 'melting')
    expect(tree.queryByTestId(emojiId('🫠'))).toBeNull()
    expect(tree.getByTestId(testIdWithKey(EmojiPickerIds.noResults))).toBeTruthy()
  })

  it('keeps 🫠 out of the recent row, chosen on a newer phone', async () => {
    load.mockResolvedValue(['🫠', '🥲'])
    const { tree } = renderOnDevice()
    await waitFor(() => expect(tree.getByTestId(testIdWithKey(EmojiPickerIds.recent))).toBeTruthy())
    expect(tree.getAllByTestId(emojiId('🥲'))).toHaveLength(2)
    expect(tree.queryByTestId(emojiId('🫠'))).toBeNull()
  })
})

describe('groupLabel', () => {
  const translate = (key: string) => `t:${key}`

  it('translates a known group and falls back to the English name', () => {
    expect(groupLabel('Flags', translate)).toBe('t:Emoji.Group.Flags')
    expect(groupLabel('Some Future Group', translate)).toBe('Some Future Group')
  })

  // Group names come from the data file: an inherited object key must not
  // turn into a translation lookup (the hazard fixed in #552).
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])('treats %s as an unknown group', (name) => {
    expect(groupLabel(name, translate)).toBe(name)
  })
})

describe('emojiCodePoints', () => {
  it('gives upper-case hex code points joined by dashes', () => {
    expect(emojiCodePoints('👍')).toBe('1F44D')
    expect(emojiCodePoints('❤️')).toBe('2764-FE0F')
  })
})

describe('picker strings', () => {
  const has = (tree: Record<string, unknown>, key: string) =>
    typeof key.split('.').reduce<unknown>((n, p) => (n as Record<string, unknown> | undefined)?.[p], tree) === 'string'
  const keys = [
    'Emoji.Search',
    'Emoji.ClearSearch',
    'Emoji.Recent',
    'Emoji.NoResults',
    'Emoji.Open',
    ...GROUP_LABEL_KEYS.values(),
  ]

  it.each([
    ['en', en],
    ['fr', fr],
    ['pt-br', ptBr],
  ])('exist in %s', (_, locale) => {
    for (const key of keys) expect([key, has(locale as Record<string, unknown>, key)]).toEqual([key, true])
  })
})
