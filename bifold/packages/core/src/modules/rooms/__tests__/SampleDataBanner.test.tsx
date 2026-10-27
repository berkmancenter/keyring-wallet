/**
 * "Sample data" shows exactly when the service is the sample: on, and off for a real service and for none.
 */
import { render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import SampleDataBanner from '../components/SampleDataBanner'

const show = (service?: { isSample: boolean }) =>
  render(
    <BasicAppContext>
      <SampleDataBanner service={service} />
    </BasicAppContext>
  )

describe('the Sample data banner', () => {
  test('shown for the sample service', () => {
    const tree = show({ isSample: true })
    expect(tree.getByTestId(testIdWithKey('RoomsSampleDataBanner'))).toBeTruthy()
    expect(tree.getByText('Rooms.SampleData')).toBeTruthy()
  })

  test('not shown for a real service, nor with no service (positive control above)', () => {
    expect(show({ isSample: false }).queryByTestId(testIdWithKey('RoomsSampleDataBanner'))).toBeNull()
    expect(show(undefined).queryByTestId(testIdWithKey('RoomsSampleDataBanner'))).toBeNull()
  })
})
