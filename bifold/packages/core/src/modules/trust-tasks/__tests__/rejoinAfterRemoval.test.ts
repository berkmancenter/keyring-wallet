/**
 * IN-104: after a community removed a member, "Join again" offered a single
 * "Join … admitted straight away", because the vetting statements the removed
 * identity had gathered still read as held; the request then went out under a
 * new identity carrying none of them, and the screen kept saying "removed
 * you". What was gathered belongs to the identity that gathered it.
 */
import type { JoinSubmission, VtiCommunityStore, VtiMembership } from '../module/VtiCommunityStore'
import { joinAsks, readManifest, type VtiManifest } from '../module/joinManifest'
import { readJoinState } from '../module/vtiJoin'
import { VtiApplicant, type VettingApplication, type VtiVettingStore } from '../module/vtiVetting'
import { joinCard } from '../screens/joinWays'
import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'

import vettingCommunity from './fixtures/join-0.3/vetting-community-manifest.json'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const COMMUNITY = 'did:webvh:Qm:vtc.example:c'
const OLD = 'did:webvh:Qm:vta.example:old-identity'
const NEW = 'did:webvh:Qm:vta.example:new-identity'
const removal = {
  code: 'adminRemoved' as const,
  decidedBy: 'did:webvh:Qm:admin',
  decidedAt: '2026-10-03T01:20:00Z',
  disposition: 'tombstone' as const,
  noticeId: 'urn:uuid:n1',
}
const membership: VtiMembership = {
  communityDid: COMMUNITY,
  personaDid: OLD,
  role: 'member',
  vmc: { id: 'urn:vmc' },
  grantedAt: '2026-10-01T00:00:00Z',
  via: 'vetting',
}
const submission = (sentAt: string): JoinSubmission => ({
  communityDid: COMMUNITY,
  personaDid: NEW,
  sentAt,
  withInvitation: false,
  via: 'join',
  acknowledgedAt: sentAt,
  status: 'pending',
})
const storeWith = (m: VtiMembership, s?: JoinSubmission) =>
  ({ getMembership: async () => m, getSubmission: async () => s }) as unknown as VtiCommunityStore

describe('the ways, read for the identity that will ask', () => {
  const manifest = readManifest(vettingCommunity.payload as Partial<VtiManifest>, '0.3')

  it('an identity holding nothing yet is offered vetting, with asking beside it — not "Join"', () => {
    const card = joinCard(joinAsks(manifest, {}), {})
    if (card.mode !== 'ways') throw new Error('ways')
    expect(card.button).toBe('start')
    expect(card.alsoAsk).toBe(true)
  })

  it('an earlier identity’s statement, counted as held, would read the vetting way as met (what IN-104 saw)', () => {
    const card = joinCard(joinAsks(manifest, { statements: 1 }), { statements: 1 })
    if (card.mode !== 'ways') throw new Error('ways')
    expect(card.button).toBe('join')
  })
})

describe('a vetting application belongs to the identity it was gathered for', () => {
  const store = (application?: VettingApplication) => {
    const state = { application }
    const s = {
      getApplication: async () => state.application,
      saveApplication: async (a: VettingApplication) => void (state.application = JSON.parse(JSON.stringify(a))),
    } as unknown as VtiVettingStore
    return { s, state }
  }
  const earlier: VettingApplication = {
    communityDid: COMMUNITY,
    joinDid: OLD,
    minStatements: 1,
    requiredClaims: ['name.legal'],
    acceptedMethods: ['inPerson'],
    commitmentSalt: 'old-salt',
    claims: { 'name.legal': 'Ada' },
    requests: [{ vetterDid: 'did:x:vetter', requestDocumentId: 'urn:r', status: 'attested' }],
    startedAt: '2026-09-30T00:00:00Z',
  }
  // The hosted community's own vetting criterion, as published.
  const manifest = readManifest(vettingCommunity.payload as Partial<VtiManifest>, '0.3')
  const applicant = (did: string, s: VtiVettingStore) =>
    new VtiApplicant({} as never, { did, communityDid: COMMUNITY } as never, s, {} as never)

  it('joining as a new identity starts a new application: no statements, a new salt, the new identity', async () => {
    const { s, state } = store(earlier)
    await applicant(NEW, s).start(manifest as never, { 'name.legal': 'Ada' })
    expect(state.application).toMatchObject({ joinDid: NEW, requests: [] })
    expect(state.application?.commitmentSalt).not.toBe('old-salt')
  })

  it('the same identity carries on with its own application, statements and all', async () => {
    const { s, state } = store(earlier)
    await applicant(OLD, s).start(manifest as never, { 'name.legal': 'Ada' })
    expect(state.application).toMatchObject({ joinDid: OLD, commitmentSalt: 'old-salt' })
    expect(state.application?.requests).toHaveLength(1)
  })
})

describe('where a removed member stands once they ask again', () => {
  const agent = {} as never
  const ok = async () => ({ revoked: false })

  it('removed, while nothing was sent since the removal', async () => {
    await expect(
      readJoinState(agent, COMMUNITY, {
        communityStore: storeWith({ ...membership, removal }, submission('2026-10-01T00:00:00Z')),
        cardStatus: ok,
        poll: false,
      })
    ).resolves.toMatchObject({ kind: 'removed' })
  })

  it('the request sent after the removal, not "removed you"', async () => {
    await expect(
      readJoinState(agent, COMMUNITY, {
        communityStore: storeWith({ ...membership, removal }, submission('2026-10-03T01:27:15Z')),
        cardStatus: ok,
        poll: false,
      })
    ).resolves.toMatchObject({ kind: 'pending' })
  })

  it('a revoked card, then a request sent since the membership began: the request', async () => {
    await expect(
      readJoinState(agent, COMMUNITY, {
        communityStore: storeWith(membership, submission('2026-10-03T01:27:15Z')),
        cardStatus: async () => ({ revoked: true, at: '2026-10-03T01:00:00Z' }),
        poll: false,
      })
    ).resolves.toMatchObject({ kind: 'pending' })
  })

  it('a current member stays a member, whatever request is on record', async () => {
    await expect(
      readJoinState(agent, COMMUNITY, {
        communityStore: storeWith(membership, submission('2026-10-03T01:27:15Z')),
        cardStatus: ok,
        poll: false,
      })
    ).resolves.toMatchObject({ kind: 'member' })
  })
})

describe('what the screen promises about joining again', () => {
  it('says the person can ask again, and promises no new identity, in every language', () => {
    for (const words of [en, fr, ptBr]) {
      const again = (words.Join as Record<string, unknown>).StandingAgain as string
      expect(again).toEqual(expect.any(String))
      expect(again).not.toMatch(/identit/i)
    }
  })
})
