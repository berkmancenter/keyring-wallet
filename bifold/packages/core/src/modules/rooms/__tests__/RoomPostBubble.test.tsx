/**
 * The bubble is a Pressable for its long press, inside the outer Pressable a failed post is tapped on to send again.
 * A disabled inner one has to leave the touch to the outer, or the retry is a button that does nothing.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { StyleSheet } from 'react-native'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { RoomPostBubble } from '../components/RoomPostBubble'
import { toInertText } from '../inertText'
import type { RoomPost } from '../roomPosts'
import { ROOMS_SENDING_LABEL_WAITS, ROOM_SENDING_LABEL_AFTER_MS } from '../sendingLabelSwitch'

const id = testIdWithKey
const post = (over: Partial<RoomPost> = {}): RoomPost => ({
  key: 'p',
  version: 1,
  byAgent: false,
  mine: true,
  text: toInertText('Hi all'),
  isChatMessage: false,
  retracted: false,
  pinned: false,
  unread: false,
  files: [],
  ...over,
})
const show = (props: Partial<React.ComponentProps<typeof RoomPostBubble>>) =>
  render(
    <BasicAppContext>
      <RoomPostBubble post={post()} {...props} />
    </BasicAppContext>
  )
/** Whether a touch starting on this element stays with it: the native rule that decides who gets the tap. */
const takesTouch = (element: { props: { onStartShouldSetResponder?: () => boolean } }) =>
  element.props.onStartShouldSetResponder?.() ?? false

