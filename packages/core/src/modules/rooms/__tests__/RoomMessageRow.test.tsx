/**
 * A room's Messages row and the "Waiting for you" card. The row: the room's letters on a lilac square, its community
 * as a tag, the newest post with who wrote it, the unread count, one spoken sentence, and a tap that opens the room.
 * The card: one per offer waiting, only the chip's community's under a community chip, nothing when none wait. The
 * Messages tab's badge and its spoken label say one number, people's and rooms' unread together. Words in en, fr,
 * pt-BR.
 */
import { fireEvent, render } from '@testing-library/react-native'
import Toast from 'react-native-toast-message'
import { readFileSync } from 'fs'
import i18n from 'i18next'
import path from 'path'
import React from 'react'
import { ActivityIndicator } from 'react-native'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'
import { testIdWithKey } from '../../../utils/testable'
import RoomMessageRow from '../components/RoomMessageRow'
import RoomOfferCard from '../components/RoomOfferCard'
import { toInertText } from '../inertText'
import type { RoomOffer } from '../types'
import type { RoomRow } from '../useRoomRows'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('../../directory/useDirectory', () => ({
  useDirectoryService: () => undefined,
  useDirectoryNames: () => new Map(),
}))
jest.mock('../usePetname', () => ({ usePetnames: () => new Map([['did:key:z6MkLena', 'Lena']]) }))
const mockUndo = jest.fn()
let mockHide: jest.Mock = jest.fn(() => mockUndo)
jest.mock('../useRoomRows', () => ({ hideRoom: (roomId: string) => mockHide(roomId) }))
let mockOffers: RoomOffer[] = []
jest.mock('../useRoomOffersCount', () => ({
  useRoomOffersWaiting: (communityDid?: string) =>
    communityDid ? mockOffers.filter((o) => o.communityDid === communityDid) : mockOffers,
}))

const id = (key: string) => testIdWithKey(key)
const LAB = 'did:webvh:QmLab:lab.example'
const row = (over: Partial<RoomRow> = {}): RoomRow => ({
  key: 'planning',
  roomId: 'planning',
  roomName: toInertText('Planning'),
  nameFrom: 'community',
  communityDid: LAB,
  communityName: toInertText('Keyring Lab'),
  lastActivityAt: new Date('2026-10-30T09:52:00Z'),
  unread: 3,
  lastPost: {
    by: { did: 'did:key:z6MkSam', identityWords: 'Sam' },
    mine: false,
    text: 'The agenda is in Notes',
    kind: 'chat',
  },
  ...over,
})
const offer = (roomId: string, communityDid = LAB): RoomOffer => ({
  offerId: `offer:${roomId}`,
  roomId,
  roomName: toInertText(roomId === 'kernel' ? 'Kernel notes' : 'Welcome desk'),
  communityDid,
  communityName: toInertText(communityDid === LAB ? 'Keyring Lab' : 'Test VTC'),
  tier: 'open',
  verbs: ['read'],
})
const show = (node: React.ReactElement) => render(<BasicAppContext>{node}</BasicAppContext>)

