/**
 * Renewing a member's community cards (IN-501): a community issues them for 30
 * days and renews them only when the member asks (`vtc/members/renew/0.1`).
 * Asked at day 20 of 30, or at once for a card already lapsed; what comes back
 * is checked and kept in place of the old card, and nothing else ever drops or
 * replaces it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { DeviceEventEmitter } from 'react-native'

import { VTI_PERSONA_DELIVERIES_EVENT } from '../module/communityChanged'
import { VtiRefusal, VtiSentNoAnswer } from '../module/vtiAgent'
import {
  MEMBERS_RENEW,
  renewalDue,
  renewDueCards,
  renewMembershipCards,
  RENEW_RETRY_MS,
  RENEW_TRIED_KEY,
  resetCardRenewal,
  type RenewDeps,
} from '../module/vtiCardRenewal'
import { VTI_REMOVED_EVENT } from '../module/vtiCommunityNotices'
import { VtiCardStatusUnreadable } from '../module/vtiDeliveredCheck'
import type { VtiMembership } from '../module/VtiCommunityStore'
import { GenericRecordsVettingStore } from '../module/vtiVetting'

import {
  COMMUNITY,
  fakeAgent,
  fakeCommunityStore,
  membership,
  membershipCard,
  persona,
  PERSONA_DID,
  roleCard,
  roleVac,
} from '../../../../__tests__/helpers/cardVault'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

// The fixture's card: valid 2026-09-26T09:00Z to 2026-10-26T09:00Z (30 days).
const DAY_19 = Date.parse('2026-10-15T09:00:00Z')
const DAY_20 = Date.parse('2026-10-16T09:00:00Z')
const LAPSED = Date.parse('2026-11-05T21:00:00Z')

const renewedCard = {
  ...membershipCard,
  id: 'urn:uuid:aaaaaaaa-1111-4111-8111-111111111111',
  validFrom: '2026-11-05T21:00:00Z',
  validUntil: '2026-12-05T21:00:00Z',
}
const renewedRole = {
  ...roleVac,
  id: 'urn:uuid:aaaaaaaa-4444-4444-8444-444444444444',
  credentialSubject: {
    id: PERSONA_DID,
    authority: { scope: COMMUNITY, actions: ['role:member'], maxAttenuation: 0 },
  },
  validFrom: '2026-11-05T21:00:00Z',
  validUntil: '2026-12-05T21:00:00Z',
}
const answer = { did: PERSONA_DID, vmc: renewedCard, roleVac: renewedRole, personhood: false, personhoodChanged: false }

/** The membership as it stood before, deep-copied: what "nothing changed" is compared with. */
const lapsedMembership: VtiMembership = { ...membership, validUntil: membershipCard.validUntil }

function setup(overrides: Partial<RenewDeps> = {}, held: VtiMembership = lapsedMembership) {
  const community = fakeCommunityStore({ memberships: [structuredClone(held)] })
  const acknowledge = jest.fn(async () => 'acknowledged')
  const ask = jest.fn(async () => structuredClone(answer) as Record<string, unknown>)
  const checkCard = jest.fn(async () => undefined)
  const deps: RenewDeps = {
    store: community.store,
    persona,
    communityDid: COMMUNITY,
    ask,
    checkCard,
    acknowledge,
    now: () => LAPSED,
    ...overrides,
  }
  const kept = () => community.memberships.get(COMMUNITY)
  return { deps, ask, checkCard, acknowledge, kept }
}

const notMember = () =>
  new VtiRefusal('https://trusttasks.org/spec/vtc/members/renew:notMember', 'no ACL row — not a member')

const events = (name: string) => {
  const seen: unknown[] = []
  const sub = DeviceEventEmitter.addListener(name, (e) => seen.push(e))
  return { seen, stop: () => sub.remove() }
}

beforeEach(() => resetCardRenewal())

describe('when a card is due', () => {
  it.each([
    ['day 19 of 30', DAY_19, false],
    ['day 20 of 30', DAY_20, true],
    ['lapsed', LAPSED, true],
  ])('%s: due %s', (_, at, due) => {
    expect(renewalDue(lapsedMembership, at)).toBe(due)
  })

  it('never for a membership the community ended, nor a card that states no end', () => {
    const removal = { code: 'adminRemoved', decidedBy: COMMUNITY, decidedAt: '', disposition: 'purge', noticeId: 'n' }
    expect(renewalDue({ ...lapsedMembership, removal } as VtiMembership, LAPSED)).toBe(false)
    const { validUntil: _u, ...noEnd } = membershipCard
    expect(renewalDue({ ...lapsedMembership, vmc: noEnd }, LAPSED)).toBe(false)
  })
})

