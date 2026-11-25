import { render, fireEvent } from '@testing-library/react-native'
import React from 'react'

import CommonRemoveModal from '../../src/components/modals/CommonRemoveModal'
import { ModalUsage } from '../../src/types/remove'
import { testIdWithKey } from '../../src/utils/testable'

describe('CommonRemoveModal Component', () => {
  test('Rerenders correctly when not visible', async () => {
    const tree = render(<CommonRemoveModal visible={true} usage={ModalUsage.ContactRemove} />)

    expect(tree).toMatchSnapshot()
  })

  test('Controls trigger callbacks', async () => {
    const onSubmit = jest.fn()
    const onCancel = jest.fn()
    const tree = render(
      <CommonRemoveModal onSubmit={onSubmit} onCancel={onCancel} visible={true} usage={ModalUsage.ContactRemove} />
    )

    const confirmButton = tree.getByTestId(testIdWithKey('ConfirmRemoveButton'))
    const cancelDeclineButton = tree.getByTestId(testIdWithKey('CancelRemoveButton'))

    fireEvent(confirmButton, 'press')
    fireEvent(cancelDeclineButton, 'press')

    expect(onSubmit).toBeCalledTimes(1)
    expect(onCancel).toBeCalledTimes(1)
  })

  test('Remove contact renders correctly', async () => {
    const tree = render(<CommonRemoveModal visible={true} usage={ModalUsage.ContactRemove} />)

    expect(tree).toMatchSnapshot()
  })

  test('Remove contact renders correctly2', async () => {
    const tree = render(<CommonRemoveModal visible={true} usage={ModalUsage.ContactRemoveWithCredentials} />)

    expect(tree).toMatchSnapshot()
  })

  test('Remove credential renders correctly', async () => {
    const tree = render(<CommonRemoveModal visible={true} usage={ModalUsage.CredentialRemove} />)

    expect(tree).toMatchSnapshot()
  })

  test('Credential offer decline renders correctly', async () => {
    const tree = render(<CommonRemoveModal visible={true} usage={ModalUsage.CredentialOfferDecline} />)

    expect(tree).toMatchSnapshot()
  })

  test('Proof request decline renders correctly', async () => {
    const tree = render(<CommonRemoveModal visible={true} usage={ModalUsage.ProofRequestDecline} />)

    expect(tree).toMatchSnapshot()
  })

  test('Custom notification decline renders correctly', async () => {
    const tree = render(<CommonRemoveModal visible={true} usage={ModalUsage.CustomNotificationDecline} />)

    expect(tree).toMatchSnapshot()
  })

  test('Profile delete with contacts renders correctly and reports the contact count', async () => {
    const tree = render(
      <CommonRemoveModal visible={true} usage={ModalUsage.ProfileDeleteWithContacts} extraDetails="3" />
    )

    expect(tree.getByText('MyProfiles.DeleteWithContactsTitle')).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('ConfirmDeleteProfileButton'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('CancelDeleteProfileButton'))).toBeTruthy()
    expect(tree).toMatchSnapshot()
  })

  test('Profile delete with contacts triggers callbacks', async () => {
    const onSubmit = jest.fn()
    const onCancel = jest.fn()
    const tree = render(
      <CommonRemoveModal
        onSubmit={onSubmit}
        onCancel={onCancel}
        visible={true}
        usage={ModalUsage.ProfileDeleteWithContacts}
        extraDetails="1"
      />
    )

    fireEvent(tree.getByTestId(testIdWithKey('ConfirmDeleteProfileButton')), 'press')
    fireEvent(tree.getByTestId(testIdWithKey('CancelDeleteProfileButton')), 'press')

    expect(onSubmit).toBeCalledTimes(1)
    expect(onCancel).toBeCalledTimes(1)
  })
})