describe("a room's Messages row", () => {
  test('letters, community tag, the newest post with who wrote it, the unread count; a tap opens the room', () => {
    const onOpen = jest.fn()
    const tree = show(<RoomMessageRow row={row()} onOpen={onOpen} />)
    expect(tree.getByText('P', { includeHiddenElements: true })).toBeTruthy()
    expect(tree.getByText('Keyring Lab')).toBeTruthy()
    expect(tree.getByText('Rooms.RowBy')).toBeTruthy()
    expect(tree.getByTestId(id('MessagesListUnread'))).toHaveTextContent('3')
    const label = tree.getByTestId(id('RoomMessageRow')).props.accessibilityLabel as string
    expect(label).toContain('Rooms.RowLabelIn')
    expect(label).toContain('MessagesList.Unread')
    fireEvent.press(tree.getByTestId(id('RoomMessageRow')))
    expect(onOpen).toHaveBeenCalledWith('planning')
  })

  // rooms/newestFirstSwitch: a first read that was a window counts only what it held, so the row says "N+".
  test('a count that may be more says "N+", and says so aloud, in every language (control: an exact count)', () => {
    const more = show(<RoomMessageRow row={row({ unread: 60, unreadMore: true })} onOpen={jest.fn()} />)
    expect(more.getByTestId(id('MessagesListUnread'))).toHaveTextContent('60+')
    const said = more.getByTestId(id('RoomMessageRow')).props.accessibilityLabel as string
    expect(said).toContain('MessagesList.UnreadMore')
    const exact = show(<RoomMessageRow row={row({ unread: 60 })} onOpen={jest.fn()} />)
    expect(exact.getByTestId(id('MessagesListUnread'))).toHaveTextContent(/^60$/)
    const saidExact = exact.getByTestId(id('RoomMessageRow')).props.accessibilityLabel as string
    expect(saidExact).toContain('MessagesList.Unread')
    expect(saidExact).not.toContain('UnreadMore')
  })

  test('the member\'s own post reads "You: …"; no posts read yet, and no unread count (control)', () => {
    const mine = show(
      <RoomMessageRow
        row={row({ unread: 0, lastPost: { mine: true, text: 'Thanks', kind: 'chat' } })}
        onOpen={jest.fn()}
      />
    )
    expect(mine.getByText('MessagesList.You')).toBeTruthy()
    expect(mine.queryByTestId(id('MessagesListUnread'))).toBeNull()
    const empty = show(
      <RoomMessageRow row={row({ unread: 0, lastPost: undefined, lastActivityAt: undefined })} onOpen={jest.fn()} />
    )
    expect(empty.getByText('Rooms.RowNoPosts')).toBeTruthy()
  })

  // Its posts not read yet (the agent not ready on a cold launch): the app's spinner, as the rooms card shows (#775),
  // never "No posts yet"; the words stay for a screen reader.
  test('a room not read yet shows the spinner, not that it has no posts, and says reading to a screen reader', () => {
    const reading = show(
      <RoomMessageRow
        row={row({ unread: 0, lastPost: undefined, lastActivityAt: undefined, reading: true })}
        onOpen={jest.fn()}
      />
    )
    expect(reading.UNSAFE_getByType(ActivityIndicator).props.accessibilityLabel).toBe('Rooms.Reading')
    expect(reading.queryByText('Rooms.Reading')).toBeNull()
    expect(reading.queryByText('Rooms.RowNoPosts')).toBeNull()
  })

  // Alberto (11-24, 281.2): every row of a cold start spun, though the phone already had them. A row from the last run
  // reads quietly; the spinner is for a room shown for the first time (the row above).
  test('a row the phone already had from its last run shows no spinner, and still says reading to a screen reader', () => {
    const quiet = show(
      <RoomMessageRow
        row={row({ unread: 0, lastPost: undefined, reading: true, fromLastTime: true })}
        onOpen={jest.fn()}
      />
    )
    expect(quiet.UNSAFE_queryByType(ActivityIndicator)).toBeNull()
    expect(quiet.queryByText('Rooms.RowNoPosts')).toBeNull()
    expect(quiet.getByTestId(id('RoomMessageRow')).props.accessibilityLabel).toContain('Rooms.RowLabel')
  })

  // 34VR-Y58H (277.8, 11-03): a room he was not in spun for good. It says so, with no spinner.
  test('a room not joined yet says so, with no spinner (control above: reading has one)', () => {
    const notJoined = show(
      <RoomMessageRow
        row={row({ unread: 0, lastPost: undefined, lastActivityAt: undefined, notJoined: true })}
        onOpen={jest.fn()}
      />
    )
    expect(notJoined.getByText('Rooms.NotJoinedYet')).toBeTruthy()
    expect(notJoined.UNSAFE_queryByType(ActivityIndicator)).toBeNull()
  })
})

