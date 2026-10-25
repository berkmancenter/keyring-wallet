/**
 * What a community card's pass says, through real i18next: the community once (its name, else its DID's handle and
 * "No name published yet"), what the card is, one date, and how long it has left when that is soon. Also the screen
 * text review for the pass: no leftover {{…}}, HTML entity or "undefined" in any language.
 */
import i18next, { type TFunction } from 'i18next'

import { COMMUNITY, membershipCard, roleCard } from '../../../../__tests__/helpers/cardVault'
import { translationResources } from '../../../localization'
import { localDate } from '../screens/localTime'
import { setCardAgentNames } from '../screens/communityCardDisplay'
import { LAPSING_WITHIN_DAYS, passFace } from '../screens/communityPass'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

async function words(lng: string): Promise<TFunction> {
  const i18n = i18next.createInstance()
  await i18n.init({ lng, fallbackLng: 'en', resources: translationResources })
  return i18n.t.bind(i18n) as TFunction
}

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-10-01T09:00:00Z') // 25 days before the fixtures' validUntil
const vetterGrant = {
  ...roleCard,
  credentialSubject: {
    ...(roleCard.credentialSubject as Record<string, unknown>),
    endorsement: { type: 'CommunityRole', role: 'vetter', communityDid: COMMUNITY },
  },
}
const adminCard = {
  ...roleCard,
  credentialSubject: {
    ...(roleCard.credentialSubject as Record<string, unknown>),
    endorsement: { type: 'CommunityRole', role: 'admin', communityDid: COMMUNITY },
  },
}

describe('a community card’s pass', () => {
  // "Member" is also what an end-to-end flow reads on the card's Details (CommunityCardRole, matched by \bmember\b in
  // run-join-waiting): a change to Community.PassMember's English fails here first, not hours later on the gate.
  test('a membership: the community’s name once, "Member", and since when', async () => {
    const t = await words('en')
    const face = passFace(membershipCard, t, 'Harbor Tenants Union', NOW - 60 * DAY)!
    expect(face).toMatchObject({
      title: 'Harbor Tenants Union',
      published: 'Harbor Tenants Union',
      kind: 'Member',
      field: { label: 'Member since', value: localDate('2026-09-26T09:00:00.000Z') },
      secondField: { label: 'Valid until', value: localDate('2026-10-26T09:00:00.000Z') },
    })
    expect(face.unnamedNote).toBeUndefined()
    expect(face.lapsing).toBeUndefined()
  })

  test('a community with no name: its DID’s handle, and a line that says so', async () => {
    const t = await words('en')
    const face = passFace(membershipCard, t, undefined, NOW - 60 * DAY)!
    expect(face.title).toBe('keyring-test-vtc')
    expect(face.published).toBeUndefined()
    expect(face.unnamedNote).toBe('No name published yet')
  })

  test('a role card says the role; a vetter grant says how long it lasts, first', async () => {
    const t = await words('en')
    expect(passFace(adminCard, t, 'Guild', NOW - 60 * DAY)!).toMatchObject({ kind: 'Admin', field: { label: 'Since' } })
    expect(passFace(vetterGrant, t, 'Guild', NOW - 60 * DAY)!).toMatchObject({
      kind: 'Vetter',
      field: { label: 'Valid until' },
      secondField: { label: 'Since' },
    })
  })

  test(`a card lapsing within ${LAPSING_WITHIN_DAYS} days says how many are left, in the right plural`, async () => {
    const t = await words('en')
    expect(passFace(membershipCard, t, 'Guild', NOW)!.lapsing).toBe('25 days left')
    expect(passFace(membershipCard, t, 'Guild', Date.parse('2026-10-25T10:00:00Z'))!.lapsing).toBe('1 day left')
    // Positive control above; neither too early nor once lapsed.
    expect(passFace(membershipCard, t, 'Guild', NOW - 10 * DAY)!.lapsing).toBeUndefined()
    expect(passFace(membershipCard, t, 'Guild', Date.parse('2026-10-27T09:00:00Z'))!.lapsing).toBeUndefined()
  })

  test('one sentence for a screen reader: name, kind, date, time left', async () => {
    const t = await words('en')
    expect(passFace(membershipCard, t, 'Guild', NOW)!.accessibilityLabel).toBe(
      `Guild, Member, Member since ${localDate('2026-09-26T09:00:00.000Z')}, Valid until ${localDate(
        '2026-10-26T09:00:00.000Z'
      )}, 25 days left`
    )
  })

  test('on a phone with several agents, whose card it is: the agent holding its identity', async () => {
    const t = await words('en')
    const subject = (membershipCard.credentialSubject as { id: string }).id
    setCardAgentNames(new Map([[subject, 'Personal']]))
    try {
      const face = passFace(membershipCard, t, 'Guild', NOW)!
      expect(face.agent).toBe('Personal')
      expect(face.accessibilityLabel).toContain('Personal')
    } finally {
      setCardAgentNames(new Map())
    }
    // One agent: nothing added (positive control above).
    expect(passFace(membershipCard, t, 'Guild', NOW)!.agent).toBeUndefined()
  })

  test('any other credential has no pass', async () => {
    const t = await words('en')
    expect(passFace({ type: ['VerifiableCredential'], issuer: 'did:example:x' }, t, undefined)).toBeUndefined()
  })

  test.each(['en', 'fr', 'pt-BR'])('%s: every pass string reads as words, nothing left raw', async (lng) => {
    const t = await words(lng)
    for (const card of [membershipCard, adminCard, vetterGrant]) {
      for (const published of ['Guild', undefined]) {
        const face = passFace(card, t, published, NOW)!
        const all = [face.title, face.unnamedNote, face.kind, face.field?.label, face.secondField?.label, face.lapsing]
        for (const text of all.filter((s): s is string => !!s)) {
          expect(text).not.toMatch(/\{\{|&#x|&#\d|undefined|Community\./)
        }
      }
    }
  })
})
