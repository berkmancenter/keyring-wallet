import { act, renderHook, waitFor } from '@testing-library/react-native'

import { toInertText } from '../inertText'
import type { RoomPost } from '../roomPosts'
import type { Identity, RoomsService } from '../types'
import { type RoomThreadView, useRoomThread } from '../useRoomThread'

const noor = { did: 'did:peer:noor' } as unknown as Identity
const ines = { did: 'did:peer:ines' } as unknown as Identity
const post = (key: string, over: Partial<RoomPost> = {}): RoomPost => ({
  key,
  version: 1,
  author: noor,
  byAgent: false,
  mine: false,
  text: toInertText('words'),
  isChatMessage: false,
  retracted: false,
  pinned: false,
  unread: false,
  files: [],
  ...over,
})
const service = (readNote: jest.Mock) => ({ readNote }) as unknown as RoomsService
const hook = (read: jest.Mock<any, any>, first: RoomPost[], roomId = 'room') =>
  renderHook<RoomThreadView, { posts: RoomPost[] | undefined; room: string }>(
    ({ posts, room }) => useRoomThread(service(read), room, undefined, posts),
    { initialProps: { posts: first, room: roomId } }
  )

describe('useRoomThread', () => {
  test('the first version seen is what later ones are compared with', async () => {
    const read = jest.fn()
    const { result, rerender } = hook(read, [post('m', { kind: 'message' })])
    rerender({ posts: [post('m', { version: 2, kind: 'reaction', author: ines })], room: 'room' })
    expect(result.current.refused.has('m')).toBe(true)
    expect(result.current.held.get('m')?.author).toBe(noor)
  })

  test('a record that could not be read is not held: its listing says nothing of what it is', () => {
    const { result } = hook(jest.fn(), [post('m', { unread: true })])
    expect(result.current.held.has('m')).toBe(false)
  })

  test('another room starts with nothing held', () => {
    const { result, rerender } = hook(jest.fn(), [post('m')])
    rerender({ posts: [post('other')], room: 'room2' })
    expect(result.current.held.has('m')).toBe(false)
  })

  test('a target beyond the page is read once however often the page changes, and one on it never', async () => {
    const read = jest.fn(async (_room: string, _key: string) => ({
      key: 't',
      version: 1,
      status: 'active',
      pinned: false,
      body: toInertText('The target'),
    }))
    const reply = post('r', { inReplyTo: { key: 't' } })
    const { result, rerender } = hook(read, [reply, post('on'), post('r2', { inReplyTo: { key: 'on' } })])
    await waitFor(() => expect(result.current.targets.get('t')?.text).toBe('The target'))
    await act(async () => rerender({ posts: [post('new'), reply], room: 'room' }))
    expect(read.mock.calls.map(([, key]) => key)).toEqual(['t'])
  })

  test('a target that fails is marked missing, and not asked for again', async () => {
    const read = jest.fn(async () => {
      throw new Error('gone')
    })
    const reply = post('r', { inReplyTo: { key: 't' } })
    const { result, rerender } = hook(read, [reply])
    await waitFor(() => expect(result.current.missing.has('t')).toBe(true))
    await act(async () => rerender({ posts: [post('new'), reply], room: 'room' }))
    expect(read).toHaveBeenCalledTimes(1)
  })
})
