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
  meets: 'yes',
  digest: `digest-${over.id}`,
  ...over,
})

const invited = way({ id: 'invited', requires: { invitation: true } })
const memberCredential = way({
  id: 'member-credential',
  requires: { invitation: false, credentials: { issuers: 'recognised', types: ['MembershipCredential'] } },
  // The model does not evaluate credentials.
  meets: 'unknown',
})
const review = way({ id: 'review', admission: 'review', requiresNothing: true })
const vetted = (admission: JoinWay['admission'], meets: JoinWay['meets'] = 'no') =>
  way({
    id: 'vetted-member',
    admission,
    meets,
    requires: { invitation: false, vetting: { statements: 2, claims: ['name.legal'], methods: ['in-person'] } },
  })

/** A new community: the three defaults, in order, seen from a phone holding nothing. */
const defaults: JoinOffer = {
  wire: '0.3',
  accepting: true,
  ways: [{ ...invited, meets: 'no' }, memberCredential, review],
  suggested: review,
  outcomeIfMet: 'reviewed',
}

describe('a 0.2 manifest states no admission', () => {
  const legacy: JoinOffer = {
    wire: '0.2',
    accepting: true,
    ways: [vetted('unstated')],
  }

  it('is shown exactly as today: the card says so, and adds nothing', () => {
    expect(joinCard(legacy)).toEqual({ mode: 'legacy' })
  })

  it('whatever it lists, and with no criteria at all (today’s "asks for nothing")', () => {
    expect(joinCard({ ...legacy, ways: [...legacy.ways, way({ id: 'invited', admission: 'unstated' })] })).toEqual({
      mode: 'legacy',
    })
    expect(joinCard({ ...legacy, ways: [] })).toEqual({ mode: 'legacy' })
  })
})

describe('a community that accepts no applications', () => {
  it('says so, with nothing to start', () => {
    expect(joinCard({ wire: '0.3', accepting: false, ways: [] })).toEqual({ mode: 'notAccepting' })
  })

  it('says so even if it still lists ways', () => {
    expect(joinCard({ ...defaults, accepting: false })).toEqual({ mode: 'notAccepting' })
  })

  it('a 0.3 community with no ways is not accepting either', () => {
    expect(joinCard({ wire: '0.3', accepting: true, ways: [] })).toEqual({ mode: 'notAccepting' })
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
    // There is a way to use, so nothing is called missing.
    expect(card.missing).toEqual([])
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
    const card = joinCard(offer, { invitation: true })
    if (card.mode !== 'ways') throw new Error('ways')
    expect(card.button).toBe('join')
    expect(card.rows.map((r) => r.suggested)).toEqual([true, false, false])
  })

  it('vetting still to do starts it: the person is not joining or asking yet', () => {
    for (const admission of ['automatic', 'review'] as const) {
      // The phone holds no statements: it meets no way, so nothing is suggested.
      const card = joinCard({ wire: '0.3', accepting: true, ways: [vetted(admission)] })
      if (card.mode !== 'ways') throw new Error('ways')
      expect(card.button).toBe('start')
      expect(card.missing).toEqual([])
    }
  })

  it('vetting done: an automatic way joins, a review way asks', () => {
    const auto = vetted('automatic', 'yes')
    const joins = joinCard({ wire: '0.3', accepting: true, ways: [auto], suggested: auto, outcomeIfMet: 'joined' })
    const rev = vetted('review', 'yes')
    const asks = joinCard({ wire: '0.3', accepting: true, ways: [rev], suggested: rev, outcomeIfMet: 'reviewed' })
    if (joins.mode !== 'ways' || asks.mode !== 'ways') throw new Error('ways')
    expect(joins.button).toBe('join')
    expect(asks.button).toBe('ask')
    expect(asks.rows[0]).toMatchObject({
      needs: [{ kind: 'vetting', statements: 2, claims: ['name.legal'] }],
      follows: 'review',
    })
  })

  it('the button is never "join" unless the suggested way is automatic, whatever outcomeIfMet says', () => {
    const card = joinCard({ wire: '0.3', accepting: true, ways: [review], suggested: review, outcomeIfMet: 'joined' })
    if (card.mode !== 'ways') throw new Error('ways')
    expect(card.button).toBe('ask')
  })
})

