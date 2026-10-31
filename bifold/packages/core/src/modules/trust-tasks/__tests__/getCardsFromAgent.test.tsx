/**
 * Manage → "Get your cards from your agent" (226): every identity on this
 * phone asks its agent for the cards it keeps; the person sees a running
 * count, then what came back and, in words, what did not. Since 242 it first
 * takes on the agent's identities this phone lacks, so a new phone is offered
 * it too and gets its communities and their cards back. Each agent's vault is
 * read once a run, whatever the number of identities (#401 Farm run).
 */
import type { Agent } from '@credo-ts/core'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import {
  COMMUNITY,
  fakeAgent,
  fakeCommunityStore,
  fakeVault,
  membershipCard,
  persona,
  PERSONA_DID,
  ROOM,
  roomAuthorityCard,
  roomMembershipCard,
} from '../../../../__tests__/helpers/cardVault'
import { testIdWithKey } from '../../../utils/testable'
import { forgetRoomCommunities } from '../module/roomCards'
import { fetchAgentCards, forgetCardReads, recoverCardsFromAgent, type AgentCard } from '../module/vtiCardVault'
import type { VtiMembership } from '../module/VtiCommunityStore'
import type { VtiPersona } from '../module/VtiIdentityStore'
import {
  bringBackFromAgent,
  GetCardsFromAgent,
  getCardsFromAgent,
  type AdoptionFound,
  type GetCardsDeps,
} from '../screens/GetCardsFromAgent'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('react-i18next', () => {
  const t = (key: string, values?: Record<string, unknown>) =>
    values
      ? `${key}(${Object.entries(values)
          .map(([k, v]) => `${k}=${v}`)
          .join(',')})`
      : key
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', t, changeLanguage: () => new Promise(() => {}) } }),
    initReactI18next: { type: '3rdParty', init: jest.fn() },
    Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  }
})

const agent = {} as Agent

// Each test reads its agent as a fresh session would.
beforeEach(() => forgetCardReads())
const VTA = persona.vtaDid
const OTHER_VTA = 'did:webvh:QmVta2:dids.example:other-vta'
const second: VtiPersona = {
  ...persona,
  communityDid: 'did:webvh:QmOther:vtc.example:first-vtc',
  did: 'did:webvh:QmP2:x',
}
const elsewhere: VtiPersona = { ...second, vtaDid: OTHER_VTA, did: 'did:webvh:QmP3:y' }

// A card the agent keeps about `did`: `n` tells several apart.
const cardAbout = (did: string, n = 0): AgentCard => {
  const id = `urn:uuid:${did.slice(-4)}-${n}`
  return { id, credential: { ...membershipCard, id, credentialSubject: { id: did } } }
}

// What a run of adoption found: `adopted`, with the counts the screen explains an empty run from.
const found = (adopted: VtiPersona[], counts: Partial<AdoptionFound> = {}): AdoptionFound => ({
  adopted,
  otherIdentities: adopted.length,
  cardsForOthers: adopted.length,
  unreadable: [],
  failedCheck: [],
  ...counts,
})

type Answer = {
  restored: string[]
  already?: string[]
  refused: { reason: 'failedCheck' | 'notOurs' | 'unreadable' }[]
}

// Each agent's vault (its cards, or 'down'), and what restoring each identity's cards gives.
const deps = (
  vaults: Record<string, AgentCard[] | 'down'>,
  answers: Record<string, Answer> = {},
  adopt: GetCardsDeps['adopt'] = async () => found([])
): GetCardsDeps => ({
  adopt,
  store: () => ({}) as never,
  taskFor: async (_a, vtaDid) => {
    if (!vaults[vtaDid] || vaults[vtaDid] === 'down') throw new Error('no answer')
    return Object.assign(async () => ({}), { vtaDid }) as never
  },
  fetchCards: async (task) => vaults[(task as unknown as { vtaDid: string }).vtaDid] as AgentCard[],
  recover: (async (
    _a: Agent,
    _s: unknown,
    p: VtiPersona,
    _t: unknown,
    o: { cards: AgentCard[]; onProgress?: (x: { found: number; restored: number }) => void }
  ) => {
    const got = answers[p.did] ?? { restored: [], refused: [] }
    o.onProgress?.({ found: o.cards.length, restored: 0 })
    o.onProgress?.({ found: o.cards.length, restored: got.restored.length })
    return { found: o.cards.length, already: [], ...got }
  }) as never,
})