describe('a lapsed card renewed', () => {
  it('keeps the new cards in place of the old, with Member since unchanged, then acknowledges and tells the vault', async () => {
    const log = jest.fn()
    const { deps, ask, checkCard, acknowledge, kept } = setup({ log })
    const delivered = events(VTI_PERSONA_DELIVERIES_EVENT)
    await expect(renewMembershipCards(deps)).resolves.toBe('renewed')
    delivered.stop()
    // What a live check reads before and after: the cards' dates and the acknowledgement's outcome, no identities.
    expect(log.mock.calls.map(([line]) => line)).toEqual([
      `[VTI] card renewal: new cards kept (membership ${membershipCard.validFrom}..${membershipCard.validUntil} -> ${renewedCard.validFrom}..${renewedCard.validUntil}; role card renewed)`,
      '[VTI] card renewal: acknowledgement acknowledged',
    ])
    expect(ask).toHaveBeenCalledTimes(1)
    expect(checkCard).toHaveBeenCalledWith(renewedCard, COMMUNITY)
    expect(checkCard).toHaveBeenCalledWith(renewedRole, COMMUNITY)
    expect(kept()).toMatchObject({
      vmc: renewedCard,
      roleVec: renewedRole,
      role: 'member',
      validUntil: renewedCard.validUntil,
      grantedAt: membership.grantedAt,
    })
    expect(kept()?.removal).toBeUndefined()
    expect(acknowledge).toHaveBeenCalledTimes(1)
    expect(delivered.seen).toEqual([{ communityDid: COMMUNITY, kinds: ['membership', 'role'] }])
  })

  it('a card not yet due is not asked for', async () => {
    const { deps, ask, kept } = setup({ now: () => DAY_19 })
    await expect(renewMembershipCards(deps)).resolves.toBe('notDue')
    expect(ask).not.toHaveBeenCalled()
    expect(kept()).toEqual(lapsedMembership)
  })

  it('a role card that does not hold up leaves the old one; the membership card is still renewed', async () => {
    const checkCard = jest.fn(async (card: Record<string, unknown>) =>
      card.id === renewedRole.id ? 'proof' : undefined
    )
    const log = jest.fn()
    const { deps, kept } = setup({ checkCard: checkCard as never, log })
    await expect(renewMembershipCards(deps)).resolves.toBe('renewed')
    expect(kept()).toMatchObject({ vmc: renewedCard, roleVec: roleCard })
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/new cards kept \(membership .*; role card old one stays\)$/)
    )
  })
})

