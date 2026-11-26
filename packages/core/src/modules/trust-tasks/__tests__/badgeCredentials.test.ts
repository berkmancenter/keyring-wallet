/**
 * Community badge credentials (member-badges plan, the Wallet part): a badge
 * a community issues is told apart, kept only for a current member of that
 * community, kept once however often it is renewed, and shown in the Wallet
 * as a card of its own — never fetched over the network, and never touching
 * an Open Badge that came some other way.
 */
import { W3cCredentialRecord } from '@credo-ts/core'

import { badgeCardView, badgeIdOf, badgeKeyOf, isBadgeCredential, laterBadge } from '../module/badgeCredentials'
import { resetCardStanding } from '../module/vtiCardStanding'
import { GenericRecordsCommunityStore, type VtiMembership } from '../module/VtiCommunityStore'
import { classifyCredential, CREDENTIAL_EXCHANGE_ISSUE, receiveIssue } from '../module/vtiInbox'
import { syncCardsToWallet } from '../module/vtiWalletCards'

import { fakeAgent, membershipCard } from '../../../../__tests__/helpers/cardVault'
import { BADGE_COMMUNITY, BADGE_IMAGE_SHA, BADGE_PERSONA, badgeCredential } from './fixtures/badgeCredential'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const OTHER_COMMUNITY = 'did:webvh:QmOther:vtc.example:another-vtc'
const NOW = Date.parse('2026-11-17T09:00:00Z')
const member: VtiMembership = {
  communityDid: BADGE_COMMUNITY,
  personaDid: BADGE_PERSONA,
  role: 'member',
  vmc: membershipCard,
  grantedAt: '2026-11-01T09:00:00Z',
  via: 'vetting',
}

const issue = (credential: Record<string, unknown>, from = BADGE_COMMUNITY) => ({
  id: 'urn:uuid:0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
  type: CREDENTIAL_EXCHANGE_ISSUE,
  from,
  body: { credential_response: { credential } },
})

/** A phone: generic records in memory, the real community store over them, and W3C records beside. */
function phone(memberships: VtiMembership[] = [member]) {
  const { agent, records } = fakeAgent()
  const store = new GenericRecordsCommunityStore(agent)
  const w3c: W3cCredentialRecord[] = []
  ;(agent as unknown as Record<string, unknown>).w3cCredentials = {
    getAll: async () => [...w3c],
    store: async ({ record }: { record: W3cCredentialRecord }) => void w3c.push(record),
    deleteById: async (id: string) => {
      const at = w3c.findIndex((r) => r.id === id)
      if (at >= 0) w3c.splice(at, 1)
    },
  }
  const wallet = () => w3c.map((r) => r.credentialInstances[0].credential as unknown as Record<string, unknown>)
  const deliver = async (credential: Record<string, unknown>, from = BADGE_COMMUNITY) => {
    const refused: string[] = []
    const kept = await receiveIssue(store, BADGE_PERSONA, issue(credential, from) as never, {
      checkCard: async () => undefined,
      onRefused: (_item, why) => void refused.push(why),
    })
    return { kept, refused }
  }
  const sync = () => syncCardsToWallet(agent, store, { now: NOW, linkedAgents: undefined, identities: noIdentities })
  return {
    agent,
    records,
    store,
    w3c,
    wallet,
    deliver,
    sync,
    ready: Promise.all(memberships.map((m) => store.saveMembership(m))),
  }
}
const noIdentities = { listPersonas: async () => [] } as never

beforeEach(() => resetCardStanding())
// The store announces each write on a timer (communityChanged): let them fire before the next test, and before teardown.
afterEach(() => new Promise((resolve) => setTimeout(resolve, 0)))