describe('getting the cards back, identity by identity', () => {
  it('counts each card once, counts the identities whose agent is down, and goes on with the others', async () => {
    const progress: { found: number; restored: number }[] = []
    const got = await getCardsFromAgent(
      agent,
      [persona, elsewhere],
      (p) => progress.push(p),
      deps(
        {
          [VTA]: [cardAbout(persona.did, 0), cardAbout(persona.did, 1), cardAbout(persona.did, 2)],
          [OTHER_VTA]: 'down',
        },
        { [persona.did]: { restored: ['a', 'b'], refused: [{ reason: 'failedCheck' }] } }
      )
    )
    expect(got).toEqual({ found: 3, restored: 2, refused: [{ reason: 'failedCheck' }], unreachable: 1 })
    expect(progress[progress.length - 1]).toEqual({ found: 3, restored: 2 })
  })

  it('the count runs on from one identity to the next', async () => {
    const progress: { found: number; restored: number }[] = []
    await getCardsFromAgent(
      agent,
      [persona, second],
      (p) => progress.push(p),
      deps(
        { [VTA]: [cardAbout(persona.did, 0), cardAbout(persona.did, 1), cardAbout(second.did)] },
        { [persona.did]: { restored: ['a', 'b'], refused: [] }, [second.did]: { restored: ['c'], refused: [] } }
      )
    )
    expect(progress[progress.length - 1]).toEqual({ found: 3, restored: 3 })
  })

  it('each identity is handed its own cards, and a card about none of them is counted once', async () => {
    const stranger = cardAbout('did:webvh:QmX:zzzz')
    const recover = jest.fn(
      async (_a: unknown, _s: unknown, _p: VtiPersona, _t: unknown, o: { cards: AgentCard[] }) => ({
        found: o.cards.length,
        restored: [],
        refused: [],
      })
    )
    const d = { ...deps({ [VTA]: [cardAbout(persona.did), cardAbout(second.did), stranger] }), recover }
    const got = await getCardsFromAgent(agent, [persona, second], () => undefined, d as unknown as GetCardsDeps)
    expect(recover.mock.calls.map((c) => [c[2].did, c[4].cards.map((x) => x.id)])).toEqual([
      [persona.did, [cardAbout(persona.did).id]],
      [second.did, [cardAbout(second.did).id]],
    ])
    expect(got.refused).toEqual([{ credentialId: stranger.id, reason: 'notOurs' }])
  })

  // #401 Farm run: four identities on an agent keeping 88 cards fetched 352 of them, one by one (164 s).
  it("a card issued to an identity's did:scid form is that identity's, not another's", async () => {
    const scidOf = (did: string) => `did:scid:vh:1:${did.split(':')[2]}?src=x.example`
    const card = cardAbout(persona.did, 7)
    const asScid: AgentCard = {
      ...card,
      credential: { ...card.credential, credentialSubject: { id: scidOf(persona.did) } },
    }
    const recover = jest.fn(async (_a: Agent, _s: never, _p: VtiPersona, _t: never, o: { cards: AgentCard[] }) => ({
      found: o.cards.length,
      restored: o.cards.map((c) => c.id),
      already: [],
      refused: [],
    }))
    const d = { ...deps({ [VTA]: [asScid] }), recover: recover as never }
    const got = await getCardsFromAgent(agent, [persona], () => undefined, d)
    expect(recover.mock.calls.map((c) => c[4].cards.map((x) => x.id))).toEqual([[asScid.id]])
    expect(got.refused).toEqual([])
  })

  it('reads the vault once a run: one fetch per card, however many identities', async () => {
    const vault = fakeVault()
    for (const c of [cardAbout(persona.did), cardAbout(second.did), cardAbout('did:webvh:QmX:zzzz')])
      await vault.task('https://trusttasks.org/spec/vault/credentials/receive/0.1', { credential: c.credential })
    const before = vault.calls.length
    const d = {
      adopt: async () => found([]),
      store: () => fakeCommunityStore().store,
      taskFor: async () => vault.task,
      fetchCards: fetchAgentCards,
      recover: ((a: Agent, s: never, p: VtiPersona, t: never, o: object) =>
        recoverCardsFromAgent(a, s, p, t, { ...o, check: async () => undefined })) as never,
    } as unknown as GetCardsDeps
    await bringBackFromAgent(fakeAgent().agent, VTA, [persona, second], () => undefined, d)
    const gets = vault.calls.slice(before).filter((c) => /\/credentials\/get\/0\.[12]$/.test(c.type))
    expect(gets).toHaveLength(3)
  })

  // #401 re-time: 88 cards took ~40 s to read, and the count sat at "Found 0" for all of it.
  it('says how many cards there are as soon as the vault answers, then each one read', async () => {
    const vault = fakeVault()
    for (const c of [cardAbout(persona.did, 0), cardAbout(persona.did, 1), cardAbout(persona.did, 2)])
      await vault.task('https://trusttasks.org/spec/vault/credentials/receive/0.1', { credential: c.credential })
    const reads: [number, number][] = []
    await fetchAgentCards(vault.task, (read, of) => reads.push([read, of]))
    expect(reads).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ])
  })

  it("cards adoption found don't hold up are said as such, not as another identity's", async () => {
    const failing = cardAbout('did:webvh:QmLab:labb')
    const got = await bringBackFromAgent(
      agent,
      VTA,
      [persona],
      () => undefined,
      deps({ [VTA]: [failing] }, {}, async () =>
        found([], {
          otherIdentities: 1,
          cardsForOthers: 1,
          failedCheck: [{ credentialId: failing.id, communityDid: 'c' }],
        })
      )
    )
    expect(got.refused).toEqual([{ credentialId: failing.id, communityDid: 'c', reason: 'failedCheck' }])
  })
})

