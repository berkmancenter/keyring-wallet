/**
 * The Wallet's community cards as a stack of passes: tucked behind each other with the newest in front, every one
 * a tap away, ten or more simply scrolling; other credentials keep their cards below; and an unread list waits
 * instead of saying there are no credentials. A pass opens its card in place, in the Wallet, and Back or "All cards"
 * returns to the stack.
 */
import { W3cCredentialRecord } from '@credo-ts/core'
import { useNavigation } from '@react-navigation/native'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { BackHandler } from 'react-native'
import { useCredentials } from '@bifold/react-hooks'

import ListCredentials from '../../src/screens/ListCredentials'
import { credentialRegistry } from '../../src/modules/openid/refresh/registry'
import { testIdWithKey } from '../../src/utils/testable'
import { COMMUNITY, membershipCard, roleCard } from '../helpers/cardVault'
import { BasicAppContext } from '../helpers/app'

jest.mock('react-native-localize', () => {})
jest.mock('@bifold/credo-tsp-adapter', () => ({}))
const mockUseOpenId = jest.fn()
jest.mock('../../src/modules/openid/context/OpenIDCredentialRecordProvider', () => ({
  ...jest.requireActual('../../src/modules/openid/context/OpenIDCredentialRecordProvider'),
  useOpenIDCredentials: () => mockUseOpenId(),
}))
jest.mock('../../src/modules/trust-tasks/module/useCommunityBrand', () => ({
  useCommunityBrand: () => ({
    known: true,
    value: { color: '#265373', pattern: 'waves', monogram: 'HT', fromAccent: false },
  }),
}))

const mockCredentials = useCredentials as jest.Mock

const proof = {
  type: 'DataIntegrityProof',
  cryptosuite: 'eddsa-jcs-2022',
  created: '2026-09-26T09:00:00Z',
  verificationMethod: `${COMMUNITY}#key-0`,
  proofPurpose: 'assertionMethod',
  proofValue: 'z3FXQjecWufY46yg5abdVZsXqLhxhueuSoZgNSARiKBk9czhSePTFehP8c3PGfb6a22gkfUKM7Mz2HnNhqFz5Rakm',
}
/** A community card as the Wallet holds it, made `daysAgo` days before the newest. */
function cardRecord(i: number, base: Record<string, unknown> = membershipCard): W3cCredentialRecord {
  const record = new W3cCredentialRecord({
    credentialInstances: [{ credential: { ...base, id: `urn:uuid:card-${i}`, proof } as never }],
  })
  record.createdAt = new Date(Date.parse('2026-09-26T09:00:00Z') + i * 60_000)
  return record
}

function holding(records: W3cCredentialRecord[], { isLoading = false, didcommLoading = false } = {}) {
  mockUseOpenId.mockReturnValue({
    openIdState: { w3cCredentialRecords: records, sdJwtVcRecords: [], mdocVcRecords: [], isLoading },
  } as never)
  mockCredentials.mockReturnValue({ records: [], loading: didcommLoading })
}
// A new element each time, so a re-render with other records reaches the screen (an identical element is skipped).
const screen = () => (
  <BasicAppContext>
    <ListCredentials />
  </BasicAppContext>
)
function wallet(records: W3cCredentialRecord[], loading: { isLoading?: boolean; didcommLoading?: boolean } = {}) {
  holding(records, loading)
  return render(screen())
}

// RN's jest BackHandler hands back no subscription; the app's does.
const mockBackRemove = jest.fn()
let backListener: jest.SpyInstance