describe('RoomPostBubble: the long press inside the retry', () => {
  test('a failed post with no long press leaves the touch to the retry, and a tap on the bubble retries', () => {
    const onRetry = jest.fn()
    const { getByTestId } = show({ post: post({ delivery: 'failed' }), onRetry })
    const bubble = getByTestId(id('RoomPostBubble'))
    expect(takesTouch(bubble)).toBe(false)
    expect(takesTouch(getByTestId(id('RoomPostRetry')))).toBe(true)
    fireEvent.press(bubble)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  test('a post with a long press takes the touch itself, and a long press reaches it', () => {
    const onLongPress = jest.fn()
    const { getByTestId } = show({ onLongPress })
    const bubble = getByTestId(id('RoomPostBubble'))
    expect(takesTouch(bubble)).toBe(true)
    fireEvent(bubble, 'longPress')
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  test('a post with no long press and no retry takes no touch, so the list scrolls from it', () => {
    expect(takesTouch(show({}).getByTestId(id('RoomPostBubble')))).toBe(false)
  })

  test('the author and a file inside the bubble still take their own tap while it holds a long press', () => {
    const onOpenAuthor = jest.fn()
    const author = { did: 'did:peer:noor', identityWords: 'river-stone' }
    const { getByTestId } = show({ post: post({ mine: false, author }), onOpenAuthor, onLongPress: jest.fn() })
    fireEvent.press(getByTestId(id('RoomPostAuthor')))
    expect(onOpenAuthor).toHaveBeenCalledWith(author)
  })
})

// A post the agent could not open says so when its reason is one a plain retry does not change (removed, beyondChain), and keeps
// "couldn't be read" otherwise. The words name no cause: several room settings and membership changes lead here.
describe('RoomPostBubble: a post that was not opened', () => {
  test.each(['removed', 'beyondChain'] as const)("says it can't be opened when the agent says %s", (reason) => {
    const { getByTestId, queryByTestId, getByText } = show({ post: post({ unread: true, unreadWhy: reason }) })
    expect(getByTestId(id('RoomPostCannotOpen'))).toBeTruthy()
    expect(getByText('Rooms.PostCannotOpen')).toBeTruthy()
    expect(queryByTestId(id('RoomPostUnread'))).toBeNull()
  })

  test.each([
    ['notDelivered', 'notDelivered' as const],
    ['no reason', undefined],
  ])('keeps "couldn\'t be read" for %s (control)', (_what, reason) => {
    const { getByTestId, queryByTestId } = show({ post: post({ unread: true, unreadWhy: reason }) })
    expect(getByTestId(id('RoomPostUnread'))).toBeTruthy()
    expect(queryByTestId(id('RoomPostCannotOpen'))).toBeNull()
  })

  test('a removed post says removed, whatever reason is left on it (control)', () => {
    const { getByTestId, queryByTestId } = show({
      post: post({ unread: false, retracted: true, unreadWhy: 'beyondChain' }),
    })
    expect(getByTestId(id('RoomPostRemoved'))).toBeTruthy()
    expect(queryByTestId(id('RoomPostCannotOpen'))).toBeNull()
  })
})

// A message is written in about 3 s; until then its bubble said "Sending" on every one (11-17). It now says so only
// when the post is still on its way after that.
describe('RoomPostBubble: when a post on its way says so', () => {
  const SHIPPED = { ...ROOMS_SENDING_LABEL_WAITS }
  beforeEach(() => {
    jest.useFakeTimers()
    Object.assign(ROOMS_SENDING_LABEL_WAITS, { on: true, remoteOff: false })
  })
  afterEach(() => {
    jest.useRealTimers()
    Object.assign(ROOMS_SENDING_LABEL_WAITS, SHIPPED)
  })
  const sending = (over: Partial<RoomPost> = {}) => show({ post: post({ delivery: 'sending', ...over }) })
  const says = (tree: ReturnType<typeof show>) => tree.queryByText('Rooms.PostSending') !== null
  const opacity = (tree: ReturnType<typeof show>) =>
    ([] as Array<{ opacity?: number }>).concat(tree.getByTestId(id('RoomPostBubble')).props.style).find(Boolean)
      ?.opacity

  test('a message says nothing at first and is drawn as any other, still marked as on its way', () => {
    const tree = sending()
    expect(says(tree)).toBe(false)
    expect(opacity(tree)).toBe(1)
    expect(tree.getByTestId(id('RoomPostSending'))).toBeTruthy()
    act(() => void jest.advanceTimersByTime(ROOM_SENDING_LABEL_AFTER_MS - 1))
    expect(says(tree)).toBe(false)
  })

  // The bubble spaces its lines with a gap, and an empty view in its flow takes one: the bubble was 2 pt taller while
  // sending, and the chat moved by that when the post was written (279.3).
  test('the mark of a post quietly on its way is out of the flow, so the bubble is the size it will be once written', () => {
    const tree = sending()
    expect(StyleSheet.flatten(tree.getByTestId(id('RoomPostSending')).props.style)).toMatchObject({
      position: 'absolute',
    })
  })

  test('still on its way after the wait: it says "Sending", drawn lighter, as before', () => {
    const tree = sending()
    act(() => void jest.advanceTimersByTime(ROOM_SENDING_LABEL_AFTER_MS))
    expect(says(tree)).toBe(true)
    expect(opacity(tree)).toBe(0.7)
    expect(tree.getByTestId(id('RoomPostSending'))).toHaveTextContent('Rooms.PostSending')
  })

  test('written before the wait ends: it never says "Sending", and no mark is left', () => {
    const tree = sending()
    act(() => void jest.advanceTimersByTime(1000))
    tree.rerender(
      <BasicAppContext>
        <RoomPostBubble post={post()} />
      </BasicAppContext>
    )
    act(() => void jest.advanceTimersByTime(ROOM_SENDING_LABEL_AFTER_MS))
    expect(says(tree)).toBe(false)
    expect(tree.queryByTestId(id('RoomPostSending'))).toBeNull()
  })

  test('one that could not be sent says so at once, wait or no wait (control)', () => {
    const tree = show({ post: post({ delivery: 'failed' }), onRetry: jest.fn() })
    expect(tree.getByTestId(id('RoomPostNotSent'))).toBeTruthy()
    expect(opacity(tree)).toBe(0.7)
    expect(tree.queryByTestId(id('RoomPostSending'))).toBeNull()
  })

  test('failing during the wait shows "Not sent" then, not after it', () => {
    const tree = sending()
    act(() => void jest.advanceTimersByTime(500))
    tree.rerender(
      <BasicAppContext>
        <RoomPostBubble post={post({ delivery: 'failed' })} onRetry={jest.fn()} />
      </BasicAppContext>
    )
    expect(tree.getByTestId(id('RoomPostNotSent'))).toBeTruthy()
  })

  test("a file's upload shows its progress from the start (control)", () => {
    const tree = sending({ progress: 0.25 })
    expect(tree.getByTestId(id('RoomPostSending'))).toHaveTextContent('Rooms.PostSendingPercent')
    expect(opacity(tree)).toBe(0.7)
  })

  test.each([
    ['off', { on: false, remoteOff: false }],
    ['turned off remotely', { on: true, remoteOff: true }],
    ['not plainly on', { on: 'yes' as unknown as boolean, remoteOff: false }],
  ])('with the switch %s, "Sending" shows from the first moment, as before (control)', (_name, values) => {
    Object.assign(ROOMS_SENDING_LABEL_WAITS, values)
    const tree = sending()
    expect(says(tree)).toBe(true)
    expect(opacity(tree)).toBe(0.7)
  })
})