describe('a row whose read was refused over a version (IN-814)', () => {
  const refused = (cannotRead: NonNullable<RoomRow['cannotRead']>) =>
    render(
      <BasicAppContext>
        <RoomMessageRow
          row={row({ unread: 0, lastPost: undefined, lastActivityAt: undefined, cannotRead })}
          onOpen={jest.fn()}
        />
      </BasicAppContext>
    )

  test.each([
    ['communityNeedsUpdate', 'Rooms.RowCommunityNeedsUpdate'],
    ['agentNeedsUpdate', 'Rooms.RowAgentNeedsUpdate'],
    ['appNeedsUpdate', 'Rooms.RowAppNeedsUpdate'],
    ['cannotTell', 'Rooms.RowCannotRead'],
  ] as const)('%s: its words on the row and in its spoken label, and no spinner', (cannotRead, key) => {
    const tree = refused(cannotRead)
    expect(tree.getByText(key)).toBeTruthy()
    expect(tree.UNSAFE_queryByType(ActivityIndicator)).toBeNull()
    expect(tree.getByTestId(id('RoomMessageRow')).props.accessibilityLabel).toContain('Rooms.RowLabelIn')
    expect(tree.queryByText('Rooms.RowNoPosts')).toBeNull()
  })

  test('the control: the same row reading has the spinner and none of those words', () => {
    const tree = render(
      <BasicAppContext>
        <RoomMessageRow
          row={row({ unread: 0, lastPost: undefined, lastActivityAt: undefined, reading: true })}
          onOpen={jest.fn()}
        />
      </BasicAppContext>
    )
    expect(tree.UNSAFE_getByType(ActivityIndicator)).toBeTruthy()
    expect(tree.queryByText(/^Rooms\.Row(Community|Agent|App)NeedsUpdate$|^Rooms\.RowCannotRead$/)).toBeNull()
  })

  test('a room with a post shows the post, whatever its row holds of a refusal', () => {
    const tree = render(
      <BasicAppContext>
        <RoomMessageRow row={row({ cannotRead: 'communityNeedsUpdate' })} onOpen={jest.fn()} />
      </BasicAppContext>
    )
    expect(tree.queryByText('Rooms.RowCommunityNeedsUpdate')).toBeNull()
  })

  test('the words exist in en, fr and pt-BR, and differ from one language to the next', () => {
    for (const key of [
      'RowCommunityNeedsUpdate',
      'RowAgentNeedsUpdate',
      'RowAppNeedsUpdate',
      'RowCannotRead',
    ] as const) {
      const words = [en, fr, ptBr].map((language) => (language.Rooms as Record<string, string>)[key])
      for (const said of words) expect(typeof said === 'string' && said.length > 0).toBe(true)
      expect(new Set(words).size).toBe(3)
    }
  })

  test('the fourth line, for a refusal that does not say who needs the update, still says an update is needed', () => {
    const words = [en, fr, ptBr].map((language) => (language.Rooms as Record<string, string>).RowCannotRead)
    expect(words).toEqual([
      'Needs an update to be read',
      'Mise à jour nécessaire pour lire',
      'Precisa de atualização para ler',
    ])
  })
})

describe("Hide, behind a room's row", () => {
  test('the swipe action and a long press both hide the room, with Undo; nothing hidden, no toast (control)', () => {
    const toast = jest.spyOn(Toast, 'show').mockImplementation(() => undefined)
    mockHide = jest.fn(() => mockUndo)
    const tree = show(<RoomMessageRow row={row()} onOpen={jest.fn()} />)
    fireEvent.press(tree.getByTestId(id('RoomMessageRowHide')))
    expect(mockHide).toHaveBeenCalledWith('planning')
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'undo', text1: 'Rooms.Hidden', props: { onUndo: mockUndo } })
    )
    fireEvent(tree.getByTestId(id('RoomMessageRow')), 'longPress')
    expect(mockHide).toHaveBeenCalledTimes(2)
    // The screen reader's own action, under its name.
    expect(tree.getByTestId(id('RoomMessageRow')).props.accessibilityActions).toEqual([
      { name: 'hide', label: 'Rooms.Hide' },
    ])

    toast.mockClear()
    mockHide = jest.fn(() => undefined)
    fireEvent.press(tree.getByTestId(id('RoomMessageRowHide')))
    expect(toast).not.toHaveBeenCalled()
    toast.mockRestore()
  })
})

