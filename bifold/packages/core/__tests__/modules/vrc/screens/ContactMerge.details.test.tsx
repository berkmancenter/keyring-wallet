/**
 * "Same person?" on a contact's screen: offered when another contact gives the same name, merged only after the person
 * confirms, labelled as their own word (never as confirmed by the other phone), and separated again.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { container } from 'tsyringe'
import { useAgent } from '@bifold/react-hooks'

import ContactDetails from '../../../../src/modules/vrc/screens/ContactDetails'
import { ContainerProvider } from '../../../../src/container-api'
import { MainContainer } from '../../../../src/container-impl'
import { useOpenIDCredentials } from '../../../../src/modules/openid/context/OpenIDCredentialRecordProvider'
import { testIdWithKey } from '../../../../src/utils/testable'
import { memoryGenericRecords } from '../fixtures/memoryGenericRecords'
import { ALICE_AGAIN, ALICE_FIRST, BOB, SEVERAL_RELATIONSHIPS } from '../fixtures/severalRelationships'
import { createDTGCredential, generateTestDid } from '../fixtures/dtg-credentials'
import { CONTACT_LINK } from '../../../../src/modules/vrc/contacts/contactLinks'
import { ASK_SHOWN_FOR, CONTINUITY_ASK } from '../../../../src/modules/vrc/contacts/continuity'

jest.mock('@bifold/react-hooks')
// The shared mock returns bare keys; here a count is shown too, so a test can read how many relationships a removal
// names.
jest.mock('react-i18next', () => {
  const shared = jest.requireActual('../../../../__mocks__/react-i18next')
  const t = (key: string, options?: { count?: number }) =>
    options?.count !== undefined ? `${key} (count ${options.count})` : key
  return {
    ...shared,
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: async () => undefined, t } }),
  }
})
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon')
jest.mock('../../../../src/modules/openid/context/OpenIDCredentialRecordProvider')
const mockDeleteContact = jest.fn(async (_params: { issuerId: string; connectionId: string | null }) => true)
const mockAskToConfirm = jest.fn(async (..._args: unknown[]) => 'sent')
jest.mock('../../../../src/modules/vrc/contacts/continuity', () => ({
  ...jest.requireActual('../../../../src/modules/vrc/contacts/continuity'),
  askToConfirm: (...args: unknown[]) => mockAskToConfirm(...args),
}))
jest.mock('../../../../src/modules/vrc/hooks/useDeleteContact', () => ({
  useDeleteContact: () => ({ deleteContact: mockDeleteContact }),
}))
// The removal question itself is CommonRemoveModal's own business; here, confirming it is one button.
jest.mock('../../../../src/components/modals/CommonRemoveModal', () => {
  const { Pressable } = jest.requireActual('react-native')
  return ({ visible, onSubmit }: { visible: boolean; onSubmit: () => void }) =>
    visible ? <Pressable testID="ConfirmRemove" onPress={onSubmit} /> : null
})
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), getParent: jest.fn() }),
}))

const mockUseAgent = useAgent as jest.MockedFunction<typeof useAgent>
const mockUseOpenIDCredentials = useOpenIDCredentials as jest.MockedFunction<typeof useOpenIDCredentials>

const Container: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ContainerProvider value={new MainContainer(container.createChildContainer()).init()}>{children}</ContainerProvider>
)

let store: ReturnType<typeof memoryGenericRecords>
const open = (issuer: { id: string; name: string }) =>
  render(<ContactDetails route={{ params: { contact: { issuer } } } as any} navigation={{} as any} />, {
    wrapper: Container,
  })
const id = testIdWithKey

/**
 * The screen's links reads made after the last save (its re-read once a merge or separation has been stored), waited
 * for and then settled inside act, so what it shows is asserted after that read rather than within a time budget a
 * loaded CI worker can run out of (CI, 10-25: "expected 4, received 3"). Waiting for the read to be *made* is only a
 * render away (no I/O); the read itself is awaited, not timed.
 */
const reReadSettled = async () => {
  const readsAfterSave = () => {
    const saved = Math.max(0, ...store.save.mock.invocationCallOrder)
    return store.findAllByQuery.mock.invocationCallOrder.flatMap((order, i) =>
      order > saved ? [store.findAllByQuery.mock.results[i].value] : []
    )
  }
  await waitFor(() => expect(readsAfterSave().length).toBeGreaterThan(0), { timeout: 5000 })
  await act(async () => {
    await Promise.all(readsAfterSave())
  })
}

