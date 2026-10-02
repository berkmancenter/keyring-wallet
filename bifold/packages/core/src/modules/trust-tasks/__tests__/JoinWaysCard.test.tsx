/**
 * The Join card for a 0.3 community: each way in, in the community's order,
 * with what it needs and what follows. The screen renders keys here; the
 * sentences are checked in joinWays.test.ts.
 */
import { render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { joinCard, type JoinOffer, type JoinWay } from '../screens/joinWays'
import { JoinWaysCard } from '../screens/JoinWaysCard'

const way = (over: Partial<JoinWay> & Pick<JoinWay, 'id'>): JoinWay => ({
  admission: 'automatic',
  requires: { invitation: false },
  requiresNothing: false,
  usable: true,
  meets: 'yes',
  digest: `digest-${over.id}`,
  ...over,
})
const review = way({ id: 'review', admission: 'review', requiresNothing: true })
const defaults: JoinOffer = {
  wire: '0.3',
  accepting: true,
  ways: [
    way({ id: 'invited', requires: { invitation: true }, meets: 'no' }),
    way({
      id: 'member-credential',
      requires: { invitation: false, credentials: { issuers: 'recognised', types: ['MembershipCredential'] } },
      meets: 'unknown',
    }),
    review,
  ],
  suggested: review,
  outcomeIfMet: 'reviewed',
}

const show = (offer: JoinOffer) => {
  const card = joinCard(offer)
  if (card.mode !== 'ways') throw new Error('expected ways')
  return render(
    <BasicAppContext>
      <JoinWaysCard card={card} community="Acme" />
    </BasicAppContext>
  )
}
const id = (key: string) => testIdWithKey(key)

test('the three defaults: each way, what it needs and what follows, and the one this phone can use', () => {
  const tree = show(defaults)
  expect(tree.getByTestId(id('JoinWaysSeveral'))).toHaveTextContent('Join.Ways.Several')
  expect(tree.getByTestId(id('JoinWay_invited'))).toHaveTextContent(/Join\.Ways\.NeedsInvitation/)
  expect(tree.getByTestId(id('JoinWayFollows_invited'))).toHaveTextContent('Join.Ways.FollowsAutomatic')
  expect(tree.getByTestId(id('JoinWay_member-credential'))).toHaveTextContent(/Join\.Ways\.NeedsCredentialRecognised/)
  expect(tree.getByTestId(id('JoinWay_review'))).toHaveTextContent(/Join\.Ways\.NeedsNothing/)
  expect(tree.getByTestId(id('JoinWayFollows_review'))).toHaveTextContent('Join.Ways.FollowsReview')
  // Only the review way is the one to use now.
  expect(tree.getAllByTestId(id('JoinWaySuggested'))).toHaveLength(1)
  expect(tree.getByTestId(id('JoinWay_review'))).toHaveTextContent(/Join\.Ways\.Suggested/)
  // Nothing is missing when there is a way to use.
  expect(tree.queryByTestId(id('JoinWaysMissing'))).toBeNull()
})

test('a review way never shows the admitted line', () => {
  const tree = show(defaults)
  expect(tree.getByTestId(id('JoinWay_review'))).not.toHaveTextContent(/FollowsAutomatic/)
})

test('one way only: no "more than one way" lead', () => {
  const tree = show({ wire: '0.3', accepting: true, ways: [review], suggested: review, outcomeIfMet: 'reviewed' })
  expect(tree.queryByTestId(id('JoinWaysSeveral'))).toBeNull()
})

test('nothing this phone can meet: says what is missing', () => {
  const tree = show({ wire: '0.3', accepting: true, ways: defaults.ways.slice(0, 2) })
  const missing = tree.getByTestId(id('JoinWaysMissing'))
  expect(missing).toHaveTextContent(/Join\.Ways\.MissingInvitation/)
  expect(missing).toHaveTextContent(/Join\.Ways\.MissingCredential/)
  expect(tree.queryByTestId(id('JoinWaySuggested'))).toBeNull()
})

test('vetting keeps today’s lines: statements, and the legal name', () => {
  const vetted = way({
    id: 'vetted-member',
    requires: { invitation: false, vetting: { statements: 2, claims: ['name.legal'], methods: [] } },
  })
  const tree = show({ wire: '0.3', accepting: true, ways: [vetted], suggested: vetted, outcomeIfMet: 'joined' })
  expect(tree.getByTestId(id('JoinWay_vetted-member'))).toHaveTextContent(/Join\.AsksStatements/)
  expect(tree.getByTestId(id('JoinWay_vetted-member'))).toHaveTextContent(/Join\.AsksLegalName/)
})

test('a way this app cannot use says so, and is not the one to use', () => {
  const odd = way({ id: 'odd', usable: false, unusableBecause: 'admissionUnknown', meets: 'no' })
  const tree = show({ wire: '0.3', accepting: true, ways: [odd, review], suggested: review, outcomeIfMet: 'reviewed' })
  expect(tree.getByTestId(id('JoinWay_odd'))).toHaveTextContent(/Join\.Ways\.CannotUse/)
})
