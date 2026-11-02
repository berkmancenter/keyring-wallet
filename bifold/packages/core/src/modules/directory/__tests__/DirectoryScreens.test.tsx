/**
 * The directory screens on a community's made-up directory: the Members list (names with initials and roles, a page
 * at a time, members with no name folded into one line), "Your card" (the joined profile's name offered, sent only
 * after the consent sheet's Send, a changed profile name asked about and never synced, a card changed elsewhere read
 * again), and the two rows on the community screen that open them. Pictures: shown where a card names one and its
 * checked bytes came back, initials otherwise.
 */
import { useNavigation } from '@react-navigation/native'
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { CommunityDirectorySection } from '../components/CommunityDirectorySection'
import { photoDigest } from '../myPhoto'
import { resetDirectoryPictures } from '../pictures'
import CommunityCard from '../screens/CommunityCard'
import CommunityMemberCard from '../screens/CommunityMemberCard'
import CommunityMembers from '../screens/CommunityMembers'
import { createFakeDirectoryService, type FakeDirectoryService } from '../testing/fakeDirectoryService'

const COMMUNITY = 'did:webvh:lab'
const id = (key: string) => testIdWithKey(key)

let mockService: FakeDirectoryService
let mockMe: { name?: string; profileId?: string; photo?: string } = {}
// What the phone remembers of the photo it put on the card, in memory: what the encrypted store would hold.
let mockSent: { profile: string; card: string } | undefined
jest.mock('../myPhoto', () => ({
  ...jest.requireActual('../myPhoto'),
  loadSentPhoto: jest.fn(async () => mockSent),
  keepSentPhoto: jest.fn(async (_agent: unknown, _community: string, sent?: { profile: string; card: string }) => {
    mockSent = sent
  }),
}))
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
  mockSent = undefined
  resetDirectoryPictures()
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

