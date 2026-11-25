/**
 * test-vtc.openvtc.net, as it answered on 2026-10-15 (VTC 0.11.58): its
 * "Vetted-Member" way runs hidden (private) vetting. The way must be read as
 * private, under the digest the community published, so that a build that
 * carries hidden vetting offers it (242/243), and one that does not fails
 * closed (#405). A digest rule that disagreed would read it as "changed" and
 * hide it, which is what this guards.
 */
import { criterionDigest, joinAsks, readManifest, type VtiManifest } from '../module/joinManifest'
import { joinCard } from '../screens/joinWays'

import captured from './fixtures/join-0.3/test-vtc-hidden-vetting-2026-10-15.json'

const manifest = readManifest(captured.manifest03.payload as Partial<VtiManifest>, '0.3')
const vetted = () => joinAsks(manifest).ways.find((w) => w.id === 'Vetted-Member')

describe('test-vtc as published', () => {
  it.each(manifest.criteria.map((c) => [c.id, c] as const))(
    'recomputes to the digest it published: %s',
    (_id, criterion) => {
      expect(criterionDigest(criterion)).toBe(criterion.requirementsDigest)
    }
  )

  it('"Vetted-Member" is private vetting in the suite agents run, not a changed way', () => {
    expect(vetted()).toMatchObject({
      usable: false,
      unusableBecause: 'vettingPrivate',
      hiddenVetting: { suite: 'ps-ddh-bls12381' },
      requires: { vetting: { statements: 1, methods: ['inPerson', 'video'] } },
    })
  })

  it('a build that carries hidden vetting offers it with its own button', () => {
    const card = joinCard(joinAsks(manifest), {}, { privateVettingAvailable: true })
    if (card.mode !== 'ways') throw new Error('expected ways')
    expect(card.rows.find((r) => r.id === 'Vetted-Member')).toMatchObject({ privateVetting: true, cannotUse: false })
    expect(card.vettingNotSupported).toBeUndefined()
  })

  it('a build that does not fails closed, and its other ways stay', () => {
    const card = joinCard(joinAsks(manifest))
    if (card.mode !== 'ways') throw new Error('expected ways')
    expect(card.vettingNotSupported).toBe('private')
    expect(card.rows.find((r) => r.id === 'review')).toMatchObject({ usable: true })
  })
})
