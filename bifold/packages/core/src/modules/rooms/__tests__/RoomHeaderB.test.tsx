/**
 * The room screen as mocked in header B (276.6 feedback): the room's letters on a lilac tile, not on the screen's own
 * grey where the tile did not show; the tier as an outlined chip in the brand's colour; the title and the line below
 * at B's sizes; the community named from what the phone knows when the room's record names none; "Posting as" with
 * the member's initial and their name in bold; another member's name on their post in the brand's colour.
 */
import { render, within } from '@testing-library/react-native'
import type { TFunction } from 'i18next'
import React from 'react'
import { type StyleProp, StyleSheet, type TextStyle } from 'react-native'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { communityTarget } from '../../trust-tasks/module/vtiCommunityLink'
import { RoomComposer } from '../components/RoomComposer'
import { ROOM_MARK_FILL, RoomHeader, roomWhere } from '../components/RoomHeader'
import { RoomPostBubble } from '../components/RoomPostBubble'
import { TierBadge } from '../components/TierBadge'
import { toInertText } from '../inertText'
import type { RoomPost } from '../roomPosts'
import type { RoomSummary } from '../types'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const LAB = 'did:webvh:QmLab:lab.example'
const flat = (style: unknown): TextStyle => StyleSheet.flatten(style as StyleProp<TextStyle>) ?? {}
const room = (over: Partial<RoomSummary> = {}) =>
  ({
    roomId: 'r1',
    name: toInertText('Keyring lab open'),
    nameFrom: 'name',
    tier: 'open',
    validUntil: '2027-01-26T00:00:00Z',
    communityDid: LAB,
    ...over,
  }) as RoomSummary

afterEach(() => jest.restoreAllMocks())

describe('header B', () => {
  test("the letters sit on a lilac tile, not on the screen's own grey", () => {
    const tree = render(
      <BasicAppContext>
        <RoomHeader room={room()} />
      </BasicAppContext>
    )
    const letters = tree.getByTestId(id('RoomMonogram'), { includeHiddenElements: true })
    // The nearest drawn box around the letters is the tile.
    let box = letters.parent
    while (box && !flat(box.props.style).backgroundColor) box = box.parent
    expect(flat(box?.props.style).backgroundColor).toBe(ROOM_MARK_FILL)
    expect(flat(tree.getByTestId(id('RoomTitle')).props.style).fontSize).toBe(22)
    expect(flat(tree.getByTestId(id('RoomWhere')).props.style).fontSize).toBe(15)
  })

  test("the tier is an outlined chip in the brand's colour, centred on the row", () => {
    const tree = render(
      <BasicAppContext>
        <TierBadge tier="open" />
      </BasicAppContext>
    )
    const chip = flat(tree.getByTestId(id('RoomTier')).props.style)
    expect(chip).toMatchObject({ borderWidth: 1.5, alignSelf: 'center' })
    expect(chip.backgroundColor).toBeUndefined()
    const words = within(tree.getByTestId(id('RoomTier'))).getByText('Rooms.TierOpen')
    expect(flat(words.props.style)).toMatchObject({ fontSize: 13, fontWeight: '700', color: chip.borderColor })
  })

  test("a room whose record names no community is said to be in the community's published name", () => {
    const t = ((key: string, o?: { community?: string; date?: string }) =>
      `${key}|${o?.community ?? ''}|${o?.date ? 'date' : ''}`) as unknown as TFunction
    jest
      .spyOn(communityTarget, 'publishedNameOf')
      .mockImplementation((did) => (did === LAB ? 'Keyring Lab' : undefined))
    expect(roomWhere(t, room())).toBe('Rooms.RoomInUntil|Keyring Lab|date')
    // The record's own name comes first; a community the phone doesn't know is left out (control).
    expect(roomWhere(t, room({ communityName: toInertText('Lab (record)') }))).toBe(
      'Rooms.RoomInUntil|Lab (record)|date'
    )
    expect(roomWhere(t, room({ communityDid: 'did:webvh:other' }))).toBe('Rooms.Until||date')
  })

  test('"Posting as" shows the initial and the name in bold; a line without the name is drawn as it is', () => {
    const tree = render(
      <BasicAppContext>
        <RoomComposer
          onSend={() => true}
          postingAs="Posting as Alberto L"
          postingAsName="Alberto L"
          onPressPostingAs={() => undefined}
        />
      </BasicAppContext>
    )
    expect(tree.getByTestId(id('RoomComposerPostingAs'))).toHaveTextContent('Posting as Alberto L')
    expect(flat(tree.getByText('Alberto L').props.style).fontWeight).toBe('700')
    expect(tree.getByText('A', { includeHiddenElements: true })).toBeTruthy()

    const plain = render(
      <BasicAppContext>
        <RoomComposer onSend={() => true} postingAs="Rooms.PostingAs" postingAsName="Alberto L" />
      </BasicAppContext>
    )
    expect(plain.getByTestId(id('RoomComposerPostingAs'))).toHaveTextContent('Rooms.PostingAs')
    expect(plain.queryByText('Alberto L')).toBeNull()
  })

  test("another member's name on their post is in the brand's colour; the member's own \"You\" is not", () => {
    const post = (mine: boolean) =>
      ({
        key: mine ? 'note/mine' : 'note/theirs',
        author: { did: 'did:key:z6MkSaddle' },
        mine,
        text: 'Hi',
        files: [],
        at: new Date('2026-10-29T18:06:00Z'),
      }) as unknown as RoomPost
    const theirs = render(
      <BasicAppContext>
        <RoomPostBubble post={post(false)} />
      </BasicAppContext>
    )
    const name = flat(theirs.getByText(/Rooms\.MemberTail/).props.style)
    expect(name).toMatchObject({ fontSize: 13, fontWeight: '600' })
    const mine = render(
      <BasicAppContext>
        <RoomPostBubble post={post(true)} />
      </BasicAppContext>
    )
    const you = flat(mine.getByText('Rooms.You').props.style)
    expect(you.color).not.toBe(name.color)
    expect(you.fontWeight).not.toBe('600')
  })
})
