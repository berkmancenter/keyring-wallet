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
    // Theirs published no name: "another community", never its host (IN-26).
    expect(words).toBe(
      "This ticket is for vetting in another community, not Keyring Lab Community. Using it would show your identity to another community, so Keyring won't send it."
    )
    expect(words).not.toMatch(/did:|vtc\.theirs\.example/)
  })

  it("another community's that published its name: named", () => {
    communityTarget.publishedName(ours, 'Keyring Lab Community')
    communityTarget.publishedName(theirs, 'Their Club')
    expect(ticketRefusalWords(new VettingTicketError('otherCommunity', theirs), ours, t)).toBe(
      "This ticket is for vetting in Their Club, not Keyring Lab Community. Using it would show your identity to Their Club, so Keyring won't send it."
    )
  })

  it('unreadable: says so, and nothing more', () => {
    expect(ticketRefusalWords(new VettingTicketError('unreadable'), ours, t)).toBe(
      "This isn't a vetter's ticket Keyring can read."
    )
  })
})
