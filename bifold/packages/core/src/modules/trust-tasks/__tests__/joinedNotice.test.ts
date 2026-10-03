/**
 * "You're now a member of X": said once, when a community's membership card
 * makes this phone a member of a community it was not a current member of —
 * the first card, or the first after a removal. A renewed card for a current
 * membership, a role card and a grant say nothing.
 */
import { renderHook } from '@testing-library/react-native'
import i18n from 'i18next'
import { DeviceEventEmitter } from 'react-native'
import Toast from 'react-native-toast-message'

import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'
import { communityTarget } from '../module/vtiCommunityLink'
import { CREDENTIAL_EXCHANGE_ISSUE, receiveIssue, VTI_JOINED_EVENT } from '../module/vtiInbox'
import { TAB_BAR_CLEARANCE } from '../screens/aboveTabBar'
import { joinedWords, useVtiJoinedNotice } from '../screens/joinedNotice'
import { membership } from '../../../../__tests__/helpers/cardVault'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const COMMUNITY = membership.communityDid
const removal = {
  code: 'adminRemoved' as const,
  decidedBy: 'did:webvh:QmAdmin:vtc.example:admin',
  decidedAt: '2026-09-29T18:20:00Z',
  disposition: 'tombstone' as const,
  noticeId: 'urn:uuid:removal-notice-1',
}
const card = (type: string, id: string) => ({
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  id,
  type: ['VerifiableCredential', type],
  issuer: COMMUNITY,
  validFrom: '2026-10-02T19:00:00Z',
  credentialSubject: { id: membership.personaDid, ...(type === 'RoleCredential' ? { role: 'vetter' } : {}) },
})
const deliver = async (credential: object, existing?: object) => {
  const store = {
    getMembership: async () => existing,
    saveMembership: async () => undefined,
    saveHeldCredential: async () => undefined,
  }
  await receiveIssue(
    store as never,
    membership.personaDid,
    {
      id: 'urn:uuid:issue',
      type: CREDENTIAL_EXCHANGE_ISSUE,
      from: COMMUNITY,
      body: { credential_response: { credential } },
    } as never,
    { checkCard: async () => undefined } as never
  )
}

describe('when a membership card is news', () => {
  let heard: Array<{ communityDid?: string }>
  let sub: { remove: () => void }
  beforeEach(() => {
    heard = []
    sub = DeviceEventEmitter.addListener(VTI_JOINED_EVENT, (e) => heard.push(e))
  })
  afterEach(() => sub.remove())

  it('the first membership card for a community: said, for that community', async () => {
    await deliver(card('MembershipCredential', 'urn:uuid:first'))
    expect(heard).toEqual([{ communityDid: COMMUNITY }])
  })

  it('a renewed card for a current membership: not said again', async () => {
    await deliver(card('MembershipCredential', 'urn:uuid:renewed'), membership)
    expect(heard).toEqual([])
  })

  it('the first card after a removal: said, since the person is a member again', async () => {
    await deliver(card('MembershipCredential', 'urn:uuid:after-removal'), { ...membership, removal })
    expect(heard).toEqual([{ communityDid: COMMUNITY }])
  })

  it('the very card a removal ended, delivered again: not kept, so not said', async () => {
    await deliver(membership.vmc as object, { ...membership, removal })
    expect(heard).toEqual([])
  })

  it('a role card: not a membership, not said', async () => {
    await deliver(card('RoleCredential', 'urn:uuid:role'), membership)
    expect(heard).toEqual([])
  })
})

describe('the words', () => {
  beforeAll(async () => {
    await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
  })
  beforeEach(() => communityTarget.clear())
  const t = i18n.t.bind(i18n)

  it('name the community by the name it published, never by its DID', () => {
    communityTarget.publishedName(COMMUNITY, 'Keyring Lab Community')
    expect(joinedWords(COMMUNITY, t)).toBe("You're now a member of Keyring Lab Community.")
  })

  it('say "a community" when no name is known', () => {
    const words = joinedWords(COMMUNITY, t)
    expect(words).toBe("You're now a member of a community.")
    expect(words).not.toMatch(/did:/)
  })

  it('exist in every language', () => {
    for (const words of [en, fr, ptBr]) {
      expect((words.Join as Record<string, unknown>).NowMember).toMatch(/\{\{community\}\}/)
    }
  })
})

describe('the pop-up', () => {
  it('shows the words at the bottom when the event comes, and stops listening when gone', () => {
    const show = jest.spyOn(Toast, 'show').mockImplementation(() => undefined)
    const { unmount } = renderHook(() => useVtiJoinedNotice())
    DeviceEventEmitter.emit(VTI_JOINED_EVENT, { communityDid: COMMUNITY })
    expect(show).toHaveBeenCalledTimes(1)
    expect(show.mock.calls[0][0]).toMatchObject({ type: 'success', position: 'bottom', text1: expect.any(String) })
    // Clear of the tab bar: the library's own offset put it on the tabs for 8 s.
    expect((show.mock.calls[0][0] as { bottomOffset?: number }).bottomOffset).toBeGreaterThanOrEqual(TAB_BAR_CLEARANCE)
    unmount()
    DeviceEventEmitter.emit(VTI_JOINED_EVENT, { communityDid: COMMUNITY })
    expect(show).toHaveBeenCalledTimes(1)
    show.mockRestore()
  })
})
