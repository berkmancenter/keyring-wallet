/**
 * A rooms operation's row: a working button when available; otherwise shown, disabled, with the words for
 * whose gap it is, and no action. Words from the service's reason, never the screen's guess.
 */
import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import RoomStatusRow from '../components/RoomStatusRow'
import type { OperationStatus, RoomsOperation, RoomsReason } from '../types'

const statusOf = (status: OperationStatus['status'], reason: RoomsReason): OperationStatus => ({
  status,
  reason,
  detail: 'test',
})
const show = (status: OperationStatus, onPress = jest.fn(), operation?: RoomsOperation) => {
  const tree = render(
    <BasicAppContext>
      <RoomStatusRow label="Group chat" status={status} operation={operation} onPress={onPress} testID="row" />
    </BasicAppContext>
  )
  return { tree, onPress }
}

describe('a rooms operation row', () => {
  test.each([
    ['clientNotBuilt', 'comingSoon', 'Rooms.ComingSoon'],
    ['notBuiltUpstream', 'comingSoon', 'Rooms.NotAvailableYet'],
    ['agentDoesNotServe', 'unavailable', 'Rooms.AgentNeedsUpdate'],
    ['adminOnly', 'unavailable', 'Rooms.AdminOnly'],
    ['noAgentLinked', 'unavailable', 'Rooms.NoAgentLinked'],
    ['agentUnknown', 'unavailable', 'Rooms.AgentUnknown'],
    ['communityDoesNotServe', 'unavailable', 'Rooms.CommunityNeedsUpdate'],
    ['detailsNotLoaded', 'unavailable', 'Rooms.DetailsNotLoaded'],
    ['communityUnreachable', 'unavailable', 'Rooms.CommunityUnreachable'],
  ] as const)('%s: shows "%s" words, disabled, and does nothing when pressed', (reason, status, words) => {
    const { tree, onPress } = show(statusOf(status, reason))
    expect(tree.getByText(words)).toBeTruthy()
    const row = tree.getByTestId('row')
    expect(row.props.accessibilityState).toEqual({ disabled: true })
    fireEvent.press(row)
    expect(onPress).not.toHaveBeenCalled()
  })

  test.each([
    ['write', 'Rooms.NoRightWrite'],
    ['curate', 'Rooms.NoRightCurate'],
    ['readNote', 'Rooms.NoRightRead'],
    ['openFile', 'Rooms.NoRightRead'],
    [undefined, 'Rooms.NoRightRead'],
  ] as const)('noRight for %s: worded for what the row does, disabled', (operation, words) => {
    const { tree, onPress } = show(statusOf('unavailable', 'noRight'), jest.fn(), operation)
    expect(tree.getByText(words)).toBeTruthy()
    expect(tree.getByTestId('row').props.accessibilityState).toEqual({ disabled: true })
    fireEvent.press(tree.getByTestId('row'))
    expect(onPress).not.toHaveBeenCalled()
  })

  test.each([['ok'], ['sample']] as const)('%s: a working button with no status words', (reason) => {
    const { tree, onPress } = show(statusOf('available', reason))
    expect(tree.queryByText(/Rooms\./)).toBeNull()
    fireEvent.press(tree.getByTestId('row'))
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})
