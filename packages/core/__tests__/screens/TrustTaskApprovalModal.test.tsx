import { Attribute } from '@bifold/oca/build/legacy'
import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import TrustTaskApprovalModal from '../../src/screens/TrustTaskApprovalModal'
import { testIdWithKey } from '../../src/utils/testable'
import { ITrustTaskDisplayRegistry } from '../../src/types/trust-task-display'

const TYPE_URI = 'https://example.org/spec/x/0.1'

const stubDisplayRegistry: ITrustTaskDisplayRegistry = {
  register: jest.fn(),
  getDisplayInfo: () => ({
    title: 'Access request',
    fields: [
      new Attribute({
        name: 'resource',
        label: 'Resource',
        value:
          'a very long free-text resource description that would have overflowed the old side-by-side row layout entirely, regardless of how wide the container was',
      }),
    ],
    approveLabel: 'Global.Accept',
    denyLabel: 'Global.Decline',
  }),
}

describe('TrustTaskApprovalModal', () => {
  const onApprove = jest.fn()
  const onDeny = jest.fn()

  beforeEach(() => jest.clearAllMocks())

  it('makes the requester the dominant, clearly-labeled heading', () => {
    const { getByText, getByTestId } = render(
      <TrustTaskApprovalModal
        typeUri={TYPE_URI}
        document={{}}
        summary="wants access to something"
        counterpartyLabel="Alice Smith"
        displayRegistry={stubDisplayRegistry}
        onApprove={onApprove}
        onDeny={onDeny}
      />
    )

    expect(getByText('Request from')).toBeTruthy()
    const name = getByTestId(testIdWithKey('TrustTaskApprovalCounterparty'))
    expect(name.props.children).toBe('Alice Smith')
    // Bold and larger than plain body text — the two things asked for.
    expect(name.props.style).toContainEqual(expect.objectContaining({ fontWeight: '800', fontSize: 32 }))
  })

  it('renders a long field value without truncating it', () => {
    const { getByText } = render(
      <TrustTaskApprovalModal
        typeUri={TYPE_URI}
        document={{}}
        summary="wants access to something"
        counterpartyLabel="Alice Smith"
        displayRegistry={stubDisplayRegistry}
        onApprove={onApprove}
        onDeny={onDeny}
      />
    )

    const value = getByText(
      'a very long free-text resource description that would have overflowed the old side-by-side row layout entirely, regardless of how wide the container was'
    )
    expect(value.props.style).toEqual(expect.objectContaining({ flexWrap: 'wrap', flexShrink: 1 }))
  })

  it('answers Approve/Deny through the callbacks passed in', () => {
    const { getByTestId } = render(
      <TrustTaskApprovalModal
        typeUri={TYPE_URI}
        document={{}}
        summary="wants access to something"
        counterpartyLabel="Alice Smith"
        displayRegistry={stubDisplayRegistry}
        onApprove={onApprove}
        onDeny={onDeny}
      />
    )

    fireEvent.press(getByTestId(testIdWithKey('TrustTaskApprove')))
    fireEvent.press(getByTestId(testIdWithKey('TrustTaskDeny')))

    expect(onApprove).toHaveBeenCalledTimes(1)
    expect(onDeny).toHaveBeenCalledTimes(1)
  })
})
