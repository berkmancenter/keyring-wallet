/**
 * "You can now vet people for X": said once, when a vetter grant this phone
 * did not hold is kept — the first grant, or a new one after a revoke. The
 * same grant delivered again, a role card and a membership card say nothing
 * here (Alberto, 10-06: a toast, as other news has).
 */
import { renderHook } from '@testing-library/react-native'
import i18n from 'i18next'
import { DeviceEventEmitter } from 'react-native'
import Toast from 'react-native-toast-message'

import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'
import { communityTarget } from '../module/vtiCommunityLink'
import { CREDENTIAL_EXCHANGE_ISSUE, receiveIssue, VTI_VETTER_GRANTED_EVENT } from '../module/vtiInbox'
import { TAB_BAR_CLEARANCE } from '../screens/aboveTabBar'
import { useVtiVetterGrantedNotice, vetterGrantedWords } from '../screens/vetterNotice'
import { membership } from '../../../../__tests__/helpers/cardVault'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const COMMUNITY = membership.communityDid
const endorsement = (id: string, role: string) => ({
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  id,
  type: ['VerifiableCredential', 'EndorsementCredential'],
  issuer: COMMUNITY,
  validFrom: '2026-10-06T10:00:00Z',
  credentialSubject: {
    id: membership.personaDid,
    endorsement: { type: 'CommunityRole', role, communityDid: COMMUNITY },
  },
})
const deliver = async (credential: object, held: object[] = []) => {
  const store = {
    getMembership: async () => membership,
    saveMembership: async () => undefined,
    saveHeldCredential: async () => undefined,
    listHeldCredentials: async () => held,
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

describe('when a vetter grant is news', () => {
  let heard: Array<{ communityDid?: string }>
  let sub: { remove: () => void }
  beforeEach(() => {
    heard = []
    sub = DeviceEventEmitter.addListener(VTI_VETTER_GRANTED_EVENT, (e) => heard.push(e))
  })
  afterEach(() => sub.remove())

  it('the first grant for a community: said, for that community', async () => {
    await deliver(endorsement('urn:uuid:grant-1', 'vetter'))
    expect(heard).toEqual([{ communityDid: COMMUNITY }])
  })

  it('the same grant delivered again: not said again', async () => {
    const grant = endorsement('urn:uuid:grant-1', 'vetter')
    await deliver(grant, [{ kind: 'vetter-grant', communityDid: COMMUNITY, credential: grant }])
    expect(heard).toEqual([])
  })

  it('a new grant after an earlier one (a re-grant after a revoke): said', async () => {
    const earlier = endorsement('urn:uuid:grant-1', 'vetter')
    await deliver(endorsement('urn:uuid:grant-2', 'vetter'), [
      { kind: 'vetter-grant', communityDid: COMMUNITY, credential: earlier },
    ])
    expect(heard).toEqual([{ communityDid: COMMUNITY }])
  })

  it('a role card other than vetter: not said', async () => {
    await deliver(endorsement('urn:uuid:role', 'admin'))
    expect(heard).toEqual([])
  })
})

describe('the words', () => {
  beforeAll(async () => {
    await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
  })
  beforeEach(() => communityTarget.clear())
  const t = i18n.t.bind(i18n)

  it('name the community by the name it published, and say where the desk is', () => {
    communityTarget.publishedName(COMMUNITY, 'Keyring Lab Community')
    expect(vetterGrantedWords(COMMUNITY, t)).toEqual({
      title: 'You can now vet people for Keyring Lab Community.',
      hint: 'Open the vetting desk from Your agent.',
    })
  })

  it('never show a DID', () => {
    expect(vetterGrantedWords(COMMUNITY, t).title).not.toMatch(/did:/)
  })

  it('exist in every language', () => {
    for (const words of [en, fr, ptBr]) {
      const link = words.VtaLink as Record<string, unknown>
      expect(link.YouCanVetToast).toMatch(/\{\{community\}\}/)
      expect(typeof link.YouCanVetToastHint).toBe('string')
    }
  })
})

describe('the pop-up', () => {
  it('shows the words at the bottom, clear of the tabs, and stops listening when gone', () => {
    const show = jest.spyOn(Toast, 'show').mockImplementation(() => undefined)
    const { unmount } = renderHook(() => useVtiVetterGrantedNotice())
    DeviceEventEmitter.emit(VTI_VETTER_GRANTED_EVENT, { communityDid: COMMUNITY })
    expect(show).toHaveBeenCalledTimes(1)
    expect(show.mock.calls[0][0]).toMatchObject({
      type: 'success',
      position: 'bottom',
      text1: expect.any(String),
      text2: expect.any(String),
    })
    expect((show.mock.calls[0][0] as { bottomOffset?: number }).bottomOffset).toBeGreaterThanOrEqual(TAB_BAR_CLEARANCE)
    unmount()
    DeviceEventEmitter.emit(VTI_VETTER_GRANTED_EVENT, { communityDid: COMMUNITY })
    expect(show).toHaveBeenCalledTimes(1)
    show.mockRestore()
  })
})