describe('a badge credential is told apart', () => {
  it('as a badge, issued by the community, about the member', () => {
    const vc = badgeCredential()
    expect(isBadgeCredential(vc)).toBe(true)
    expect(classifyCredential(vc)).toMatchObject({
      kind: 'badge',
      communityDid: BADGE_COMMUNITY,
      subjectDid: BADGE_PERSONA,
    })
  })

  it.each([
    ['a membership card', membershipCard],
    ['an Open Badge with no Achievement', { ...badgeCredential(), credentialSubject: { id: BADGE_PERSONA } }],
    [
      'a credential that only names an Achievement',
      { ...badgeCredential(), type: ['VerifiableCredential', 'UniversityDegree'] },
    ],
  ])('and %s is not a badge', (_name, vc) => {
    expect(isBadgeCredential(vc as Record<string, unknown>)).toBe(false)
    expect(classifyCredential(vc as Record<string, unknown>).kind).not.toBe('badge')
  })
})

describe('what the Wallet card shows (badgeCardView)', () => {
  it('reads the badge, its community and the award from upstream’s shape', () => {
    expect(badgeCardView(badgeCredential())).toEqual({
      badgeKey: `${BADGE_COMMUNITY}|urn:vtc:badge:b-helper`,
      badgeId: 'b-helper',
      achievementId: 'urn:vtc:badge:b-helper',
      name: 'Helper',
      description: 'Answers questions in the help room.',
      criteria: 'Ten answers someone found useful.',
      communityDid: BADGE_COMMUNITY,
      communityName: 'Keyring Test VTC',
      // Lower-case hex, as images/get takes it, though the credential spelt it upper-case.
      imageSha256: BADGE_IMAGE_SHA,
      imageMediaType: 'image/png',
      issuedAt: '2026-11-10T09:00:00Z',
      validUntil: '2026-12-10T09:00:00Z',
      evidence: [{ note: 'Thanks for the help with the rooms.', acceptedAt: '2026-11-10T08:59:00Z' }],
    })
  })

  it('names no picture to load for a badge shown outside: no digest, and never its URL', () => {
    const view = badgeCardView(badgeCredential({ publicUrl: 'https://vtc.example' }))
    expect(view.badgeId).toBe('b-helper')
    expect(view.imageSha256).toBeUndefined()
    expect(view.imageMediaType).toBe('image/png')
    expect(JSON.stringify(view)).not.toContain('/image')
  })

  it('is the same badge across a renewal, though the credential id is new', () => {
    const first = badgeCredential({ id: 'urn:uuid:first' })
    const renewed = badgeCredential({ id: 'urn:uuid:renewed', validFrom: '2026-12-09T09:00:00Z' })
    expect(badgeKeyOf(renewed)).toBe(badgeKeyOf(first))
    expect(badgeKeyOf(badgeCredential({ badgeId: 'b-other' }))).not.toBe(badgeKeyOf(first))
    expect(badgeKeyOf(badgeCredential({ community: OTHER_COMMUNITY }))).not.toBe(badgeKeyOf(first))
  })

  it('reads a badge id only from the two shapes upstream builds', () => {
    expect(badgeIdOf('urn:vtc:badge:b1')).toBe('b1')
    expect(badgeIdOf('https://vtc.example/badges/b1')).toBe('b1')
    expect(badgeIdOf('https://vtc.example/badges/b1/extra')).toBeUndefined()
    expect(badgeIdOf('urn:other:b1')).toBeUndefined()
  })

  it.each(['Accepted sometime last week', 'Accepted yesterday', 'Accepted 2026-13-45T99:00:00Z'])(
    'leaves out an acceptance date it cannot read (%s), rather than showing the text',
    (description) => {
      const vc = badgeCredential()
      ;(vc.evidence as Record<string, unknown>[])[0].description = description
      expect(badgeCardView(vc).evidence).toEqual([{ note: 'Thanks for the help with the rooms.' }])
    }
  )

  it('keeps the later issue of two copies, whichever arrives last', () => {
    const older = badgeCredential({ validFrom: '2026-11-10T09:00:00Z' })
    const newer = badgeCredential({ validFrom: '2026-12-09T09:00:00Z' })
    expect(laterBadge(older, newer)).toBe('arriving')
    expect(laterBadge(newer, older)).toBe('kept')
  })
})

