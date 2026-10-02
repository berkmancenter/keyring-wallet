/**
 * What the Join screen says about a community's ways in (join manifest 0.3,
 * VTI docs/03-vtc/join-criteria.md). The rule the words must keep: meeting a
 * way is said to admit only when its admission is automatic; under review an
 * administrator decides; a 0.2 manifest states neither, and the screen says
 * what it says today.
 */
import enCopy from '../../../localization/en/en.json'
import frCopy from '../../../localization/fr/fr.json'
import ptBrCopy from '../../../localization/pt-br/pt-br.json'
import { joinCard, type JoinOffer, type JoinWay } from '../screens/joinWays'

const way = (over: Partial<JoinWay> & Pick<JoinWay, 'id'>): JoinWay => ({
  admission: 'automatic',
  requires: { invitation: false },
  requiresNothing: false,
  usable: true,
  digest: `digest-${over.id}`,
  ...over,
})

const invited = way({ id: 'invited', requires: { invitation: true } })
const memberCredential = way({
  id: 'member-credential',
  requires: { invitation: false, credentials: { issuers: 'recognised', types: ['MembershipCredential'] } },
})
const review = way({ id: 'review', admission: 'review', requiresNothing: true })
const vetted = (admission: JoinWay['admission']) =>
  way({
    id: 'vetted-member',
    admission,
    requires: { invitation: false, vetting: { statements: 2, claims: ['name.legal'], methods: ['in-person'] } },
  })

/** A new community: the three defaults, in order, seen from a phone holding nothing. */
const defaults: JoinOffer = {
  accepting: true,
  ways: [
    { ...invited, usable: false, unusableBecause: 'noInvitation' },
    { ...memberCredential, usable: false, unusableBecause: 'noCredential' },
    review,
  ],
  suggested: review,
  outcomeIfMet: 'reviewed',
}

describe('a 0.2 manifest states no admission', () => {
  const legacy: JoinOffer = {
    accepting: true,
    ways: [way({ id: 'vetted-member', admission: 'unstated', requires: vetted('unstated').requires })],
    outcomeIfMet: 'unstated',
  }

  it('is shown exactly as today: the card says so, and adds nothing', () => {
    expect(joinCard(legacy)).toEqual({ mode: 'legacy' })
  })

  it('even with several criteria', () => {
    const several = { ...legacy, ways: [...legacy.ways, way({ id: 'invited', admission: 'unstated' })] }
    expect(joinCard(several)).toEqual({ mode: 'legacy' })
  })
})

describe('a community that accepts no applications', () => {
  it('says so, with nothing to start', () => {
    expect(joinCard({ accepting: false, ways: [], outcomeIfMet: 'unstated' })).toEqual({ mode: 'notAccepting' })
  })

  it('says so even if it still lists ways', () => {
    expect(joinCard({ ...defaults, accepting: false })).toEqual({ mode: 'notAccepting' })
  })

  it('a 0.3 community with no ways is not accepting either', () => {
    expect(joinCard({ accepting: true, ways: [], outcomeIfMet: 'reviewed' })).toEqual({ mode: 'notAccepting' })
  })
})

describe('the three defaults, on a phone holding nothing', () => {
  const card = joinCard(defaults)

  it('lists every way in the community’s order', () => {
    expect(card.mode).toBe('ways')
    if (card.mode !== 'ways') return
    expect(card.rows.map((r) => r.id)).toEqual(['invited', 'member-credential', 'review'])
    expect(card.several).toBe(true)
  })

  it('says what each needs, and what follows', () => {
    if (card.mode !== 'ways') throw new Error('ways')
    expect(card.rows[0]).toMatchObject({ needs: [{ kind: 'invitation' }], follows: 'automatic', suggested: false })
    expect(card.rows[1]).toMatchObject({
      needs: [{ kind: 'credential', issuers: 'recognised', types: ['MembershipCredential'] }],
      follows: 'automatic',
    })
    expect(card.rows[2]).toMatchObject({ needs: [{ kind: 'nothing' }], follows: 'review', suggested: true })
  })

  it('offers to ask, not to join: a plain request is reviewed, never admitted', () => {
    if (card.mode !== 'ways') throw new Error('ways')
    expect(card.button).toBe('ask')
  })
})

describe('the main button follows what meeting the suggested way leads to', () => {
  it('an invited phone joins: the invitation way is automatic and it is first', () => {
    const offer: JoinOffer = {
      ...defaults,
      ways: [invited, memberCredential, review],
      suggested: invited,
      outcomeIfMet: 'joined',
    }
    const card = joinCard(offer)
    if (card.mode !== 'ways') throw new Error('ways')
    expect(card.button).toBe('join')
    expect(card.rows.map((r) => r.suggested)).toEqual([true, false, false])
  })

  it('a way that needs vetting starts it: the person is not joining or asking yet', () => {
    for (const admission of ['automatic', 'review'] as const) {
      const offer: JoinOffer = {
        accepting: true,
        ways: [vetted(admission)],
        suggested: vetted(admission),
        outcomeIfMet: admission === 'automatic' ? 'joined' : 'reviewed',
      }
      const card = joinCard(offer)
      if (card.mode !== 'ways') throw new Error('ways')
      expect(card.button).toBe('start')
    }
  })

  it('a vetted way under review says an administrator decides, never that it admits', () => {
    const offer: JoinOffer = {
      accepting: true,
      ways: [vetted('review')],
      suggested: vetted('review'),
      outcomeIfMet: 'reviewed',
    }
    const card = joinCard(offer)
    if (card.mode !== 'ways') throw new Error('ways')
    expect(card.rows[0]).toMatchObject({
      needs: [{ kind: 'vetting', statements: 2, claims: ['name.legal'] }],
      follows: 'review',
    })
  })

  it('the button is never "join" unless the suggested way is automatic, whatever outcomeIfMet says', () => {
    const offer: JoinOffer = { accepting: true, ways: [review], suggested: review, outcomeIfMet: 'joined' }
    const card = joinCard(offer)
    if (card.mode !== 'ways') throw new Error('ways')
    expect(card.button).toBe('ask')
  })
})

