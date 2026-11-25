/**
 * On a short phone (an iPhone SE is 667 pt tall) the notifications picture
 * shrinks, so "A notification only says that something is waiting" is read
 * above the buttons, not below the fold (234, SE look).
 */
import { render } from '@testing-library/react-native'
import React from 'react'
import { Dimensions, StyleSheet } from 'react-native'

import PushNotificationsContent from '../../src/components/views/PushNotificationsContent'
import { testIdWithKey } from '../../src/utils/testable'
import { BasicAppContext } from '../helpers/app'

const heightOf = (height: number) => {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 375, height, scale: 2, fontScale: 1 })
  const tree = render(
    <BasicAppContext>
      <PushNotificationsContent />
    </BasicAppContext>
  )
  return StyleSheet.flatten(tree.getByTestId(testIdWithKey('PushNotificationImage')).props.style).height
}

afterEach(() => jest.restoreAllMocks())

describe('the notifications picture', () => {
  it('is smaller on a short phone, so what a notification shows stays in view', () => {
    expect(heightOf(667)).toBe(120)
  })
  it('keeps its size on a taller phone', () => {
    expect(heightOf(844)).toBe(200)
  })
})
