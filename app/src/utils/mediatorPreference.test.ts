/**
 * Tester report 7MCB-MF6G (build 232): an install first used with a build that
 * baked the ACA-Py mediator's padded `?c_i=` invitation kept it in its stored
 * preferences, and Credo 0.7 — which refuses base64 padding — failed in
 * 'onInitializeContext' on every start. The stored mediator must be replaced
 * by the build's when it cannot work, and kept when it can.
 */
import {
  chooseMediator,
  mediatorInvitationReadable,
  mediatorProblem,
  RETIRED_MEDIATOR_HOSTS,
} from './mediatorPreference'

// An invitation whose standard base64 ends in "==", as the old builds baked it.
const connectionsInvitation = {
  '@type': 'https://didcomm.org/connections/1.0/invitation',
  '@id': 'b1',
  label: 'ACA-Py Mediator',
  recipientKeys: ['9QWHsZsVukeVt4dmWbkqGf5wuU5XpYsXMXJ3FCKPnpkG'],
  serviceEndpoint: 'https://aries-mediator.asml.berkmancenter.org',
}
let padded = Buffer.from(JSON.stringify(connectionsInvitation)).toString('base64')
for (let n = 0; !padded.endsWith('=='); n++) {
  padded = Buffer.from(JSON.stringify({ ...connectionsInvitation, label: `ACA-Py Mediator${' '.repeat(n)}` })).toString(
    'base64'
  )
}
const OLD_STORED = `https://aries-mediator.asml.berkmancenter.org/?c_i=${padded}`

// What today's builds bake: an out-of-band invitation, base64url without padding.
const oob = Buffer.from(JSON.stringify({ '@type': 'https://didcomm.org/out-of-band/1.1/invitation', '@id': 'c2' }))
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '')
const BUILD = `https://credo-mediator.asml.berkmancenter.org/invitation?oob=${oob}`

describe('a stored mediator an older build chose', () => {
  it("the tester's case: the retired ACA-Py mediator, padded, is replaced by the build's", () => {
    expect(OLD_STORED).toMatch(/==$/)
    expect(chooseMediator(OLD_STORED, BUILD, [OLD_STORED])).toEqual({ url: BUILD, replaced: 'retired' })
  })

  it('a padded invitation on any host is unreadable to Credo 0.7, and replaced', () => {
    const elsewhere = OLD_STORED.replace('aries-mediator.asml.berkmancenter.org', 'mediator.example.org')
    expect(mediatorInvitationReadable(elsewhere)).toBe(false)
    expect(chooseMediator(elsewhere, BUILD, [elsewhere])).toEqual({ url: BUILD, replaced: 'unparseable' })
  })

  it('junk, nothing stored, or a value outside what the phone was offered is replaced', () => {
    expect(chooseMediator('not a url', BUILD).replaced).toBe('unparseable')
    expect(chooseMediator('', BUILD).replaced).toBe('missing')
    expect(chooseMediator(undefined, BUILD).replaced).toBe('missing')
    const stray = BUILD.replace('credo-mediator', 'other-mediator')
    expect(chooseMediator(stray, BUILD, []).replaced).toBe('notOffered')
  })

  it("keeps the build's own mediator", () => {
    expect(chooseMediator(BUILD, BUILD, [BUILD])).toEqual({ url: BUILD })
  })

  it('keeps a readable mediator the person added in Settings', () => {
    const added = BUILD.replace('credo-mediator', 'my-mediator')
    expect(chooseMediator(added, BUILD, [BUILD, added])).toEqual({ url: added })
  })

  it('a retired or unreadable entry in the added list does not make it offered', () => {
    expect(mediatorProblem(OLD_STORED, [OLD_STORED])).toBe('retired')
    expect(chooseMediator(OLD_STORED, BUILD, [OLD_STORED]).url).toBe(BUILD)
  })

  it('a short URL with no invitation parameter is left for Credo to resolve', () => {
    expect(mediatorInvitationReadable('https://mediator.example.org/s/abc')).toBe(true)
  })

  it('names the retired ACA-Py mediator', () => {
    expect(RETIRED_MEDIATOR_HOSTS).toContain('aries-mediator.asml.berkmancenter.org')
  })
})
