/**
 * Messages' community chips are named without My Agent having been opened (IN-814).
 *
 * A chip is named from the names kept in memory (`communityTarget`). Only the My Agent screen read the names saved
 * on the phone into it, and Messages did not redraw when a name was learned, so after a start of the app every chip
 * read "(no name published yet)" until My Agent had been opened in that run. The room rows here are as the real
 * rooms backend gives them: with no community name of their own, which is why the chips depend on those names.
 */
import { useAgent, useBasicMessages, useConnections } from '@bifold/react-hooks'
import { act, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { StoreContext } from '../../src'
import { communityTarget } from '../../src/modules/trust-tasks/module/vtiCommunityLink'
import Messages from '../../src/screens/Messages'
import { testIdWithKey } from '../../src/utils/testable'
import { testDefaultState } from '../contexts/store'
import { BasicAppContext } from '../helpers/app'

jest.mock('../../src/modules/vrc/contacts/useContactLinks', () => ({ useContactLinks: () => new Map() }))
jest.mock('../../src/modules/vrc/contacts/useContactFacts', () => ({
  ...jest.requireActual('../../src/modules/vrc/contacts/useContactFacts'),
  useConnectionRelationships: () => new Map(),
}))
jest.mock('../../src/hooks/chat-messages', () => ({
  ...jest.requireActual('../../src/hooks/chat-messages'),
  useChatMessagesByConnection: () => [],
}))
jest.mock('../../src/hooks/useUnreadMessages', () => ({
  useUnreadMessages: () => ({ unreadByConnection: {}, totalUnread: 0 }),
}))
let mockRoomRows: Record<string, unknown>[] = []
jest.mock('../../src/modules/rooms/useRoomRows', () => ({
  useRoomRows: () => ({ rows: mockRoomRows, reload: jest.fn(), failed: false }),
  useHiddenRoomCount: () => 0,
}))
jest.mock('../../src/components/messages/WaitingForYou', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/modules/rooms/components/RoomMessageRow', () => ({ __esModule: true, default: () => null }))

const FIRST = 'did:webvh:QmFirst:host.example:first-vtc'
const TEST = 'did:webvh:QmTest:host.example:test-vtc'
// A room row as the rooms service gives it: its community by DID, and no name for it.
const roomRow = (roomId: string, communityDid: string) => ({
  key: roomId,
  roomId,
  roomName: `Room ${roomId}`,
  nameFrom: 'name',
  communityDid,
  lastActivityAt: new Date(Date.UTC(2026, 10, 26)),
  unread: 0,
})
// The test's translator gives a key back as it is: this is the "<handle> (no name published yet)" label.
const UNNAMED = 'Community.UnnamedRef'

const agent = (useAgent as jest.Mock)().agent
/** The names saved on this phone, as generic records (`saveCommunityName`). */
const saved = (names: Record<string, string>) => {
  ;(agent.genericRecords.findAllByQuery as jest.Mock).mockImplementation(async (query: { kind?: string }) =>
    query.kind === 'community-name'
      ? Object.entries(names).map(([communityDid, name], i) => ({
          id: `name-${i}`,
          content: { communityDid, name, at: '2026-11-25T00:00:00.000Z' },
          getTags: () => ({ recordType: 'keyring/vti-community', kind: 'community-name', key: communityDid }),
          updatedAt: new Date(Date.UTC(2026, 10, 25)),
        }))
      : []
  )
}

const navigation = { setOptions: jest.fn(), navigate: jest.fn(), getParent: () => ({ navigate: jest.fn() }) }
const show = () =>
  render(
    <StoreContext.Provider value={[testDefaultState, () => undefined]}>
      <BasicAppContext>
        <Messages navigation={navigation as never} />
      </BasicAppContext>
    </StoreContext.Provider>
  )
const chipLabels = (tree: ReturnType<typeof render>) =>
  tree.queryAllByTestId(testIdWithKey('MessagesChipCommunity')).map((chip) => chip.props.accessibilityLabel)
const logged = () => (agent.config.logger.info as jest.Mock).mock.calls.map(([line]) => String(line))

beforeEach(() => {
  jest.clearAllMocks()
  communityTarget.clear()
  ;(useConnections as jest.Mock).mockReturnValue({ records: [], loading: false })
  ;(useBasicMessages as jest.Mock).mockImplementation(() => ({ records: [] }))
  mockRoomRows = [roomRow('r1', FIRST), roomRow('r2', TEST)]
  saved({})
})

test('the control: with no name on the phone and none learned, each chip says the community has published none', async () => {
  const tree = show()
  await waitFor(() => expect(logged().some((line) => line.includes('Messages:'))).toBe(true))
  expect(chipLabels(tree)).toEqual([UNNAMED, UNNAMED])
})

test('a start with Messages first: the names saved on the phone name the chips, with My Agent never opened', async () => {
  saved({ [FIRST]: 'First VTC', [TEST]: 'Test VTC' })
  const tree = show()
  await waitFor(() => expect(chipLabels(tree)).toEqual(['First VTC', 'Test VTC']))
})

test('only the communities that have a saved name are named', async () => {
  saved({ [TEST]: 'Test VTC' })
  const tree = show()
  await waitFor(() => expect(chipLabels(tree)).toEqual([UNNAMED, 'Test VTC']))
})

test('a name learned while Messages is on screen names its chip at once, with nothing else changing', async () => {
  const tree = show()
  await waitFor(() => expect(logged().some((line) => line.includes('Messages:'))).toBe(true))
  expect(chipLabels(tree)).toEqual([UNNAMED, UNNAMED])
  // As any read that learns a name does it: a manifest read, a sign-in, My Agent's daily refresh.
  act(() => communityTarget.publishedName(FIRST, 'First VTC'))
  expect(chipLabels(tree)).toEqual(['First VTC', UNNAMED])
})

test('the saved names are not read when there is no chip to name', async () => {
  mockRoomRows = []
  saved({ [FIRST]: 'First VTC' })
  show()
  await act(async () => undefined)
  expect(agent.genericRecords.findAllByQuery).not.toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'community-name' })
  )
})

test('a read of the saved names that fails leaves the chips unnamed, and the screen stands', async () => {
  ;(agent.genericRecords.findAllByQuery as jest.Mock).mockRejectedValue(new Error('the wallet is closed'))
  const tree = show()
  await waitFor(() => expect(logged().some((line) => line.includes('not read'))).toBe(true))
  expect(chipLabels(tree)).toEqual([UNNAMED, UNNAMED])
})

describe('what a problem report now says of the names', () => {
  test('how many were saved, and which communities shown have none, by a short form of the DID and never by name', async () => {
    saved({ [TEST]: 'Test VTC' })
    show()
    await waitFor(() => expect(logged().some((line) => line.includes('Messages:'))).toBe(true))
    const lines = logged().filter((line) => line.startsWith('[Community:names]'))
    expect(lines).toContain('[Community:names] saved on this phone: 1, loaded')
    expect(lines).toContain(
      '[Community:names] Messages: 2 shown, 1 with no name on this phone (did:webvh:QmFirs…irst-vtc)'
    )
    expect(lines.join('\n')).not.toContain('Test VTC')
  })

  test('nothing missing is said as that', async () => {
    saved({ [FIRST]: 'First VTC', [TEST]: 'Test VTC' })
    show()
    await waitFor(() => expect(logged()).toContain('[Community:names] Messages: 2 shown, each with a name'))
  })
})