describe('what the community answers instead', () => {
  // A notMember answer is a refusal like any other here: the phone records no end and forgets nothing. A
  // membership ends on this phone through the community's removal notice (vtiPersonaInbox), which also forgets the
  // vetting application; a renewal answer never does either.
  it('renew:notMember: the card is kept, unchanged, nothing is recorded as ended, and it is asked again later', async () => {
    const forget = jest.spyOn(GenericRecordsVettingStore.prototype, 'forgetApplication').mockResolvedValue(undefined)
    const { deps, acknowledge, kept } = setup({ ask: jest.fn(async () => Promise.reject(notMember())) })
    const removed = events(VTI_REMOVED_EVENT)
    await expect(renewMembershipCards(deps)).resolves.toBe('refused')
    removed.stop()
    expect(kept()).toEqual(lapsedMembership)
    expect(kept()?.removal).toBeUndefined()
    expect(forget).not.toHaveBeenCalled()
    expect(acknowledge).not.toHaveBeenCalled()
    expect(removed.seen).toEqual([])
    forget.mockRestore()
  })

  it.each([
    [
      'a personhood policy that no longer admits the member',
      new VtiRefusal('trust-task-error#malformed', 'personhood-renewal-refused: …'),
    ],
    [
      'notMember from another task',
      new VtiRefusal('https://trusttasks.org/spec/vtc/members/self-remove:notMember', 'x'),
    ],
    ['an expired ACL row', new VtiRefusal('https://trusttasks.org/spec/trust-task-error/0.1#unauthorized', 'expired')],
  ])('%s: the card is kept, unchanged, and asked again later', async (_, refusal) => {
    const { deps, kept } = setup({ ask: jest.fn(async () => Promise.reject(refusal)) })
    await expect(renewMembershipCards(deps)).resolves.toBe('refused')
    expect(kept()).toEqual(lapsedMembership)
  })

  it.each([
    ['no answer', new VtiSentNoAnswer(MEMBERS_RENEW, 'thread-1', 0, COMMUNITY)],
    ['the session held by another step', Object.assign(new Error('held'), { name: 'VtiSessionHeld' })],
    ['a dropped link', new Error('socket closed')],
  ])('%s never drops or replaces the stored card', async (_, failure) => {
    const { deps, acknowledge, kept } = setup({ ask: jest.fn(async () => Promise.reject(failure)) })
    const removed = events(VTI_REMOVED_EVENT)
    await expect(renewMembershipCards(deps)).resolves.toBe('noAnswer')
    removed.stop()
    expect(kept()).toEqual(lapsedMembership)
    expect(acknowledge).not.toHaveBeenCalled()
    expect(removed.seen).toEqual([])
  })

  it.each([
    ['fails its check', { checkCard: jest.fn(async () => 'proof') }],
    [
      'is about someone else',
      { ask: jest.fn(async () => ({ ...answer, vmc: { ...renewedCard, credentialSubject: { id: 'did:other' } } })) },
    ],
    [
      'is another community’s',
      { ask: jest.fn(async () => ({ ...answer, vmc: { ...renewedCard, issuer: 'did:webvh:QmOther:x' } })) },
    ],
    ['is missing', { ask: jest.fn(async () => ({ ...answer, vmc: undefined })) }],
    ['is not a membership card', { ask: jest.fn(async () => ({ ...answer, vmc: renewedRole })) }],
    [
      'has a status list that cannot be read now',
      { checkCard: jest.fn(async () => Promise.reject(new VtiCardStatusUnreadable('timeout'))) },
    ],
  ])('a new card that %s is not kept: the old one stays', async (_, overrides) => {
    const { deps, acknowledge, kept } = setup(overrides as Partial<RenewDeps>)
    await expect(renewMembershipCards(deps)).resolves.toBe('cardRefused')
    expect(kept()).toEqual(lapsedMembership)
    expect(acknowledge).not.toHaveBeenCalled()
  })

  it('a removal notice that lands while the renewal is asked stands over the renewed card', async () => {
    const removal = {
      code: 'adminRemoved' as const,
      decidedBy: COMMUNITY,
      decidedAt: '2026-11-05T20:59:00Z',
      disposition: 'purge' as const,
      noticeId: 'n1',
    }
    const { deps, kept } = setup()
    deps.ask = async () => {
      await deps.store.saveMembership({ ...(kept() as VtiMembership), removal })
      return structuredClone(answer)
    }
    await expect(renewMembershipCards(deps)).resolves.toBe('notDue')
    expect(kept()).toEqual({ ...lapsedMembership, removal })
  })
})

describe('every card due on this phone', () => {
  const run = (
    store: ReturnType<typeof fakeCommunityStore>['store'],
    now: number,
    renew: jest.Mock,
    personas = [persona]
  ) =>
    renewDueCards(fakeAgent().agent, {
      store,
      identities: { listPersonas: async () => personas } as never,
      now: () => now,
      renew,
      send: async () => ({}),
    })

  it('asks for a lapsed card, and after an attempt that changed nothing, not again for a while', async () => {
    const { store } = fakeCommunityStore({ memberships: [lapsedMembership] })
    const renew = jest.fn(async () => 'noAnswer')
    expect(await run(store, LAPSED, renew)).toEqual({ [`${COMMUNITY}|${PERSONA_DID}`]: 'noAnswer' })
    await run(store, LAPSED + RENEW_RETRY_MS - 1, renew)
    expect(renew).toHaveBeenCalledTimes(1)
    await run(store, LAPSED + RENEW_RETRY_MS, renew)
    expect(renew).toHaveBeenCalledTimes(2)
  })

  it('leaves a card not due, and an identity the phone cannot sign as yet', async () => {
    const { store } = fakeCommunityStore({ memberships: [lapsedMembership] })
    const renew = jest.fn(async () => 'renewed')
    await run(store, DAY_19, renew)
    await run(store, LAPSED, renew, [{ ...persona, kmsKeyIds: { keyAgreement: 'kms-ka' } }])
    await run(store, LAPSED, renew, [])
    expect(renew).not.toHaveBeenCalled()
    await run(store, LAPSED, renew)
    expect(renew).toHaveBeenCalledTimes(1)
  })

  it('a notMember answer, through the real renewal: nothing recorded or forgotten, and not asked again for a while', async () => {
    const forget = jest.spyOn(GenericRecordsVettingStore.prototype, 'forgetApplication').mockResolvedValue(undefined)
    const community = fakeCommunityStore({ memberships: [structuredClone(lapsedMembership)] })
    const send = jest.fn(async () => Promise.reject(notMember()))
    const removed = events(VTI_REMOVED_EVENT)
    const sweep = (at: number) =>
      renewDueCards(fakeAgent().agent, {
        store: community.store,
        identities: { listPersonas: async () => [persona] } as never,
        now: () => at,
        send,
      })
    expect(await sweep(LAPSED)).toEqual({ [`${COMMUNITY}|${PERSONA_DID}`]: 'refused' })
    await sweep(LAPSED + RENEW_RETRY_MS - 1)
    removed.stop()
    expect(send).toHaveBeenCalledTimes(1)
    expect(community.memberships.get(COMMUNITY)).toEqual(lapsedMembership)
    expect(forget).not.toHaveBeenCalled()
    expect(removed.seen).toEqual([])
    await sweep(LAPSED + RENEW_RETRY_MS)
    expect(send).toHaveBeenCalledTimes(2)
    forget.mockRestore()
  })
})