describe('Same person? on a contact', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => null)
    mockDeleteContact.mockClear()
    mockAskToConfirm.mockClear()
    store = memoryGenericRecords()
    mockUseAgent.mockReturnValue({
      agent: {
        config: { logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
        dependencyManager: {
          resolve: () => ({
            findByCounterpartyRelationshipDid: async (_context: unknown, did: string) =>
              ({ [ALICE_AGAIN.id]: { connectionId: 'conn-again' }, [ALICE_FIRST.id]: { connectionId: 'conn-first' } })[
                did
              ] ?? null,
          }),
        },
        genericRecords: store,
      },
    } as any)
    mockUseOpenIDCredentials.mockReturnValue({ openIdState: { w3cCredentialRecords: SEVERAL_RELATIONSHIPS } } as any)
  })
  afterEach(() => jest.restoreAllMocks())

  describe('every namesake at once', () => {
    const ALICE_THIRD = { id: generateTestDid('alice-third'), name: 'Alice Smith', email: 'alice@example.com' }
    const threeAlices = [
      ...SEVERAL_RELATIONSHIPS,
      createDTGCredential({
        issuer: ALICE_THIRD,
        credentialSubject: { id: 'did:peer:holder' },
        validFrom: '2026-06-01',
      }),
    ]
    beforeEach(() => {
      mockUseOpenIDCredentials.mockReturnValue({ openIdState: { w3cCredentialRecords: threeAlices } } as any)
    })

    test('three contacts with one name: one offer for both others, one confirmation, one merge', async () => {
      const tree = open(ALICE_AGAIN)
      expect(await tree.findByText('ContactDetails.MergeAllOfferBody (count 2)')).toBeTruthy()
      expect(tree.getByText('ContactDetails.MergeAll')).toBeTruthy()
      fireEvent.press(tree.getByTestId(id('ContactMergeOffer')))
      expect(tree.getByText('ContactDetails.MergeAllConfirmTitle (count 3)')).toBeTruthy()
      fireEvent.press(tree.getByTestId(id('ContactMergeYes')))

      await tree.findByTestId(id('ContactMergedByYou'))
      // Alice's first contact has two cards, the other two one each: all four on one contact, under the oldest.
      expect(tree.getAllByTestId(id('RelationshipLayer'))).toHaveLength(4)
      expect(new Map(store.records.map((r) => [r.content.issuerDid, r.content.contactId]))).toEqual(
        new Map([
          [ALICE_AGAIN.id, ALICE_FIRST.id],
          [ALICE_THIRD.id, ALICE_FIRST.id],
        ])
      )
      expect(tree.queryByTestId(id('ContactMergeOffer'))).toBeNull()
    })

    test('a merged contact is offered a namesake that came later, beside its merged state', async () => {
      store.records.push({
        id: 'earlier-merge',
        content: { issuerDid: ALICE_AGAIN.id, contactId: ALICE_FIRST.id, confirmation: 'user' },
        tags: { recordType: CONTACT_LINK, issuerDid: ALICE_AGAIN.id, contactId: ALICE_FIRST.id },
      })
      const tree = open(ALICE_AGAIN)
      expect(await tree.findByText('ContactDetails.MergeOfferBody (count 1)')).toBeTruthy()
      expect(tree.getByTestId(id('ContactMergedByYou'))).toBeTruthy()
      fireEvent.press(tree.getByTestId(id('ContactMergeOffer')))
      expect(tree.getByText('ContactDetails.MergeConfirmTitle (count 2)')).toBeTruthy()
      fireEvent.press(tree.getByTestId(id('ContactMergeYes')))
      // First what was stored (did the merge land?), then what the screen shows (did it read the links again?).
      await waitFor(() => expect(store.records).toHaveLength(2), { timeout: 5000 })
      expect(tree.queryByTestId(id('ContactMergeFailed'))).toBeNull()
      expect(new Map(store.records.map((r) => [r.content.issuerDid, r.content.contactId]))).toEqual(
        new Map([
          [ALICE_AGAIN.id, ALICE_FIRST.id],
          [ALICE_THIRD.id, ALICE_FIRST.id],
        ])
      )
      await reReadSettled()
      expect(tree.getAllByTestId(id('RelationshipLayer'))).toHaveLength(4)
      expect(tree.queryByTestId(id('ContactMergeOffer'))).toBeNull()
    })
  })

  test('someone with no namesake is not offered a merge', async () => {
    const tree = open(BOB)
    await waitFor(() => expect(tree.getByText('Bob Jones')).toBeTruthy())
    expect(tree.queryByTestId(id('ContactMerge'))).toBeNull()
  })

  test('a namesake is offered; backing out of the question changes nothing', async () => {
    const tree = open(ALICE_AGAIN)
    fireEvent.press(await tree.findByTestId(id('ContactMergeOffer')))
    expect(tree.getByTestId(id('ContactMergeConfirm'))).toBeTruthy()
    fireEvent.press(tree.getByTestId(id('ContactMergeBack')))
    expect(store.records).toHaveLength(0)
    expect(tree.getByTestId(id('ContactMergeOffer'))).toBeTruthy()
  })

  test('merging on the person’s word: labelled as theirs, both relationships’ cards, and separated again', async () => {
    const tree = open(ALICE_AGAIN)
    await waitFor(() => expect(tree.getAllByTestId(id('RelationshipLayer'))).toHaveLength(1))
    fireEvent.press(await tree.findByTestId(id('ContactMergeOffer')))
    fireEvent.press(tree.getByTestId(id('ContactMergeYes')))

    const label = await tree.findByTestId(id('ContactMergedByYou'))
    expect(label.props.children).toBe('ContactDetails.MergedByYou')
    expect(tree.getAllByTestId(id('RelationshipLayer'))).toHaveLength(3)
    expect(store.records).toHaveLength(1)
    expect(store.records[0].content.confirmation).toBe('user')

    // On the person's word alone, Separate is a quiet link, and it separates at once: merging again is as easy.
    expect(tree.getByText('ContactDetails.SeparateLink')).toBeTruthy()
    fireEvent.press(tree.getByTestId(id('ContactSeparate')))
    expect(tree.queryByTestId(id('ContactSeparateConfirm'))).toBeNull()
    await waitFor(() => expect(tree.getByTestId(id('ContactMergeOffer'))).toBeTruthy())
    expect(store.records).toHaveLength(0)
    expect(tree.getAllByTestId(id('RelationshipLayer'))).toHaveLength(1)
  })

  test('removing a merged contact removes every relationship, each with its own connection, and its links', async () => {
    store.records.push({
      id: 'link-1',
      content: { issuerDid: ALICE_AGAIN.id, contactId: ALICE_FIRST.id },
      tags: { recordType: CONTACT_LINK, issuerDid: ALICE_AGAIN.id, contactId: ALICE_FIRST.id, confirmation: 'user' },
    })
    const pop = jest.fn()
    const tree = render(
      <ContactDetails route={{ params: { contact: { issuer: ALICE_AGAIN } } } as any} navigation={{ pop } as any} />,
      { wrapper: Container }
    )
    await tree.findByTestId(id('ContactMergedByYou'))
    await waitFor(() =>
      expect(tree.getByTestId(id('ContactViewMessages')).props.accessibilityState?.disabled).toBe(false)
    )
    fireEvent.press(tree.getByTestId(id('ContactRemove')))
    // Not the plain removal question: one that says how many relationships go, with Separate right there.
    expect(tree.queryByTestId('ConfirmRemove')).toBeNull()
    expect(tree.getByTestId(id('ContactRemoveMergedBody')).props.children).toBe(
      'ContactDetails.MergedRemoveBody (count 2)'
    )
    expect(tree.getByTestId(id('ContactRemoveMergedSeparate'))).toBeTruthy()
    fireEvent.press(tree.getByTestId(id('ContactRemoveMergedConfirm')))

    await waitFor(() => expect(pop).toHaveBeenCalled())
    expect(mockDeleteContact.mock.calls.map((call) => call[0])).toEqual([
      { issuerId: ALICE_AGAIN.id, connectionId: 'conn-again' },
      { issuerId: ALICE_FIRST.id, connectionId: 'conn-first' },
    ])
    expect(store.records).toHaveLength(0)
  })

  test('a merged contact separated from the removal question loses nothing, and is offered again', async () => {
    store.records.push({
      id: 'link-1',
      content: { issuerDid: ALICE_AGAIN.id, contactId: ALICE_FIRST.id },
      tags: { recordType: CONTACT_LINK, issuerDid: ALICE_AGAIN.id, contactId: ALICE_FIRST.id, confirmation: 'user' },
    })
    const tree = open(ALICE_AGAIN)
    await tree.findByTestId(id('ContactMergedByYou'))
    fireEvent.press(tree.getByTestId(id('ContactRemove')))
    fireEvent.press(tree.getByTestId(id('ContactRemoveMergedSeparate')))
    await waitFor(() => expect(tree.getByTestId(id('ContactMergeOffer'))).toBeTruthy())
    expect(store.records).toHaveLength(0)
    expect(mockDeleteContact).not.toHaveBeenCalled()
  })

  test('removing a contact of one relationship asks the usual question, without a count', async () => {
    const tree = open(BOB)
    await waitFor(() => expect(tree.getByText('Bob Jones')).toBeTruthy())
    fireEvent.press(tree.getByTestId(id('ContactRemove')))
    expect(tree.getByTestId('ConfirmRemove')).toBeTruthy()
    expect(tree.queryByTestId(id('ContactRemoveMerged'))).toBeNull()
  })

  test('after a failed read of the links, removal finds the merge in storage and removes nothing it was not asked to', async () => {
    store.records.push({
      id: 'link-1',
      content: { issuerDid: ALICE_AGAIN.id, contactId: ALICE_FIRST.id },
      tags: { recordType: CONTACT_LINK, issuerDid: ALICE_AGAIN.id, contactId: ALICE_FIRST.id, confirmation: 'user' },
    })
    // The screen's own read fails, so it takes Alice for a contact of one relationship.
    store.findAllByQuery.mockRejectedValueOnce(new Error('storage busy'))
    const pop = jest.fn()
    const tree = render(
      <ContactDetails route={{ params: { contact: { issuer: ALICE_AGAIN } } } as any} navigation={{ pop } as any} />,
      { wrapper: Container }
    )
    await waitFor(() => expect(tree.getAllByTestId(id('RelationshipLayer'))).toHaveLength(1))
    expect(tree.queryByTestId(id('ContactMergedByYou'))).toBeNull()

    fireEvent.press(tree.getByTestId(id('ContactRemove')))
    fireEvent.press(tree.getByTestId('ConfirmRemove'))

    // The question answered was about one relationship; storage says two. Nothing goes, and the screen catches up.
    expect(await tree.findByTestId(id('ContactMergedByYou'))).toBeTruthy()
    expect(mockDeleteContact).not.toHaveBeenCalled()
    expect(pop).not.toHaveBeenCalled()
    expect(store.records).toHaveLength(1)
  })

  test('when the links cannot be read at all, nothing is removed', async () => {
    store.findAllByQuery.mockRejectedValue(new Error('storage unavailable'))
    const pop = jest.fn()
    const tree = render(
      <ContactDetails route={{ params: { contact: { issuer: BOB } } } as any} navigation={{ pop } as any} />,
      { wrapper: Container }
    )
    await waitFor(() => expect(tree.getByText('Bob Jones')).toBeTruthy())
    fireEvent.press(tree.getByTestId(id('ContactRemove')))
    fireEvent.press(tree.getByTestId('ConfirmRemove'))
    await waitFor(() => expect(store.findAllByQuery.mock.calls.length).toBeGreaterThanOrEqual(2))
    await new Promise((resolve) => setImmediate(resolve))
    expect(mockDeleteContact).not.toHaveBeenCalled()
    expect(pop).not.toHaveBeenCalled()
  })

  test('a merge changed elsewhere to another of the same size is not removed under the question asked', async () => {
    store.records.push({
      id: 'link-1',
      content: { issuerDid: ALICE_AGAIN.id, contactId: ALICE_FIRST.id },
      tags: { recordType: CONTACT_LINK, issuerDid: ALICE_AGAIN.id, contactId: ALICE_FIRST.id, confirmation: 'user' },
    })
    const pop = jest.fn()
    const tree = render(
      <ContactDetails route={{ params: { contact: { issuer: ALICE_AGAIN } } } as any} navigation={{ pop } as any} />,
      { wrapper: Container }
    )
    await tree.findByTestId(id('ContactMergedByYou'))
    fireEvent.press(tree.getByTestId(id('ContactRemove')))
    // Meanwhile, elsewhere: this relationship now belongs to a different contact of the same size (still 2).
    store.records[0] = {
      id: 'link-2',
      content: { issuerDid: ALICE_AGAIN.id, contactId: 'did:peer:another-alice' },
      tags: { recordType: CONTACT_LINK, issuerDid: ALICE_AGAIN.id, contactId: 'did:peer:another-alice' },
    }
    fireEvent.press(tree.getByTestId(id('ContactRemoveMergedConfirm')))

    await waitFor(() => expect(store.findAllByQuery.mock.calls.length).toBeGreaterThanOrEqual(3))
    await new Promise((resolve) => setImmediate(resolve))
    expect(mockDeleteContact).not.toHaveBeenCalled()
    expect(pop).not.toHaveBeenCalled()
    expect(store.records).toHaveLength(1)
  })

  const mergedLink = (confirmation: 'user' | 'peer') => ({
    id: 'link-1',
    content: { issuerDid: ALICE_AGAIN.id, contactId: ALICE_FIRST.id, confirmation },
    tags: { recordType: CONTACT_LINK, issuerDid: ALICE_AGAIN.id, contactId: ALICE_FIRST.id, confirmation },
  })
  const openWithConnection = (issuer: { id: string; name: string }) =>
    render(
      <ContactDetails route={{ params: { contact: { issuer } } } as any} navigation={{ pop: jest.fn() } as any} />,
      {
        wrapper: Container,
      }
    )

  test('merged on the person’s word: never shown as confirmed; their phone can be asked, and then says it was', async () => {
    store.records.push(mergedLink('user'))
    const tree = openWithConnection(ALICE_AGAIN)
    await tree.findByTestId(id('ContactMergedByYou'))
    expect(tree.queryByTestId(id('ContactMergeConfirmedByPhone'))).toBeNull()
    await waitFor(() =>
      expect(tree.getByTestId(id('ContactMergeAskPhone')).props.accessibilityState?.disabled).toBe(false)
    )
    fireEvent.press(tree.getByTestId(id('ContactMergeAskPhone')))
    expect(await tree.findByTestId(id('ContactMergeAsked'))).toBeTruthy()
    expect(mockAskToConfirm).toHaveBeenCalledWith(expect.anything(), expect.any(Map), ALICE_AGAIN.id)
    expect(tree.queryByTestId(id('ContactMergeConfirmedByPhone'))).toBeNull()
  })

  test('confirmed by the other phone: says so, instead of "merged by you"', async () => {
    store.records.push(mergedLink('peer'))
    const tree = openWithConnection(ALICE_AGAIN)
    expect(await tree.findByTestId(id('ContactMergeConfirmedByPhone'))).toBeTruthy()
    expect(tree.queryByTestId(id('ContactMergedByYou'))).toBeNull()
    expect(tree.queryByTestId(id('ContactMergeAskPhone'))).toBeNull()
  })

  test('confirmed by the other phone: Separate asks first; Back keeps the merge, Separate undoes it', async () => {
    store.records.push(mergedLink('peer'))
    const tree = openWithConnection(ALICE_AGAIN)
    await tree.findByTestId(id('ContactMergeConfirmedByPhone'))
    fireEvent.press(tree.getByTestId(id('ContactSeparate')))
    // Asked, not done: the confirmed merge is still there.
    expect(await tree.findByTestId(id('ContactSeparateConfirm'))).toBeTruthy()
    expect(tree.getByText('ContactDetails.SeparateConfirmBody')).toBeTruthy()
    expect(store.records).toHaveLength(1)
    fireEvent.press(tree.getByTestId(id('ContactSeparateBack')))
    await waitFor(() => expect(tree.queryByTestId(id('ContactSeparateConfirm'))).toBeNull())
    expect(store.records).toHaveLength(1)
    // And through: separated, the confirmation forgotten with the link.
    fireEvent.press(tree.getByTestId(id('ContactSeparate')))
    fireEvent.press(await tree.findByTestId(id('ContactSeparateYes')))
    await waitFor(() => expect(store.records).toHaveLength(0))
    await waitFor(() => expect(tree.queryByTestId(id('ContactMergeConfirmedByPhone'))).toBeNull())
  })

  const askOn = (connectionId: string, askedAt: number) => ({
    id: `ask-${askedAt}`,
    content: { askedAt },
    tags: { recordType: CONTINUITY_ASK, connectionId, threadId: `t-${askedAt}` },
  })

  test('an ask from today shows as asked, without promising an answer', async () => {
    store.records.push(mergedLink('user'), askOn('conn-again', Date.now()))
    const tree = openWithConnection(ALICE_AGAIN)
    expect(await tree.findByTestId(id('ContactMergeAsked'))).toBeTruthy()
    expect(tree.queryByTestId(id('ContactMergeAskPhone'))).toBeNull()
  })

  test('an ask older than a day — perhaps a silent Not now — lets the person ask again', async () => {
    store.records.push(mergedLink('user'), askOn('conn-again', Date.now() - ASK_SHOWN_FOR - 1000))
    const tree = openWithConnection(ALICE_AGAIN)
    await tree.findByTestId(id('ContactMergedByYou'))
    await waitFor(() => expect(tree.getByTestId(id('ContactMergeAskPhone'))).toBeTruthy())
    expect(tree.queryByTestId(id('ContactMergeAsked'))).toBeNull()
  })
})
