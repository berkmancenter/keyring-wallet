import { render, act } from '@testing-library/react-native'
import React from 'react'

import LoadingPlaceholder, {
  LoadingPlaceholderWorkflowType,
} from '../../../src/components/views/LoadingPlaceholder'
import { BasicAppContext } from '../../helpers/app'
import { testIdWithKey } from '../../../src/utils/testable'

describe('LoadingPlaceholder', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  const renderWithContext = (props: Partial<React.ComponentProps<typeof LoadingPlaceholder>> = {}) =>
    render(
      <BasicAppContext>
        <LoadingPlaceholder
          workflowType={LoadingPlaceholderWorkflowType.Connection}
          {...props}
        />
      </BasicAppContext>
    )

  test('shows slow loading message after timeout', () => {
    const { queryByTestId } = renderWithContext({
      timeoutDurationInMs: 5000,
    })

    expect(queryByTestId(testIdWithKey('SlowLoadTitle'))).toBeNull()

    act(() => {
      jest.advanceTimersByTime(5000)
    })

    expect(queryByTestId(testIdWithKey('SlowLoadTitle'))).toBeTruthy()
    expect(queryByTestId(testIdWithKey('SlowLoadBody'))).toBeTruthy()
  })

  test('calls onTimeoutTriggered when timeout fires', () => {
    const onTimeout = jest.fn()
    renderWithContext({
      timeoutDurationInMs: 3000,
      onTimeoutTriggered: onTimeout,
    })

    expect(onTimeout).not.toHaveBeenCalled()

    act(() => {
      jest.advanceTimersByTime(3000)
    })

    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  test('does not fire timeout when timeoutDurationInMs is 0', () => {
    const onTimeout = jest.fn()
    const { queryByTestId } = renderWithContext({
      timeoutDurationInMs: 0,
      onTimeoutTriggered: onTimeout,
    })

    act(() => {
      jest.advanceTimersByTime(60000)
    })

    expect(onTimeout).not.toHaveBeenCalled()
    expect(queryByTestId(testIdWithKey('SlowLoadTitle'))).toBeNull()
  })

  test('shows Cancel button when onCancelTouched is provided', () => {
    const onCancel = jest.fn()
    const { getByTestId } = renderWithContext({
      onCancelTouched: onCancel,
    })

    expect(getByTestId(testIdWithKey('Cancel'))).toBeTruthy()
  })

  test('hides Cancel button when onCancelTouched is not provided', () => {
    const { queryByTestId } = renderWithContext({})

    expect(queryByTestId(testIdWithKey('Cancel'))).toBeNull()
  })

  test('displays correct text for ReceiveOffer workflow', () => {
    const { getAllByText: _getAllByText, getByText } = renderWithContext({
      workflowType: LoadingPlaceholderWorkflowType.ReceiveOffer,
    })

    expect(getByText('LoadingPlaceholder.CredentialOffer')).toBeTruthy()
    expect(getByText('LoadingPlaceholder.YourOffer')).toBeTruthy()
  })

  test('displays correct text for ProofRequested workflow', () => {
    const { getByText } = renderWithContext({
      workflowType: LoadingPlaceholderWorkflowType.ProofRequested,
    })

    expect(getByText('LoadingPlaceholder.ProofRequest')).toBeTruthy()
    expect(getByText('LoadingPlaceholder.YourRequest')).toBeTruthy()
  })
})