// ac's review of #973: a card past day 20 stays due, and a refusal records nothing on the membership, so a pause
// kept only in memory let every launch ask again. The pause is kept on the phone.
describe('the pause between attempts, across restarts', () => {
  const KEY = `${COMMUNITY}|${PERSONA_DID}`
  const stored = async () => JSON.parse((await AsyncStorage.getItem(RENEW_TRIED_KEY)) ?? '{}')
  const sweep = (at: number, renew: jest.Mock, memberships: VtiMembership[] = [lapsedMembership]) =>
    renewDueCards(fakeAgent().agent, {
      store: fakeCommunityStore({ memberships: memberships.map((m) => structuredClone(m)) }).store,
      identities: { listPersonas: async () => [persona] } as never,
      now: () => at,
      renew,
      send: async () => ({}),
    })

  it('an attempt that changed nothing is kept on the phone', async () => {
    await sweep(
      LAPSED,
      jest.fn(async () => 'refused')
    )
    expect(await stored()).toEqual({ [KEY]: LAPSED })
  })

  it('an attempt from an earlier run holds the pause after a restart, then the card is asked again', async () => {
    // Only what the phone kept: nothing from this run's memory.
    await AsyncStorage.setItem(RENEW_TRIED_KEY, JSON.stringify({ [KEY]: LAPSED }))
    const renew = jest.fn(async () => 'refused')
    await sweep(LAPSED + 60 * 60 * 1000, renew)
    expect(renew).not.toHaveBeenCalled()
    await sweep(LAPSED + RENEW_RETRY_MS, renew)
    expect(renew).toHaveBeenCalledTimes(1)
    expect(await stored()).toEqual({ [KEY]: LAPSED + RENEW_RETRY_MS })
  })

  it('a renewal clears its entry, and a membership gone from the phone takes its entry with it', async () => {
    await AsyncStorage.setItem(RENEW_TRIED_KEY, JSON.stringify({ [KEY]: LAPSED - RENEW_RETRY_MS, 'gone|x': LAPSED }))
    await sweep(
      LAPSED,
      jest.fn(async () => 'renewed')
    )
    expect(await stored()).toEqual({})
  })

  it('a time ahead of the clock, or what cannot be read, does not hold the pause', async () => {
    const renew = jest.fn(async () => 'noAnswer')
    await AsyncStorage.setItem(RENEW_TRIED_KEY, JSON.stringify({ [KEY]: LAPSED + 24 * 60 * 60 * 1000 }))
    await sweep(LAPSED, renew)
    await AsyncStorage.setItem(RENEW_TRIED_KEY, 'not json')
    await sweep(LAPSED + RENEW_RETRY_MS * 2, renew)
    await AsyncStorage.setItem(RENEW_TRIED_KEY, JSON.stringify({ [KEY]: 'yesterday' }))
    await sweep(LAPSED + RENEW_RETRY_MS * 4, renew)
    expect(renew).toHaveBeenCalledTimes(3)
  })
})