describe('pictures', () => {
  const A = 'a'.repeat(64)
  const B = 'b'.repeat(64)
  const C = 'c'.repeat(64)
  const pic = (sha256: string) => ({ sha256, mediaType: 'image/jpeg' as const })
  const URI = 'data:image/jpeg;base64,/9j/'
  const row = (n: number) => `DirectoryMemberPicture_dir_member${String(n).padStart(12, '0')}`

  it('a member who shows a picture has it in their row once its bytes check; the rest keep their initials', async () => {
    // Member 1 shows a picture that checks; member 2 one the community gave no checked bytes for; member 3 none.
    mockService = createFakeDirectoryService({
      members: 3,
      rowPictures: { 0: pic(A), 1: pic(B) },
      pictureUris: { [A]: URI },
    })
    const tree = show(<CommunityMembers />)
    await waitFor(() => tree.getByTestId(id(`${row(0)}_Photo`)))
    expect(tree.getByTestId(id(`${row(0)}_Photo`)).props.source).toEqual({ uri: URI })
    await waitFor(() => expect(mockService.calls).toContain('showPicture dir_member000000000001 bbbbbbbb'))
    expect(tree.getByTestId(id(`${row(1)}_Initials`))).toHaveTextContent('M2')
    expect(tree.getByTestId(id(`${row(2)}_Initials`))).toHaveTextContent('M3')
    // Asked only for the pictures cards name.
    expect(mockService.calls.filter((c) => c.startsWith('showPicture'))).toHaveLength(2)
  })

  it('a picture already read this run is shown again without asking (kept by digest, in memory)', async () => {
    mockService = createFakeDirectoryService({ members: 1, rowPictures: { 0: pic(A) }, pictureUris: { [A]: URI } })
    const first = show(<CommunityMembers />)
    await waitFor(() => first.getByTestId(id(`${row(0)}_Photo`)))
    first.unmount()
    const again = show(<CommunityMembers />)
    await waitFor(() => again.getByTestId(id(`${row(0)}_Photo`)))
    expect(mockService.calls.filter((c) => c.startsWith('showPicture'))).toHaveLength(1)
  })

  it('a card that now names another picture asks for that one (control for the kept picture)', async () => {
    mockService = createFakeDirectoryService({ members: 1, rowPictures: { 0: pic(A) }, pictureUris: { [A]: URI } })
    const first = show(<CommunityMembers />)
    await waitFor(() => first.getByTestId(id(`${row(0)}_Photo`)))
    first.unmount()
    mockService = createFakeDirectoryService({ members: 1, rowPictures: { 0: pic(C) }, pictureUris: {} })
    const again = show(<CommunityMembers />)
    await waitFor(() => expect(mockService.calls).toContain('showPicture dir_member000000000000 cccccccc'))
    expect(again.getByTestId(id(`${row(0)}_Initials`))).toBeTruthy()
  })

  it('a member card opened by entry shows the picture; one opened by DID keeps initials and asks for none', async () => {
    const card = { name: 'Ana Lopez', role: 'member', picture: pic(A), entries: [] } as never
    mockParams = { entryId: 'dir_ana' }
    mockService = createFakeDirectoryService({
      cards: { dir_ana: card, 'did:key:ana': card },
      pictureUris: { [A]: URI },
    })
    const byEntry = show(<CommunityMemberCard />)
    await waitFor(() => byEntry.getByTestId(id('MemberCardPhoto')))
    byEntry.unmount()
    resetDirectoryPictures()
    mockParams = { memberDid: 'did:key:ana' }
    mockService = createFakeDirectoryService({ cards: { 'did:key:ana': card }, pictureUris: { [A]: URI } })
    const byDid = show(<CommunityMemberCard />)
    await waitFor(() => byDid.getByTestId(id('MemberCardName')))
    expect(byDid.getByTestId(id('MemberCardInitials'))).toHaveTextContent('AL')
    expect(mockService.calls.filter((c) => c.startsWith('showPicture'))).toEqual([])
  })

  it('Your card on the community screen shows your picture only after Your card was read this run', async () => {
    mockService = createFakeDirectoryService({ cardName: 'Ana Lopez', cardPicture: pic(A), pictureUris: { [A]: URI } })
    const section = show(<CommunityDirectorySection communityDid={COMMUNITY} />)
    expect(section.getByTestId(id('CommunityDirectoryCardInitials'))).toHaveTextContent('AL')
    expect(mockService.calls).toEqual([])
    const card = show(<CommunityCard />)
    await waitFor(() => card.getByTestId(id('DirectoryCardNameValue')))
    await waitFor(() => section.getByTestId(id('CommunityDirectoryCardPhoto')))
    expect(mockService.calls).toEqual(['showMyCard', 'cardFields', 'showPicture dir_mine0000000000000000 aaaaaaaa'])
  })
})

