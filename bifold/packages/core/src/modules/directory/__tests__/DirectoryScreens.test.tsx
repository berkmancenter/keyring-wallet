/**
 * The directory screens on a community's made-up directory: the Members list (names with initials and roles, a page
 * at a time, members with no name folded into one line), "Your card" (the joined profile's name offered, sent only
 * after the consent sheet's Send, a changed profile name asked about and never synced, a card changed elsewhere read
 * again), and the two rows on the community screen that open them.
 */
import { useNavigation } from '@react-navigation/native'
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { CommunityDirectorySection } from '../components/CommunityDirectorySection'
import CommunityCard from '../screens/CommunityCard'
import CommunityMemberCard from '../screens/CommunityMemberCard'
import CommunityMembers from '../screens/CommunityMembers'
import { createFakeDirectoryService, type FakeDirectoryService } from '../testing/fakeDirectoryService'

const COMMUNITY = 'did:webvh:lab'
const id = (key: string) => testIdWithKey(key)

let mockService: FakeDirectoryService
let mockMe: { name?: string; profileId?: string } = {}
let mockParams: Record<string, string> = {}
jest.mock('../useDirectory', () => ({
  ...jest.requireActual('../useDirectory'),
  useDirectoryService: () => mockService,
}))
jest.mock('../../rooms/useMyName', () => ({ useMyName: () => mockMe }))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useRoute: () => ({ params: { communityDid: COMMUNITY, ...mockParams } }),
}))

const show = (screen: React.ReactElement) => render(<BasicAppContext>{screen}</BasicAppContext>)
type Tree = ReturnType<typeof show>
const press = async (tree: Tree, key: string) => {
  await act(async () => {
    fireEvent.press(tree.getByTestId(id(key)))
  })
}

beforeEach(() => {
  mockMe = { name: 'Ana Lopez', profileId: 'profile-work' }
  mockParams = {}
})

describe('Members', () => {
  it('lists the members who show a name, with initials and role, and folds the rest into one line', async () => {
    mockService = createFakeDirectoryService({ members: 10 })
    const tree = show(<CommunityMembers />)
    await waitFor(() => tree.getByTestId(id('DirectoryMembersOwnWords')))
    // Every fifth fake member shows no name: 8 of 10 are listed.
    expect(tree.getAllByTestId(/DirectoryMember_dir_/)).toHaveLength(8)
    const first = within(tree.getByTestId(id('DirectoryMember_dir_member000000000000')))
    expect(first.getByText('Member 1')).toBeTruthy()
    expect(first.getByText('M1')).toBeTruthy()
    expect(first.getByText('Community.RoleAdmin')).toBeTruthy()
    expect(tree.getByTestId(id('DirectoryMembersUnnamed'))).toHaveTextContent('Directory.MembersNoName')
  })

  it('while more pages remain, says the unnamed count is so far', async () => {
    mockService = createFakeDirectoryService({ members: 30, pageSize: 10 })
    const tree = show(<CommunityMembers />)
    await waitFor(() => tree.getByTestId(id('DirectoryMembersUnnamed')))
    expect(tree.getByTestId(id('DirectoryMembersUnnamed'))).toHaveTextContent('Directory.MembersNoNameSoFar')
  })

  it('says a community has no directory, with nothing to retry', async () => {
    mockService = createFakeDirectoryService({ refuse: { listMembers: 'unsupportedType' } })
    const tree = show(<CommunityMembers />)
    await waitFor(() => tree.getByTestId(id('DirectoryMembersStatus')))
    expect(tree.getByTestId(id('DirectoryMembersStatus'))).toHaveTextContent('Directory.StatusNotServed')
    expect(tree.queryByTestId(id('DirectoryMembersReload'))).toBeNull()
  })

  it('offers Try again when the community did not answer', async () => {
    mockService = createFakeDirectoryService({ refuse: { listMembers: 'rateLimited' } })
    const tree = show(<CommunityMembers />)
    await waitFor(() => tree.getByTestId(id('DirectoryMembersReload')))
    expect(tree.getByTestId(id('DirectoryMembersStatus'))).toHaveTextContent('Directory.StatusUnreachable')
  })
})