describe('no way this phone meets', () => {
  it('invitation only, no invitation: says an invitation is needed, and points at "I was invited"', () => {
    const card = joinCard({ wire: '0.3', accepting: true, ways: [{ ...invited, meets: 'no' }] })
    if (card.mode !== 'ways') throw new Error('ways')
    expect(card.button).toBe('invited')
    expect(card.missing).toEqual(['invitation'])
    expect(card.several).toBe(false)
  })

  it('a credential way the model cannot check: named as what is needed, nothing to press', () => {
    const card = joinCard({ wire: '0.3', accepting: true, ways: [memberCredential] })
    if (card.mode !== 'ways') throw new Error('ways')
    expect(card.button).toBe('none')
    expect(card.missing).toEqual(['credential'])
  })

  it('both: both are named, and the invitation is the one a person can act on', () => {
    const card = joinCard({ wire: '0.3', accepting: true, ways: [{ ...invited, meets: 'no' }, memberCredential] })
    if (card.mode !== 'ways') throw new Error('ways')
    expect(card.missing).toEqual(['invitation', 'credential'])
    expect(card.button).toBe('invited')
  })

  it('vetting behind an invitation the phone lacks: the invitation comes first', () => {
    const both = way({
      id: 'invited-and-vetted',
      meets: 'no',
      requires: { invitation: true, vetting: { statements: 1, claims: [], methods: [] } },
    })
    const without = joinCard({ wire: '0.3', accepting: true, ways: [both] })
    const withOne = joinCard({ wire: '0.3', accepting: true, ways: [both] }, { invitation: true })
    if (without.mode !== 'ways' || withOne.mode !== 'ways') throw new Error('ways')
    expect(without.button).toBe('invited')
    expect(without.missing).toEqual(['invitation'])
    // Holding the invitation, what is left is the vetting.
    expect(withOne.button).toBe('start')
    expect(withOne.missing).toEqual([])
    expect(withOne.rows[0].needs.map((n) => n.kind)).toEqual(['invitation', 'vetting'])
  })
})

describe('a way Keyring cannot read as published', () => {
  it.each([
    'idMissing',
    'admissionMissing',
    'admissionUnknown',
    'digestMissing',
    'digestMismatch',
    'issuersMissing',
    'issuersUnknown',
    'vettingUnreadable',
  ])('%s: marked, never offered, never called "missing"', (unusableBecause) => {
    const odd = way({ id: 'odd', usable: false, unusableBecause, meets: 'no', requires: { invitation: true } })
    const card = joinCard({
      wire: '0.3',
      accepting: true,
      ways: [odd, review],
      suggested: review,
      outcomeIfMet: 'reviewed',
    })
    if (card.mode !== 'ways') throw new Error('ways')
    expect(card.rows[0]).toMatchObject({ usable: false, cannotUse: true, suggested: false })
    expect(card.rows[1]).toMatchObject({ usable: true, cannotUse: false })
    const only = joinCard({ wire: '0.3', accepting: true, ways: [odd] })
    if (only.mode !== 'ways') throw new Error('ways')
    expect(only.missing).toEqual([])
    expect(only.button).toBe('none')
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

  it('do not claim what the phone holds about a credential nobody checked', () => {
    // The model does not evaluate credentials, so "this phone doesn't hold" would be a guess.
    expect(ways(enCopy).MissingCredential).not.toMatch(/doesn.t hold|does not hold/i)
    expect(ways(frCopy).MissingCredential).not.toMatch(/n'a pas/i)
    expect(ways(ptBrCopy).MissingCredential).not.toMatch(/não tem/i)
  })

  it('name no provider', () => {
    for (const words of all) expect(JSON.stringify(ways(words))).not.toMatch(/farm/i)
  })
})