describe('the inbox keeps a badge for a current member only', () => {
  it('keeps a badge from a community the persona is a member of', async () => {
    const p = phone()
    await p.ready
    const { kept, refused } = await p.deliver(badgeCredential())
    expect(refused).toEqual([])
    expect(kept.map((k) => k.kind)).toEqual(['badge'])
    expect((await p.store.listHeldCredentials('badge')).map((h) => h.credential.id)).toEqual([
      'urn:uuid:7d0c5b1e-4f3a-4c2b-9e8d-1a2b3c4d5e6f',
    ])
  })

  it('refuses one from a community the phone is not in', async () => {
    const p = phone([])
    await p.ready
    const { kept, refused } = await p.deliver(badgeCredential())
    expect(kept).toEqual([])
    expect(refused).toEqual(['notMember'])
    expect(await p.store.listHeldCredentials('badge')).toEqual([])
  })

  it('refuses one from a community that removed the persona', async () => {
    const p = phone([{ ...member, removal: { code: 'adminRemoved' } } as VtiMembership])
    await p.ready
    expect((await p.deliver(badgeCredential())).refused).toEqual(['notMember'])
  })

  it('refuses one issued in the name of a community it did not come from', async () => {
    const p = phone()
    await p.ready
    expect((await p.deliver(badgeCredential(), OTHER_COMMUNITY)).refused).toEqual(['issuerNotSender'])
    expect((await p.deliver(badgeCredential({ subject: 'did:webvh:someone-else' }))).refused).toEqual(['subject'])
  })

  it('keeps one copy across a re-issue: the renewal replaces it, and the older copy sent again does not win', async () => {
    const p = phone()
    await p.ready
    const first = badgeCredential({ id: 'urn:uuid:first', validFrom: '2026-11-10T09:00:00Z' })
    const renewed = badgeCredential({ id: 'urn:uuid:renewed', validFrom: '2026-12-09T09:00:00Z' })
    await p.deliver(first)
    await p.deliver(renewed)
    const again = await p.deliver(first)
    expect(again.kept).toEqual([])
    expect((await p.store.listHeldCredentials('badge')).map((h) => h.credential.id)).toEqual(['urn:uuid:renewed'])
    // One record, not two left for a later read to tell apart.
    expect(p.records.filter((r) => r.tags.kind === 'credential')).toHaveLength(1)
  })

  it('keeps two badges of one community as two', async () => {
    const p = phone()
    await p.ready
    await p.deliver(badgeCredential({ id: 'urn:uuid:a' }))
    await p.deliver(badgeCredential({ id: 'urn:uuid:b', badgeId: 'b-other' }))
    expect((await p.store.listHeldCredentials('badge')).map((h) => h.credential.id).sort()).toEqual([
      'urn:uuid:a',
      'urn:uuid:b',
    ])
  })
})