describe('Your card', () => {
  it('offers the joined profile’s name, and sends nothing until Send on the consent sheet', async () => {
    mockService = createFakeDirectoryService()
    const tree = show(<CommunityCard />)
    await waitFor(() => tree.getByTestId(id('DirectoryCardNoName')))
    expect(tree.getByTestId(id('DirectoryCardField_did'))).toHaveTextContent(/Directory\.SeenBy/)

    await press(tree, 'DirectoryCardUseName')
    const sheet = within(tree.getByTestId(id('CardConsent')))
    expect(sheet.getByText('Ana Lopez')).toBeTruthy()
    expect(sheet.getByTestId(id('CardConsentAdmins'))).toHaveTextContent('Directory.ConsentAdmins')
    expect(sheet.getByTestId(id('CardConsentValue_displayName'))).toHaveTextContent(/Directory\.SeenBy/)

    await press(tree, 'CardConsentNotNow')
    expect(mockService.calls.some((c) => c.startsWith('setMyName'))).toBe(false)

    await press(tree, 'DirectoryCardUseName')
    await press(tree, 'CardConsentSend')
    await waitFor(() => tree.getByTestId(id('DirectoryCardSaved')))
    expect(mockService.calls).toContain('setMyName Ana Lopez @0')
    expect(tree.getByTestId(id('DirectoryCardNameValue'))).toHaveTextContent('Ana Lopez')
  })

  it('asks when the profile’s name changed, and Keep as is writes nothing', async () => {
    mockService = createFakeDirectoryService({ cardName: 'Ana' })
    const tree = show(<CommunityCard />)
    await waitFor(() => tree.getByTestId(id('DirectoryCardDiffers')))
    expect(tree.getByTestId(id('DirectoryCardNameValue'))).toHaveTextContent('Ana')
    await press(tree, 'DirectoryCardKeep')
    expect(tree.queryByTestId(id('DirectoryCardDiffers'))).toBeNull()
    expect(tree.queryByTestId(id('DirectoryCardUseName'))).toBeNull()
    expect(mockService.calls.some((c) => c.startsWith('setMyName'))).toBe(false)
  })

  it('a card changed elsewhere: says so, writes nothing, and shows the card as it is now', async () => {
    mockService = createFakeDirectoryService()
    const tree = show(<CommunityCard />)
    await waitFor(() => tree.getByTestId(id('DirectoryCardUseName')))
    mockService.changeElsewhere('Set in the portal')
    await press(tree, 'DirectoryCardUseName')
    await press(tree, 'CardConsentSend')
    await waitFor(() => tree.getByTestId(id('DirectoryCardFailed')))
    expect(tree.getByTestId(id('DirectoryCardFailed'))).toHaveTextContent('Directory.CardConflict')
    await waitFor(() => expect(tree.getByTestId(id('DirectoryCardNameValue'))).toHaveTextContent('Set in the portal'))
  })

  it('with no name on the profile, offers to open the profile instead', async () => {
    mockMe = { profileId: 'profile-work' }
    mockService = createFakeDirectoryService()
    const tree = show(<CommunityCard />)
    await waitFor(() => tree.getByTestId(id('DirectoryCardProfileNoName')))
    expect(tree.queryByTestId(id('DirectoryCardUseName'))).toBeNull()
    await press(tree, 'DirectoryCardOpenProfile')
    expect(useNavigation().navigate).toHaveBeenCalledWith(Screens.EditRCard, { profileId: 'profile-work' })
  })
})

describe('the community screen’s directory rows', () => {
  it('open Members and Your card for that community', async () => {
    mockService = createFakeDirectoryService()
    const tree = show(<CommunityDirectorySection communityDid={COMMUNITY} />)
    await press(tree, 'CommunityDirectoryMembers')
    expect(useNavigation().navigate).toHaveBeenCalledWith(Screens.CommunityMembers, { communityDid: COMMUNITY })
    await press(tree, 'CommunityDirectoryCard')
    expect(useNavigation().navigate).toHaveBeenCalledWith(Screens.CommunityCard, { communityDid: COMMUNITY })
    // Nothing is read until a screen is opened.
    expect(mockService.calls).toEqual([])
  })
})

