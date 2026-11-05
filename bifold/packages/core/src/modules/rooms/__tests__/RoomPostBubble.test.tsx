/**
 * The bubble is a Pressable for its long press, inside the outer Pressable a failed post is tapped on to send again.
 * A disabled inner one has to leave the touch to the outer, or the retry is a button that does nothing.
 */
import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { RoomPostBubble } from '../components/RoomPostBubble'
import { toInertText } from '../inertText'
import type { RoomPost } from '../roomPosts'

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