describe('the "Waiting for you" card', () => {
  test('one per offer, a community chip shows only its own, none waiting shows nothing', () => {
    mockOffers = [offer('kernel'), offer('desk', 'did:webvh:QmTest:vtc.example')]
    const onOpen = jest.fn()
    const all = show(<RoomOfferCard onOpen={onOpen} />)
    expect(all.getAllByTestId(id('RoomOfferCard'))).toHaveLength(2)
    fireEvent.press(all.getAllByTestId(id('RoomOfferCardLook'))[0])
    expect(onOpen).toHaveBeenCalledWith('offer:kernel')
    const lab = show(<RoomOfferCard communityDid={LAB} onOpen={onOpen} />)
    expect(lab.getAllByTestId(id('RoomOfferCard'))).toHaveLength(1)
    expect(lab.getByText('Kernel notes')).toBeTruthy()
    mockOffers = []
    const none = show(<RoomOfferCard onOpen={onOpen} />)
    expect(none.queryByTestId(id('RoomOfferCard'))).toBeNull()
  })
})

describe('the Messages tab', () => {
  // Read at the source, as the tab bar's own labels are (tabLabels.test): rendering the whole tab navigator is not
  // what this pins. The badge and the spoken label must say one number, people's unread and rooms' together.
  const source = readFileSync(path.join(__dirname, '../../../navigators/TabStack.tsx'), 'utf8')

  test("the badge and its spoken label both say people's and rooms' unread together", () => {
    expect(source).toMatch(/const totalUnread = peopleUnread \+ useRoomsUnreadCount\(\)/)
    expect(source).toMatch(/tabBarBadge: totalUnread > 0 \? totalUnread : undefined/)
    expect(source).toMatch(
      /tabBarAccessibilityLabel:\s*totalUnread > 0 \? `\$\{t\('TabStack\.Messages'\)\}, \$\{totalUnread\} unread`/
    )
    // People's count alone is used nowhere else (control: a second use would let the two drift apart).
    expect(source.match(/peopleUnread/g)).toHaveLength(2)
  })
})

describe('the words', () => {
  test.each([
    ['en', en],
    ['fr', fr],
    ['pt-BR', ptBr],
  ])('%s: every row and card line is there, filled', async (lng, resources) => {
    const i = i18n.createInstance()
    await i.init({ lng, resources: { [lng]: { translation: resources } }, interpolation: { escapeValue: false } })
    const said = [
      i.t('Rooms.RowBy', { who: 'Sam', text: 'Hi' }),
      i.t('Rooms.RowNote', { title: 'Agenda' }),
      i.t('Rooms.RowFile', { name: 'a.pdf' }),
      i.t('Rooms.RowPost'),
      i.t('Rooms.RowNoPosts'),
      i.t('Rooms.RowLabel', { room: 'Planning', preview: 'Hi' }),
      i.t('Rooms.RowLabelIn', { room: 'Planning', community: 'Keyring Lab', preview: 'Hi' }),
      i.t('Rooms.OfferWaiting'),
      i.t('Rooms.OfferLook'),
      i.t('Rooms.OfferLookLabel', { room: 'Kernel notes' }),
      i.t('Rooms.Hide'),
      i.t('Rooms.Hidden', { room: 'Planning' }),
    ]
    for (const words of said) expect(words).not.toMatch(/\{\{|Rooms\./)
    expect(said[6]).toContain('Keyring Lab')
  })

  // "N+" said aloud agrees in number, at 1 too: a window of others' posts mostly retracted or the member's own can
  // leave one unread below which more may lie. English and Portuguese say "1 or more … messages", as they would
  // anyway; French says "1 message non lu ou plus". Rendered by i18next itself, never the key the harness returns.
  test.each([
    ['en', en, '1 or more unread messages', '60 or more unread messages'],
    ['fr', fr, '1 message non lu ou plus', '60 messages non lus ou plus'],
    ['pt-BR', ptBr, '1 ou mais mensagens não lidas', '60 ou mais mensagens não lidas'],
  ])('%s: "N or more unread" agrees in number at 1 and at 60', async (lng, resources, one, sixty) => {
    const i = i18n.createInstance()
    await i.init({ lng, resources: { [lng]: { translation: resources } }, interpolation: { escapeValue: false } })
    expect(i.t('MessagesList.UnreadMore', { count: 1 })).toBe(one)
    expect(i.t('MessagesList.UnreadMore', { count: 60 })).toBe(sixty)
  })
})
