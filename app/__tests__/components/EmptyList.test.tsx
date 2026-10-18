import { fireEvent, render } from '@testing-library/react-native'
import { testIdWithKey } from '@bifold/core'
import { Text } from 'react-native'
import React from 'react'

import EmptyList from '@keyring-theme/components/EmptyList'
import { BasicAppContext } from '../../__mocks__/helpers/app'

describe('EmptyList Component', () => {
  test('renders correctly', () => {
    const tree = render(
      <BasicAppContext>
        <EmptyList />
      </BasicAppContext>
    )
    expect(tree).toMatchSnapshot()
  })

  // The new-navigation preview's Communities uses this same empty state.
  test('another empty state: its own icon, line and one button, and no Add credential', () => {
    const onAction = jest.fn()
    const tree = render(
      <BasicAppContext>
        <EmptyList
          icon={<Text>community-icon</Text>}
          message="No communities yet"
          description="Communities you join will appear here."
          actionTitle="Join a community"
          onAction={onAction}
          actionTestID="PreviewCommunitiesJoin"
          testID="PreviewCommunitiesEmpty"
        />
      </BasicAppContext>
    )
    expect(tree.getByTestId(testIdWithKey('PreviewCommunitiesEmpty'))).toBeTruthy()
    expect(tree.getByText('community-icon')).toBeTruthy()
    expect(tree.getByText('No communities yet')).toBeTruthy()
    expect(tree.getByText('Communities you join will appear here.')).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('AddFirstCredential'))).toBeNull()
    fireEvent.press(tree.getByTestId(testIdWithKey('PreviewCommunitiesJoin')))
    expect(onAction).toHaveBeenCalledTimes(1)
  })
})