describe('the Wallet shows a badge as a card of its own', () => {
  const openBadgeFromElsewhere = {
    ...badgeCredential({ id: 'urn:uuid:university', community: 'did:web:university.example' }),
    credentialSubject: {
      ...(badgeCredential().credentialSubject as Record<string, unknown>),
      id: 'did:key:z6MkSomeoneElsewhere',
    },
  }

  it('adds a copy of a kept badge', async () => {
    const p = phone()
    await p.ready
    await p.deliver(badgeCredential())
    const done = await p.sync()
    expect(done.failed).toEqual([])
    expect(
      p
        .wallet()
        .filter(isBadgeCredential)
        .map((vc) => vc.id)
    ).toEqual(['urn:uuid:7d0c5b1e-4f3a-4c2b-9e8d-1a2b3c4d5e6f'])
  })

  it('replaces the copy when the badge is renewed, and never shows two', async () => {
    const p = phone()
    await p.ready
    await p.deliver(badgeCredential({ id: 'urn:uuid:first' }))
    await p.sync()
    await p.deliver(
      badgeCredential({ id: 'urn:uuid:renewed', validFrom: '2026-12-09T09:00:00Z', validUntil: '2027-01-08T09:00:00Z' })
    )
    const done = await p.sync()
    expect(done.replaced).toHaveLength(1)
    expect(
      p
        .wallet()
        .filter(isBadgeCredential)
        .map((vc) => vc.id)
    ).toEqual(['urn:uuid:renewed'])
  })

  it('takes the copy out when the membership is removed', async () => {
    const p = phone()
    await p.ready
    await p.deliver(badgeCredential())
    await p.sync()
    expect(p.wallet().filter(isBadgeCredential)).toHaveLength(1)
    await p.store.saveMembership({ ...member, removal: { code: 'adminRemoved' } } as VtiMembership)
    await p.sync()
    expect(p.wallet().filter(isBadgeCredential)).toEqual([])
  })

  it('does not show a badge past its end date', async () => {
    const p = phone()
    await p.ready
    await p.deliver(badgeCredential({ validFrom: '2026-10-01T09:00:00Z', validUntil: '2026-10-31T09:00:00Z' }))
    expect(await p.store.listHeldCredentials('badge')).toHaveLength(1)
    await p.sync()
    expect(p.wallet().filter(isBadgeCredential)).toEqual([])
  })

  it('never touches an Open Badge that came some other way', async () => {
    const p = phone()
    await p.ready
    p.w3c.push(new W3cCredentialRecord({ credentialInstances: [{ credential: openBadgeFromElsewhere as never }] }))
    await p.deliver(badgeCredential())
    const done = await p.sync()
    expect(done.removed).toEqual([])
    expect(
      p
        .wallet()
        .map((vc) => vc.id)
        .sort()
    ).toEqual(['urn:uuid:7d0c5b1e-4f3a-4c2b-9e8d-1a2b3c4d5e6f', 'urn:uuid:university', membershipCard.id].sort())
  })

  it('never touches a badge a known community gave someone else', async () => {
    const p = phone()
    await p.ready
    const someoneElses = badgeCredential({
      id: 'urn:uuid:someone-elses',
      subject: 'did:webvh:QmSomeone:dids.example:x',
    })
    p.w3c.push(new W3cCredentialRecord({ credentialInstances: [{ credential: someoneElses as never }] }))
    await p.deliver(badgeCredential())
    const done = await p.sync()
    expect(done.removed).toEqual([])
    expect(
      p
        .wallet()
        .filter(isBadgeCredential)
        .map((vc) => vc.id)
        .sort()
    ).toEqual(['urn:uuid:7d0c5b1e-4f3a-4c2b-9e8d-1a2b3c4d5e6f', 'urn:uuid:someone-elses'].sort())
  })

  // Without an Achievement id a badge is kept and matched by its own id, as any card. Only one with nothing to
  // key it by (no Achievement id, no id, no proof) cannot be mirrored, and it is left alone rather than removed.
  it('leaves alone a badge of its own with nothing to key it by, rather than removing it', async () => {
    const p = phone()
    await p.ready
    const unkeyable = badgeCredential()
    delete ((unkeyable.credentialSubject as Record<string, unknown>).achievement as Record<string, unknown>).id
    delete unkeyable.id
    delete unkeyable.proof
    p.w3c.push(new W3cCredentialRecord({ credentialInstances: [{ credential: unkeyable as never }] }))
    const done = await p.sync()
    expect(done.removed).toEqual([])
    expect(p.wallet()).toHaveLength(2)
  })

  it('takes out a copy the store no longer holds once the community is left', async () => {
    const p = phone()
    await p.ready
    await p.deliver(badgeCredential())
    await p.sync()
    await p.store.forgetCommunity(BADGE_COMMUNITY, BADGE_PERSONA)
    await p.store.saveDeparture({
      communityDid: BADGE_COMMUNITY,
      personaDid: BADGE_PERSONA,
      disposition: 'purge',
      at: '2026-11-17T08:00:00Z',
    })
    await p.sync()
    expect(p.wallet().filter(isBadgeCredential)).toEqual([])
  })
})