describe('no way this phone can meet', () => {
  it('invitation only, no invitation: says an invitation is needed, and points at "I was invited"', () => {
    const offer: JoinOffer = {
      accepting: true,
      ways: [{ ...invited, usable: false, unusableBecause: 'noInvitation' }],
      outcomeIfMet: 'joined',
    }
    const card = joinCard(offer)
    if (card.mode !== 'ways') throw new Error('ways')
    expect(card.button).toBe('invited')
    expect(card.missing).toEqual(['invitation'])
    expect(card.several).toBe(false)
  })

  it('a credential the phone does not hold: says which, and offers nothing to press', () => {
    const offer: JoinOffer = {
      accepting: true,
      ways: [{ ...memberCredential, usable: false, unusableBecause: 'noCredential' }],
      outcomeIfMet: 'joined',
    }
    const card = joinCard(offer)
    if (card.mode !== 'ways') throw new Error('ways')
    expect(card.button).toBe('none')
    expect(card.missing).toEqual(['credential'])
  })

  it('both missing: both are named, and the invitation is the one a person can act on', () => {
    const offer: JoinOffer = {
      accepting: true,
      ways: [
        { ...invited, usable: false, unusableBecause: 'noInvitation' },
        { ...memberCredential, usable: false, unusableBecause: 'noCredential' },
      ],
      outcomeIfMet: 'joined',
    }
    const card = joinCard(offer)
    if (card.mode !== 'ways') throw new Error('ways')
    expect(card.missing).toEqual(['invitation', 'credential'])
    expect(card.button).toBe('invited')
  })

  it('a way this app cannot use at all is marked, never offered', () => {
    const odd = way({ id: 'odd', usable: false, unusableBecause: 'unsupportedRequirement' })
    const card = joinCard({ accepting: true, ways: [odd, review], suggested: review, outcomeIfMet: 'reviewed' })
    if (card.mode !== 'ways') throw new Error('ways')
    expect(card.rows[0]).toMatchObject({ usable: false, cannotUse: true })
    expect(card.rows[1]).toMatchObject({ usable: true, cannotUse: false })
  })
})

describe('a way that asks for several things lists each', () => {
  it('an invitation and vetting together', () => {
    const both = way({
      id: 'invited-and-vetted',
      requires: { invitation: true, vetting: { statements: 1, claims: [], methods: [] } },
    })
    const card = joinCard({ accepting: true, ways: [both], suggested: both, outcomeIfMet: 'joined' })
    if (card.mode !== 'ways') throw new Error('ways')
    expect(card.rows[0].needs.map((n) => n.kind)).toEqual(['invitation', 'vetting'])
  })
})

describe('the words', () => {
  const all = [enCopy, frCopy, ptBrCopy] as const
  const ways = (words: (typeof all)[number]) => (words.Join as unknown as { Ways: Record<string, string> }).Ways

  it('exist in every language', () => {
    for (const words of all) {
      for (const key of [
        'NotAccepting',
        'Changed',
        'ReadAgain',
        'VersionUnsupported',
        'Title',
        'Several',
        'NeedsInvitation',
        'NeedsCredentialCommunity',
        'NeedsCredentialRecognised',
        'NeedsCredentialAny',
        'NeedsNothing',
        'FollowsAutomatic',
        'FollowsReview',
        'Suggested',
        'MissingInvitation',
        'MissingCredential',
        'CannotUse',
        'ButtonJoin',
        'ButtonAsk',
        'SentForReview',
        'TypeMembership',
      ]) {
        expect(ways(words)[key]).toEqual(expect.any(String))
      }
    }
  })

  it('promise admission only in the automatic line', () => {
    for (const [words, admitted] of [
      [enCopy, /admit/i],
      [frCopy, /admis/i],
      [ptBrCopy, /admiss|admit/i],
    ] as const) {
      const w = ways(words)
      expect(w.FollowsAutomatic).toMatch(admitted)
      for (const key of ['FollowsReview', 'NeedsNothing', 'Suggested', 'ButtonAsk', 'SentForReview', 'Title']) {
        expect(w[key]).not.toMatch(admitted)
      }
    }
  })

  it('name no provider', () => {
    for (const words of all) expect(JSON.stringify(ways(words))).not.toMatch(/farm/i)
  })
})