describe('the Wallet’s community cards', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    backListener = jest.spyOn(BackHandler, 'addEventListener').mockReturnValue({ remove: mockBackRemove } as never)
  })
  afterEach(() => backListener.mockRestore())

  test('stacked as passes, the newest in front, its dates shown and no other pass’s', async () => {
    const tree = wallet([cardRecord(1), cardRecord(2, roleCard), cardRecord(3)])
    const passes = await tree.findAllByTestId(testIdWithKey('CommunityPass'))
    expect(passes).toHaveLength(3)
    // Only the pass in front shows its dates: one "Member since" label in the whole stack.
    expect(tree.getAllByText(/Member since|Community\.PassMemberSince/)).toHaveLength(1)
    expect(tree.getByTestId(testIdWithKey('PassStack'))).toBeTruthy()
  })

  test('tapping any pass, front or tucked, opens that card in place: its Details, the e2e ids, no other screen', async () => {
    const records = [cardRecord(1), cardRecord(2), cardRecord(3)]
    const tree = wallet(records)
    const navigation = useNavigation()
    const passes = await tree.findAllByTestId(testIdWithKey('CommunityPass'))
    // Drawn oldest first: passes[0] is the oldest, tucked at the back.
    fireEvent.press(passes[0])
    expect(tree.getByTestId(testIdWithKey('CommunityCardDetails'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('CommunityCardRole'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('CommunityCardOpenCommunity'))).toBeTruthy()
    // One pass now (the open one), no stack, and no navigation away from the Wallet.
    expect(tree.getAllByTestId(testIdWithKey('CommunityPass'))).toHaveLength(1)
    expect(tree.queryByTestId(testIdWithKey('PassStack'))).toBeNull()
    expect(navigation.navigate).not.toHaveBeenCalled()
    expect(tree.queryByText(/EmptyList/)).toBeNull()
  })

  test('"All cards" returns to the whole stack, and the front pass opens too', async () => {
    const tree = wallet([cardRecord(1), cardRecord(2), cardRecord(3)])
    fireEvent.press((await tree.findAllByTestId(testIdWithKey('CommunityPass')))[2])
    expect(tree.getByTestId(testIdWithKey('CommunityCardDetails'))).toBeTruthy()
    fireEvent.press(tree.getByTestId(testIdWithKey('PassOpenClose')))
    expect(tree.queryByTestId(testIdWithKey('CommunityCardDetails'))).toBeNull()
    expect(tree.getAllByTestId(testIdWithKey('CommunityPass'))).toHaveLength(3)
  })

  test('Back closes an open card (and is the Wallet’s only while one is open)', async () => {
    const added = backListener
    {
      const tree = wallet([cardRecord(1), cardRecord(2)])
      await tree.findAllByTestId(testIdWithKey('CommunityPass'))
      // Nothing open: the Wallet leaves Back alone (positive control for the listener below).
      expect(added).not.toHaveBeenCalled()
      fireEvent.press(tree.getAllByTestId(testIdWithKey('CommunityPass'))[0])
      expect(added).toHaveBeenCalledWith('hardwareBackPress', expect.any(Function))
      const onBack = added.mock.calls[0][1] as () => boolean
      let handled = false
      await act(async () => {
        handled = onBack()
      })
      expect(handled).toBe(true)
      expect(tree.queryByTestId(testIdWithKey('CommunityCardDetails'))).toBeNull()
      expect(tree.getAllByTestId(testIdWithKey('CommunityPass'))).toHaveLength(2)
      // Closed: the listener is gone, so Back is the screen's again.
      expect(mockBackRemove).toHaveBeenCalledTimes(1)
    }
  })

  test('a card the community changes, stored again under a new record id, stays open', async () => {
    const first = [cardRecord(1), cardRecord(2)]
    const tree = wallet(first)
    fireEvent.press((await tree.findAllByTestId(testIdWithKey('CommunityPass')))[1])
    expect(tree.getByTestId(testIdWithKey('CommunityCardDetails'))).toBeTruthy()
    // The same card (same credential id), a new record: as syncCardsToWallet stores a changed card.
    const again = cardRecord(2)
    expect(again.id).not.toBe(first[1].id)
    holding([first[0], again])
    tree.rerender(screen())
    expect(tree.getByTestId(testIdWithKey('CommunityCardDetails'))).toBeTruthy()
    // Gone altogether (left): the stack, with what is left in it.
    holding([first[0]])
    tree.rerender(screen())
    expect(tree.queryByTestId(testIdWithKey('CommunityCardDetails'))).toBeNull()
    expect(tree.getAllByTestId(testIdWithKey('CommunityPass'))).toHaveLength(1)
  })

  test('from an open card, Open community goes to the community', async () => {
    const tree = wallet([cardRecord(1)])
    const navigation = useNavigation()
    fireEvent.press(await tree.findByTestId(testIdWithKey('CommunityPass')))
    fireEvent.press(tree.getByTestId(testIdWithKey('CommunityCardOpenCommunity')))
    expect(navigation.navigate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ params: expect.objectContaining({ params: { communityDid: COMMUNITY } }) })
    )
  })

  test('twelve cards: twelve passes, none folded away, each a strip in one scrolling stack', async () => {
    const tree = wallet(Array.from({ length: 12 }, (_, i) => cardRecord(i)))
    expect(await tree.findAllByTestId(testIdWithKey('CommunityPass'))).toHaveLength(12)
    expect(tree.getAllByTestId(testIdWithKey('PassStackItem'))).toHaveLength(12)
  })

  test('a card the credential registry marks invalid still says "Revoked" on its pass, as the card before did', async () => {
    const records = [cardRecord(1), cardRecord(2)]
    credentialRegistry.setState({ expired: [records[0].id] })
    try {
      const tree = wallet(records)
      const statuses = await tree.findAllByTestId(testIdWithKey('CommunityPassStatus'))
      // One pass of two: only the flagged card (the other is the positive control).
      expect(statuses).toHaveLength(1)
    } finally {
      credentialRegistry.setState({ expired: [] })
    }
  })

  test('community cards alone are not "no credentials"', async () => {
    const tree = wallet([cardRecord(1)])
    await tree.findAllByTestId(testIdWithKey('CommunityPass'))
    expect(tree.queryByText(/EmptyList/)).toBeNull()
  })
})

describe('the Wallet before it has been read', () => {
  test('waits, rather than saying there are no credentials, while either store is still being read', async () => {
    for (const loading of [{ isLoading: true }, { didcommLoading: true }]) {
      const tree = wallet([], loading)
      expect(await tree.findByTestId('ListCredentialsLoading')).toBeTruthy()
      expect(tree.queryByText(/EmptyList/)).toBeNull()
      tree.unmount()
    }
  })

  test('read and empty: says so (positive control for the waits above)', async () => {
    const tree = wallet([])
    expect(await tree.findByText(/EmptyList|no credentials/i)).toBeTruthy()
    expect(tree.queryByTestId('ListCredentialsLoading')).toBeNull()
  })
})
