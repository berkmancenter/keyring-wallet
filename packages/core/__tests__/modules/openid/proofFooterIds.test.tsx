/**
 * The proof request's buttons have their own ids. Send discloses credentials to a verifier; it carried the id of
 * accepting a credential offer (AcceptCredentialOffer), so a driver looking for an offer screen could find a proof
 * request and press Send.
 */
import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../helpers/app'
import OpenIDProofRequestFooter from '../../../src/modules/openid/features/OpenIDProofPresentation/components/OpenIDProofRequestFooter'
import { testIdWithKey } from '../../../src/utils/testable'

const OFFER_IDS = ['AcceptCredentialOffer', 'DeclineCredentialOffer', 'DismissCredentialOffer']

const footer = (props: object) => {
  const handlers = { onPressAccept: jest.fn(), onPressDecline: jest.fn(), onPressDismiss: jest.fn() }
  const tree = render(
    <BasicAppContext>
      <OpenIDProofRequestFooter buttonsVisible credential={{} as never} {...handlers} {...props} />
    </BasicAppContext>
  )
  return { tree, handlers }
}
const noOfferIds = (tree: ReturnType<typeof render>) =>
  OFFER_IDS.filter((key) => tree.queryByTestId(testIdWithKey(key)) !== null)

test('a request it can answer: Send and Decline under their own ids, none of an offer', () => {
  const { tree, handlers } = footer({
    submission: { areAllSatisfied: true, entries: [] },
    selectedCredentialsSubmission: { age: { id: 'card-1', claimFormat: 'ldp_vc' } },
  })
  fireEvent.press(tree.getByTestId(testIdWithKey('OpenIDProofSend')))
  expect(handlers.onPressAccept).toHaveBeenCalled()
  fireEvent.press(tree.getByTestId(testIdWithKey('OpenIDProofDecline')))
  expect(handlers.onPressDecline).toHaveBeenCalled()
  expect(noOfferIds(tree)).toEqual([])
})

test('a request it cannot answer: Dismiss under its own id, none of an offer', () => {
  const { tree, handlers } = footer({ submission: { areAllSatisfied: false, entries: [] } })
  fireEvent.press(tree.getByTestId(testIdWithKey('OpenIDProofDismiss')))
  expect(handlers.onPressDismiss).toHaveBeenCalled()
  expect(noOfferIds(tree)).toEqual([])
})

// The state every request opens in: one it can answer, with no credential chosen yet.
test('a request it can answer, before a credential is chosen: Dismiss under its own id, none of an offer', () => {
  const { tree, handlers } = footer({ submission: { areAllSatisfied: true, entries: [] } })
  fireEvent.press(tree.getByTestId(testIdWithKey('OpenIDProofDismiss')))
  expect(handlers.onPressDismiss).toHaveBeenCalled()
  expect(tree.queryByTestId(testIdWithKey('OpenIDProofSend'))).toBeNull()
  expect(noOfferIds(tree)).toEqual([])
})