describe('the community screen’s directory rows (276.10, option A)', () => {
  it('Your card names the member by the profile they joined with, and says who sees name and role', () => {
    mockService = createFakeDirectoryService()
    const tree = show(<CommunityDirectorySection communityDid={COMMUNITY} />)
    expect(tree.getByText('Directory.CardRowNamed')).toBeTruthy()
    expect(tree.getByText('AL')).toBeTruthy()
    expect(tree.getByText('Directory.CardRowSeen')).toBeTruthy()
    // Read from this phone only: the card itself is never asked for here (card/show creates one at VTC 0.12).
    expect(mockService.calls).toEqual([])
    expect(tree.toJSON()).toMatchSnapshot()
  })

  it('without a profile name it is plain "Your card" (control)', () => {
    mockMe = {}
    mockService = createFakeDirectoryService()
    const tree = show(<CommunityDirectorySection communityDid={COMMUNITY} />)
    expect(tree.getByText('Directory.CardRow')).toBeTruthy()
    expect(tree.queryByText('Directory.CardRowNamed')).toBeNull()
  })
})

describe('another member’s card', () => {
  const ANA = {
    name: 'Ana Lopez',
    role: 'member',
    entries: [
      { key: 'pronouns', label: 'Pronouns', value: { kind: 'text', text: 'she/her' } },
      { key: 'org.lab.licensed', label: 'Licensed', value: { kind: 'verified', text: 'Pharmacist' } },
    ],
  } as never

  it('opens from a member’s row, by their entry', async () => {
    mockService = createFakeDirectoryService({ members: 3 })
    const tree = show(<CommunityMembers />)
    await waitFor(() => tree.getByTestId(id('DirectoryMember_dir_member000000000001')))
    await press(tree, 'DirectoryMember_dir_member000000000001')
    expect(useNavigation().navigate).toHaveBeenCalledWith(Screens.CommunityMemberCard, {
      communityDid: COMMUNITY,
      entryId: 'dir_member000000000001',
    })
  })

  it('shows their name, role, whose card it is, and each field they show, a checked one marked', async () => {
    mockParams = { entryId: 'dir_ana' }
    mockService = createFakeDirectoryService({ cards: { dir_ana: ANA } })
    const tree = show(<CommunityMemberCard />)
    await waitFor(() => tree.getByTestId(id('MemberCardName')))
    expect(tree.getByTestId(id('MemberCardName'))).toHaveTextContent('Ana Lopez')
    expect(tree.getByTestId(id('MemberCardRole'))).toHaveTextContent('Community.RoleMember')
    expect(tree.getByTestId(id('MemberCardWhose'))).toHaveTextContent('Directory.TheirOwnCard')
    expect(tree.getByTestId(id('MemberCardField_pronouns'))).toHaveTextContent(/she\/her/)
    expect(tree.getByTestId(id('MemberCardField_org.lab.licensed'))).toHaveTextContent(/Directory\.CheckedAgainstCard/)
    expect(
      within(tree.getByTestId(id('MemberCardField_pronouns'))).queryByText('Directory.CheckedAgainstCard')
    ).toBeNull()
  })

  it('says there is no card to show when the community shows none', async () => {
    mockParams = { memberDid: 'did:key:bo', standIn: 'Member …bo' }
    mockService = createFakeDirectoryService({ cards: {} })
    const tree = show(<CommunityMemberCard />)
    await waitFor(() => tree.getByTestId(id('MemberCardNone')))
    expect(tree.getByTestId(id('MemberCardNone'))).toHaveTextContent('Directory.NoCardToShow')
  })

  it('a read that failed says so with Try again, never "no card"', async () => {
    mockParams = { memberDid: 'did:key:bo' }
    mockService = createFakeDirectoryService({ refuse: { showMember: 'rateLimited' } })
    const tree = show(<CommunityMemberCard />)
    await waitFor(() => tree.getByTestId(id('MemberCardStatus')))
    expect(tree.getByTestId(id('MemberCardStatus'))).toHaveTextContent('Directory.StatusUnreachable')
    expect(tree.getByTestId(id('MemberCardReload'))).toBeTruthy()
    expect(tree.queryByTestId(id('MemberCardNone'))).toBeNull()
  })
})