describe('your photo on your card', () => {
  const PHOTO = 'data:image/jpeg;base64,/9j/4AAQ'
  const NEWER = 'data:image/jpeg;base64,/9j/4BBQ'
  const ids = (tree: Tree) =>
    tree
      .getByTestId(id('PhotoConsentScroll'))
      .findAll((n) => typeof n.props.testID === 'string' && n.props.testID.includes('PhotoConsent'))
      .map((n) => String(n.props.testID).replace(id(''), ''))
      .filter((key, i, all) => all.indexOf(key) === i)

  beforeEach(() => {
    mockMe = { name: 'Ana Lopez', profileId: 'profile-work', photo: PHOTO }
  })

  it('a community with no picture field offers no photo (control: one with it does)', async () => {
    mockService = createFakeDirectoryService({ cardName: 'Ana Lopez' })
    const without = show(<CommunityCard />)
    await waitFor(() => without.getByTestId(id('DirectoryCardNameValue')))
    expect(without.queryByTestId(id('DirectoryCardPhoto'))).toBeNull()
    without.unmount()
    mockService = createFakeDirectoryService({ cardName: 'Ana Lopez', pictureCeiling: 'public' })
    const withField = show(<CommunityCard />)
    await waitFor(() => withField.getByTestId(id('DirectoryCardPhotoUse')))
    expect(withField.getByTestId(id('DirectoryCardPhotoSeen'))).toHaveTextContent('Directory.CardPhotoNone')
  })

  it('sends nothing until Send; administrators only is picked first, all members is chosen and says so, beside Send', async () => {
    mockService = createFakeDirectoryService({ cardName: 'Ana Lopez', pictureCeiling: 'public' })
    const tree = show(<CommunityCard />)
    await waitFor(() => tree.getByTestId(id('DirectoryCardPhotoUse')))
    await press(tree, 'DirectoryCardPhotoUse')
    expect(mockService.calls.some((c) => c.startsWith('setMyPicture'))).toBe(false)
    expect(tree.getByTestId(id('PhotoConsentChoice_admins')).props.accessibilityState).toMatchObject({ checked: true })
    expect(tree.getByTestId(id('PhotoConsentChoice_members')).props.accessibilityState).toMatchObject({
      checked: false,
    })
    expect(tree.getByTestId(id('PhotoConsentSeen'))).toHaveTextContent('Directory.PhotoSeenByAdmins')
    await press(tree, 'PhotoConsentChoice_members')
    expect(tree.getByTestId(id('PhotoConsentChoice_members')).props.accessibilityState).toMatchObject({ checked: true })
    expect(tree.getByTestId(id('PhotoConsentSeen'))).toHaveTextContent(
      'Directory.PhotoSeenByMembers Directory.PhotoWidens'
    )
    expect(tree.getByTestId(id('PhotoConsentHostCopy'))).toHaveTextContent('Directory.PhotoHostCopy')
    expect(tree.getByTestId(id('PhotoConsentAdmins'))).toHaveTextContent('Directory.PhotoAdminsAlways')
    // The three lines come right before Send, and Send before Not now: nothing between the words and the button.
    expect(ids(tree).slice(-5)).toEqual([
      'PhotoConsentSeen',
      'PhotoConsentHostCopy',
      'PhotoConsentAdmins',
      'PhotoConsentSend',
      'PhotoConsentNotNow',
    ])
    await press(tree, 'PhotoConsentSend')
    await waitFor(() => tree.getByTestId(id('DirectoryCardPhotoSaved')))
    expect(mockService.calls).toContain('setMyPicture members @0')
    expect(tree.getByTestId(id('DirectoryCardPhotoSeen'))).toHaveTextContent('Directory.SeenBy')
    expect(tree.getByTestId(id('DirectoryCardField_avatar'))).toBeTruthy()
    expect(mockSent).toEqual({ profile: photoDigest(PHOTO), card: `01${'e'.repeat(62)}` })
  })

  it('administrators only says so, drops the widening line, and is what goes', async () => {
    mockService = createFakeDirectoryService({ cardName: 'Ana Lopez', pictureCeiling: 'public' })
    const tree = show(<CommunityCard />)
    await waitFor(() => tree.getByTestId(id('DirectoryCardPhotoUse')))
    await press(tree, 'DirectoryCardPhotoUse')
    await press(tree, 'PhotoConsentChoice_members')
    await press(tree, 'PhotoConsentChoice_admins')
    expect(tree.getByTestId(id('PhotoConsentSeen'))).toHaveTextContent('Directory.PhotoSeenByAdmins')
    expect(tree.getByTestId(id('PhotoConsentSeen'))).not.toHaveTextContent('Directory.PhotoWidens')
    await press(tree, 'PhotoConsentSend')
    await waitFor(() => tree.getByTestId(id('DirectoryCardPhotoSaved')))
    expect(mockService.calls).toContain('setMyPicture admins @0')
  })

  it('a community that lets only administrators see photos offers just that, and says why', async () => {
    mockService = createFakeDirectoryService({ cardName: 'Ana Lopez', pictureCeiling: 'connections' })
    const tree = show(<CommunityCard />)
    await waitFor(() => tree.getByTestId(id('DirectoryCardPhotoUse')))
    await press(tree, 'DirectoryCardPhotoUse')
    expect(tree.queryByTestId(id('PhotoConsentChoice_members'))).toBeNull()
    expect(tree.getByTestId(id('PhotoConsentChoice_admins')).props.accessibilityState).toMatchObject({ checked: true })
    expect(tree.getByTestId(id('PhotoConsentOnlyAdmins'))).toHaveTextContent('Directory.PhotoOnlyAdminsAllowed')
  })

  it('Not now sends nothing', async () => {
    mockService = createFakeDirectoryService({ cardName: 'Ana Lopez', pictureCeiling: 'public' })
    const tree = show(<CommunityCard />)
    await waitFor(() => tree.getByTestId(id('DirectoryCardPhotoUse')))
    await press(tree, 'DirectoryCardPhotoUse')
    await press(tree, 'PhotoConsentNotNow')
    expect(mockService.calls.some((c) => c.startsWith('setMyPicture'))).toBe(false)
  })

  it('Remove asks first, then takes it off; Not now leaves it', async () => {
    mockService = createFakeDirectoryService({
      cardName: 'Ana Lopez',
      pictureCeiling: 'public',
      cardPicture: { sha256: 'a'.repeat(64), mediaType: 'image/jpeg' },
    })
    const tree = show(<CommunityCard />)
    await waitFor(() => tree.getByTestId(id('DirectoryCardPhotoRemove')))
    // A photo already on the card, not this phone's: no offer to replace it.
    expect(tree.queryByTestId(id('DirectoryCardPhotoUse'))).toBeNull()
    await press(tree, 'DirectoryCardPhotoRemove')
    expect(tree.getByTestId(id('PhotoRemoveBody'))).toHaveTextContent('Directory.PhotoRemoveBody')
    await press(tree, 'PhotoRemoveNotNow')
    expect(mockService.calls.some((c) => c.startsWith('removeMyPicture'))).toBe(false)
    await press(tree, 'DirectoryCardPhotoRemove')
    await press(tree, 'PhotoRemoveConfirm')
    await waitFor(() => tree.getByTestId(id('DirectoryCardPhotoRemoved')))
    expect(mockService.calls).toContain('removeMyPicture @0')
    // Off the card, the phone forgets what it sent; a photo can go on again.
    expect(mockSent).toBeUndefined()
    await press(tree, 'DirectoryCardPhotoUse')
    await press(tree, 'PhotoConsentSend')
    await waitFor(() => tree.getByTestId(id('DirectoryCardPhotoSaved')))
    expect(mockService.calls).toContain('setMyPicture admins @1')
    expect(mockSent).toEqual({ profile: photoDigest(PHOTO), card: `02${'e'.repeat(62)}` })
  })

  it('taking off the photo this phone put there forgets what it sent', async () => {
    const onCard = { sha256: 'a'.repeat(64), mediaType: 'image/jpeg' as const }
    mockSent = { profile: photoDigest(PHOTO), card: onCard.sha256 }
    mockService = createFakeDirectoryService({ cardName: 'Ana Lopez', pictureCeiling: 'public', cardPicture: onCard })
    const tree = show(<CommunityCard />)
    await waitFor(() => tree.getByTestId(id('DirectoryCardPhotoRemove')))
    await press(tree, 'DirectoryCardPhotoRemove')
    await press(tree, 'PhotoRemoveConfirm')
    await waitFor(() => tree.getByTestId(id('DirectoryCardPhotoRemoved')))
    expect(mockSent).toBeUndefined()
  })

  it('says who saw a photo here until now whenever the choice reaches further, connections too (control: public)', async () => {
    mockService = createFakeDirectoryService({
      cardName: 'Ana Lopez',
      pictureCeiling: 'public',
      cardVisibility: { avatar: 'connections' },
    })
    const narrower = show(<CommunityCard />)
    await waitFor(() => narrower.getByTestId(id('DirectoryCardPhotoUse')))
    await press(narrower, 'DirectoryCardPhotoUse')
    await press(narrower, 'PhotoConsentChoice_members')
    expect(narrower.getByTestId(id('PhotoConsentSeen'))).toHaveTextContent(
      'Directory.PhotoSeenByMembers Directory.PhotoWidens'
    )
    narrower.unmount()
    mockService = createFakeDirectoryService({
      cardName: 'Ana Lopez',
      pictureCeiling: 'public',
      cardVisibility: { avatar: 'public' },
    })
    const wider = show(<CommunityCard />)
    await waitFor(() => wider.getByTestId(id('DirectoryCardPhotoUse')))
    await press(wider, 'DirectoryCardPhotoUse')
    await press(wider, 'PhotoConsentChoice_members')
    expect(wider.getByTestId(id('PhotoConsentSeen'))).toHaveTextContent('Directory.PhotoSeenByMembers')
    expect(wider.getByTestId(id('PhotoConsentSeen'))).not.toHaveTextContent('Directory.PhotoWidens')
  })

  it('opens on who the member already chose for their photo: all members stays all members (control for the default)', async () => {
    mockService = createFakeDirectoryService({
      cardName: 'Ana Lopez',
      pictureCeiling: 'public',
      cardVisibility: { avatar: 'members' },
    })
    const tree = show(<CommunityCard />)
    await waitFor(() => tree.getByTestId(id('DirectoryCardPhotoUse')))
    await press(tree, 'DirectoryCardPhotoUse')
    expect(tree.getByTestId(id('PhotoConsentChoice_members')).props.accessibilityState).toMatchObject({ checked: true })
    await press(tree, 'PhotoConsentSend')
    await waitFor(() => tree.getByTestId(id('DirectoryCardPhotoSaved')))
    expect(mockService.calls).toContain('setMyPicture members @0')
  })

  it('without a profile photo, offers to open the profile instead', async () => {
    mockMe = { name: 'Ana Lopez', profileId: 'profile-work' }
    mockService = createFakeDirectoryService({ cardName: 'Ana Lopez', pictureCeiling: 'public' })
    const tree = show(<CommunityCard />)
    await waitFor(() => tree.getByTestId(id('DirectoryCardPhotoNoProfilePhoto')))
    expect(tree.queryByTestId(id('DirectoryCardPhotoUse'))).toBeNull()
    await press(tree, 'DirectoryCardPhotoOpenProfile')
    expect(useNavigation().navigate).toHaveBeenCalledWith(Screens.EditRCard, { profileId: 'profile-work' })
  })

  it('asks when the profile photo changed since this phone put it there, and never updates by itself', async () => {
    const onCard = { sha256: 'a'.repeat(64), mediaType: 'image/jpeg' as const }
    mockSent = { profile: photoDigest(PHOTO), card: onCard.sha256 }
    mockMe = { name: 'Ana Lopez', profileId: 'profile-work', photo: NEWER }
    mockService = createFakeDirectoryService({ cardName: 'Ana Lopez', pictureCeiling: 'public', cardPicture: onCard })
    const tree = show(<CommunityCard />)
    await waitFor(() => tree.getByTestId(id('DirectoryCardPhotoDiffers')))
    expect(tree.getByTestId(id('DirectoryCardPhotoUse'))).toHaveTextContent('Directory.CardPhotoUpdate')
    expect(mockService.calls.some((c) => c.startsWith('setMyPicture'))).toBe(false)
    // An update keeps who sees the photo now (administrators, the field's default), not members first.
    await press(tree, 'DirectoryCardPhotoUse')
    expect(tree.getByTestId(id('PhotoConsentChoice_admins')).props.accessibilityState).toMatchObject({ checked: true })
    await press(tree, 'PhotoConsentSend')
    await waitFor(() => tree.getByTestId(id('DirectoryCardPhotoSaved')))
    expect(mockService.calls).toContain('setMyPicture admins @0')
  })

  it('does not ask when the photo is the same, or the card holds a picture this phone did not put there', async () => {
    const onCard = { sha256: 'a'.repeat(64), mediaType: 'image/jpeg' as const }
    mockSent = { profile: photoDigest(PHOTO), card: onCard.sha256 }
    mockService = createFakeDirectoryService({ cardName: 'Ana Lopez', pictureCeiling: 'public', cardPicture: onCard })
    const same = show(<CommunityCard />)
    await waitFor(() => same.getByTestId(id('DirectoryCardPhotoRemove')))
    expect(same.queryByTestId(id('DirectoryCardPhotoDiffers'))).toBeNull()
    same.unmount()
    mockSent = { profile: photoDigest(PHOTO), card: 'b'.repeat(64) }
    mockMe = { name: 'Ana Lopez', profileId: 'profile-work', photo: NEWER }
    const elsewhere = show(<CommunityCard />)
    await waitFor(() => elsewhere.getByTestId(id('DirectoryCardPhotoRemove')))
    expect(elsewhere.queryByTestId(id('DirectoryCardPhotoDiffers'))).toBeNull()
  })
})