describe('Bring back on a phone an earlier Bring back took a room in as a community', () => {
  // 10-28: a member's phone listed "3 communities", two of them the rooms they had joined, and each rooms call asked
  // both rooms as communities, which never answer: the room list took about a minute.
  it('forgets the room first, and asks only the community for its cards', async () => {
    const vault = fakeVault()
    for (const credential of [membershipCard, roomMembershipCard, roomAuthorityCard])
      await vault.task('https://trusttasks.org/spec/vault/credentials/receive/0.1', { credential })
    const roomPersona: VtiPersona = { ...persona, communityDid: ROOM }
    const memberships = new Map<string, VtiMembership>(
      [COMMUNITY, ROOM].map((did) => [did, { communityDid: did, personaDid: PERSONA_DID } as VtiMembership])
    )
    const personas = new Map([persona, roomPersona].map((p) => [p.communityDid, p]))
    const d = {
      adopt: async () => found([]),
      store: () => fakeCommunityStore().store,
      taskFor: async () => vault.task,
      fetchCards: fetchAgentCards,
      recover: ((a: Agent, s: never, p: VtiPersona, t: never, o: object) =>
        recoverCardsFromAgent(a, s, p, t, { ...o, check: async () => undefined })) as never,
      forgetRooms: (_a: Agent, cards: AgentCard[]) =>
        forgetRoomCommunities({
          cards,
          communities: {
            listMemberships: async () => [...memberships.values()],
            forgetCommunity: async (did: string) => void memberships.delete(did),
          },
          identities: {
            listPersonas: async () => [...personas.values()],
            forgetPersona: async (did: string) => void personas.delete(did),
          },
        }),
    } as unknown as GetCardsDeps

    const got = await bringBackFromAgent(fakeAgent().agent, persona.vtaDid, [persona, roomPersona], () => undefined, d)

    expect(got.asked).toBe(1)
    expect([...memberships.keys()]).toEqual([COMMUNITY])
    expect([...personas.keys()]).toEqual([COMMUNITY])
  })
})

