/**
 * 220: a vetter's ticket for another community is refused before anything is
 * sent, and the person is told why — in words, naming both communities.
 */
import i18n from 'i18next'

import en from '../../../localization/en/en.json'
import { communityTarget } from '../module/vtiCommunityLink'
import { VettingTicketError } from '../module/vtiVetting'
import { ticketRefusalWords } from '../screens/ticketWords'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
})
const t = i18n.t.bind(i18n)
const ours = 'did:webvh:QmOurs:vtc.ours.example'
const theirs = 'did:webvh:QmTheirs:vtc.theirs.example'

describe('a ticket the app refuses', () => {
  beforeEach(() => communityTarget.clear())

  it("another community's: names both, and says using it would show you to them", () => {
    communityTarget.publishedName(ours, 'Keyring Lab Community')
    const words = ticketRefusalWords(new VettingTicketError('otherCommunity', theirs), ours, t)
    expect(words).toBe(
      "This ticket is for vetting in an unnamed community (vtc.theirs.example), not Keyring Lab Community. Using it would show your identity to an unnamed community (vtc.theirs.example), so Keyring won't send it."
    )
    expect(words).not.toMatch(/did:/)
  })

  it('unreadable: says so, and nothing more', () => {
    expect(ticketRefusalWords(new VettingTicketError('unreadable'), ours, t)).toBe(
      "This isn't a vetter's ticket Keyring can read."
    )
  })
})