describe('the Manage row', () => {
  const renderRow = (personas: VtiPersona[], d: GetCardsDeps, vtaDid?: string) =>
    render(
      <BasicAppContext>
        <GetCardsFromAgent agent={agent} personas={personas} vtaDid={vtaDid} deps={d} />
      </BasicAppContext>
    )
  const tap = async (tree: ReturnType<typeof renderRow>) => {
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('AgentGetCardsButton')))
    })
  }

  it('is not offered with no agent linked and no identity', () => {
    const tree = renderRow([], deps({}))
    expect(tree.queryByTestId(testIdWithKey('AgentGetCards'))).toBeNull()
  })

  // 240 gate (cards-back-new-install): a new install held no identity, so it
  // was not offered this at all, and neither card came back.
  it('a new phone with its agent linked: offered, and it brings the communities back, then their cards', async () => {
    const adopt = jest.fn(async () => found([persona]))
    const cards = [cardAbout(persona.did, 0), cardAbout(persona.did, 1)]
    const d = deps({ [VTA]: cards }, { [persona.did]: { restored: ['m', 'r'], refused: [] } }, adopt)
    const recover = jest.spyOn(d, 'recover')
    const tree = renderRow([], d, VTA)
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsButton'))).toBeTruthy()
    await tap(tree)
    // Adoption is handed the cards the run read, and reads none itself.
    expect(adopt).toHaveBeenCalledWith(agent, VTA, [], cards)
    expect(recover.mock.calls.map((c) => (c[2] as VtiPersona).did)).toEqual([persona.did])
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsCommunities'))).toHaveTextContent(
      'VtaLink.CommunitiesBack(count=1)'
    )
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsResult'))).toHaveTextContent(/VtaLink\.CardsBack\(count=2\)/)
  })

  it('a second tap asks again for the cards of the identities the first one took on', async () => {
    let first = true
    const adopt = jest.fn(async () => (first ? ((first = false), found([persona])) : found([])))
    const d = deps({ [VTA]: [cardAbout(persona.did)] }, { [persona.did]: { restored: ['m'], refused: [] } }, adopt)
    const recover = jest.spyOn(d, 'recover')
    const tree = renderRow([], d, VTA)
    await tap(tree)
    await tap(tree)
    expect(recover).toHaveBeenCalledTimes(2)
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsResult'))).toHaveTextContent(/VtaLink\.CardsBack\(count=1\)/)
  })

  // #401 Farm run: a tap made after leaving the screen and coming back ran alongside the first.
  it('opened again while a run is going, it follows that run rather than starting another', async () => {
    let finish: (cards: AgentCard[]) => void = () => undefined
    const fetchCards = jest.fn(() => new Promise<AgentCard[]>((resolve) => (finish = resolve)))
    const d = { ...deps({ [VTA]: [] }, { [persona.did]: { restored: ['m'], refused: [] } }), fetchCards }
    const first = renderRow([persona], d, VTA)
    await tap(first)
    first.unmount()
    const again = renderRow([persona], d, VTA)
    expect(again.getByTestId(testIdWithKey('AgentGetCardsProgress'))).toBeTruthy()
    expect(again.getByTestId(testIdWithKey('AgentGetCardsButton'))).toBeDisabled()
    await tap(again)
    expect(fetchCards).toHaveBeenCalledTimes(1)
    await act(async () => finish([cardAbout(persona.did)]))
    expect(again.getByTestId(testIdWithKey('AgentGetCardsResult'))).toHaveTextContent(/VtaLink\.CardsBack\(count=1\)/)
    expect(again.getByTestId(testIdWithKey('AgentGetCardsButton'))).not.toBeDisabled()
  })

  it('while the cards are being read, says how many of how many', async () => {
    let finish: (cards: AgentCard[]) => void = () => undefined
    const fetchCards = jest.fn(
      (_t: unknown, onRead?: (read: number, of: number) => void) =>
        new Promise<AgentCard[]>((resolve) => {
          onRead?.(0, 3)
          onRead?.(1, 3)
          finish = resolve
        })
    )
    const d = { ...deps({ [VTA]: [] }, { [persona.did]: { restored: ['m'], refused: [] } }), fetchCards }
    const tree = renderRow([persona], d as GetCardsDeps, VTA)
    await tap(tree)
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsProgress'))).toHaveTextContent(
      'VtaLink.GetCardsReading(read=1,found=3)'
    )
    await act(async () => finish([cardAbout(persona.did)]))
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsResult'))).toHaveTextContent(/VtaLink\.CardsBack\(count=1\)/)
  })

  it('a new phone whose agent does not answer is told so, not that there are no cards', async () => {
    const tree = renderRow([], deps({ [VTA]: 'down' }), VTA)
    await tap(tree)
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsResult'))).toHaveTextContent('VtaLink.CardsBackUnreachable')
    expect(tree.queryByTestId(testIdWithKey('AgentGetCardsCommunities'))).toBeNull()
  })

  it('an identity already here is asked once, even when the agent names it again', async () => {
    const d = deps({ [VTA]: [cardAbout(persona.did)] }, { [persona.did]: { restored: ['m'], refused: [] } }, async () =>
      found([persona])
    )
    const recover = jest.spyOn(d, 'recover')
    const got = await bringBackFromAgent(agent, VTA, [persona], () => undefined, d)
    expect(recover).toHaveBeenCalledTimes(1)
    expect(got).toMatchObject({ restored: 1, adopted: 0, asked: 1 })
  })

  it("tells adoption the identities this phone holds on that agent, and only that agent's", async () => {
    const adopt = jest.fn(async () => found([]))
    await bringBackFromAgent(
      agent,
      VTA,
      [persona, elsewhere],
      () => undefined,
      deps({ [VTA]: [], [OTHER_VTA]: [] }, {}, adopt)
    )
    expect(adopt).toHaveBeenCalledWith(agent, VTA, [persona.did], [])
  })

  // K7 (Alberto, 10-04): "Get your cards" did not say what it was for. It
  // restores the agent's cards to this phone, and says when to use it.
  it('says it restores from the agent, and when to use it', () => {
    const tree = renderRow([persona], deps({}))
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsButton'))).toHaveTextContent('VtaLink.GetCardsButton')
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsHint'))).toHaveTextContent('VtaLink.GetCardsHint')
  })

  it('says how many came back, and why the others did not, in words', async () => {
    const tree = renderRow(
      [persona],
      deps(
        { [VTA]: [0, 1, 2, 3].map((n) => cardAbout(persona.did, n)) },
        { [persona.did]: { restored: ['a', 'b'], refused: [{ reason: 'failedCheck' }, { reason: 'notOurs' }] } }
      )
    )
    await tap(tree)
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsResult'))).toHaveTextContent(/VtaLink\.CardsBack\(count=2\)/)
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsRefused_failedCheck'))).toHaveTextContent(
      'VtaLink.CardsBackFailedCheck(count=1)'
    )
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsRefused_notOurs'))).toHaveTextContent(
      'VtaLink.CardsBackNotOurs(count=1)'
    )
    expect(tree.queryByTestId(testIdWithKey('AgentGetCardsRefused_unreadable'))).toBeNull()
  })

  // #401 Farm run: a tap that brought nothing new showed only what was left, never that nothing was new.
  it('a tap that finds everything already here says nothing is new', async () => {
    const tree = renderRow(
      [persona],
      deps(
        { [VTA]: [0, 1, 2].map((n) => cardAbout(persona.did, n)) },
        { [persona.did]: { restored: [], already: ['a', 'b'], refused: [{ reason: 'notOurs' }] } }
      )
    )
    await tap(tree)
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsSummary'))).toHaveTextContent(
      'VtaLink.CardsBackNothingNew(count=2)'
    )
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsRefused_notOurs'))).toHaveTextContent(
      'VtaLink.CardsBackNotOurs(count=1)'
    )
  })

  it('cards got back are said as got back, even with others already here', async () => {
    const tree = renderRow(
      [persona],
      deps(
        { [VTA]: [0, 1].map((n) => cardAbout(persona.did, n)) },
        { [persona.did]: { restored: ['a'], already: ['b'], refused: [] } }
      )
    )
    await tap(tree)
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsSummary'))).toHaveTextContent('VtaLink.CardsBack(count=1)')
  })

  it('an agent that does not answer is said plainly, and the button can be tried again', async () => {
    const tree = renderRow([persona], deps({ [VTA]: 'down' }))
    await tap(tree)
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsResult'))).toHaveTextContent('VtaLink.CardsBackUnreachable')
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsButton'))).not.toBeDisabled()
  })

  it('nothing kept for these communities is not an error', async () => {
    const tree = renderRow([persona], deps({ [VTA]: [] }))
    await tap(tree)
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsResult'))).toHaveTextContent('VtaLink.CardsBackNone')
  })

  // IN-363 / IN-114: a tap that brings no community back says why, in words, not just "no cards".
  describe('when no community comes back, it says why', () => {
    const tapWith = async (adoption: AdoptionFound) => {
      const tree = renderRow(
        [persona],
        deps({ [VTA]: [] }, {}, async () => adoption),
        VTA
      )
      await tap(tree)
      return tree
    }
    const why = (tree: Awaited<ReturnType<typeof tapWith>>) =>
      tree.getByTestId(testIdWithKey('AgentGetCardsNoCommunities'))

    it('the agent showed no identity but the ones here, under a grant that covers everything', async () => {
      expect(why(await tapWith(found([], { otherIdentities: 0 })))).toHaveTextContent('VtaLink.CommunitiesNoneSeen')
    })

    it('the same, under a grant limited to some contexts: it names them, a nested one as it is', async () => {
      const tree = await tapWith(found([], { otherIdentities: 0, visibleContexts: ['keyring', 'openvtc-alice/alice'] }))
      expect(why(tree)).toHaveTextContent(
        /^VtaLink\.CommunitiesNoneSeenScoped\(contexts=keyring, openvtc-alice\/alice,/
      )
    })

    it('other identities, but no community card about any of them', async () => {
      expect(why(await tapWith(found([], { otherIdentities: 2, cardsForOthers: 0 })))).toHaveTextContent(
        'VtaLink.CommunitiesNoCards'
      )
    })

    // 276.10: an admin console made the agent itself a member; its card is never taken on (agentOwnIdentity).
    it('only a card for the agent itself: said so, with the way on, not that the agent showed nothing', async () => {
      expect(
        why(await tapWith(found([], { otherIdentities: 0, cardsForOthers: 0, cardsForAgent: 1 })))
      ).toHaveTextContent('VtaLink.CommunitiesAgentItself')
    })

    it('an identity whose document could not be read is counted, not passed over in silence', async () => {
      const tree = await tapWith(found([], { otherIdentities: 1, cardsForOthers: 1, unreadable: ['did:webvh:QmU:x'] }))
      expect(tree.getByTestId(testIdWithKey('AgentGetCardsUnreadableIdentities'))).toHaveTextContent(
        'VtaLink.CommunitiesUnreadable(count=1)'
      )
      expect(tree.queryByTestId(testIdWithKey('AgentGetCardsNoCommunities'))).toBeNull()
    })

    it('a community that came back needs no reason', async () => {
      const tree = await tapWith(found([second]))
      expect(tree.getByTestId(testIdWithKey('AgentGetCardsCommunities'))).toHaveTextContent(
        'VtaLink.CommunitiesBack(count=1)'
      )
      expect(tree.queryByTestId(testIdWithKey('AgentGetCardsNoCommunities'))).toBeNull()
    })
  })
})
