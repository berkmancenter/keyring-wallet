import {
  CROCKFORD,
  TicketUriError,
  encodeTicketUri,
  isTicketUri,
  matchCodeFromDigest,
  parseTicketUri,
  vettingMatchCode,
} from '@bifold/trust-tasks'

// Ports of vta-sdk::vetting::{ticket_uri, match_code} at VTI-Eucalyptus-RC-0;
// the vectors mirror that crate's own tests so the two readers agree.
describe('vetting match code', () => {
  it('is two groups of four Crockford characters', () => {
    const code = vettingMatchCode('urn:uuid:5b0e1c2a-7d4f-4a51-9c6e-2f1b8d3a9e70')
    expect(code).toHaveLength(9)
    expect(code[4]).toBe('-')
    for (const c of code.replace('-', '')) expect(CROCKFORD).toContain(c)
  })
  it('is deterministic and input-sensitive', () => {
    expect(vettingMatchCode('urn:uuid:a')).toBe(vettingMatchCode('urn:uuid:a'))
    expect(vettingMatchCode('urn:uuid:a')).not.toBe(vettingMatchCode('urn:uuid:b'))
  })
  it('fills eight characters from exactly forty bits', () => {
    expect(matchCodeFromDigest(new Uint8Array(32).fill(0xff))).toBe('ZZZZ-ZZZZ')
    expect(matchCodeFromDigest(new Uint8Array(32))).toBe('0000-0000')
  })
})

const community = 'did:webvh:QmExampleCommunitySCID0000000000000000000000:host.example:first-vtc'
const vetter = 'did:webvh:QmExampleVetterSCID000000000000000000000000:host.example:some-name'
const secret = 'A'.repeat(43)

describe('vetting-ticket URI', () => {
  it('round-trips a scanned ticket, percent-encoding the DIDs', () => {
    const uri = encodeTicketUri({ community, vetter, presentation: { qr: { ticketId: 'vt-1a2b', secret } } })
    expect(uri.startsWith('vetting-ticket:?v=1&community=did%3Awebvh%3A')).toBe(true)
    expect(uri).toContain('&ticket=vt-1a2b&secret=')
    const back = parseTicketUri(uri)
    expect(back.community).toBe(community)
    expect(back.vetter).toBe(vetter)
    expect(back.presentation).toEqual({ qr: { ticketId: 'vt-1a2b', secret } })
  })
  it('round-trips a spoken code', () => {
    const uri = encodeTicketUri({ community, vetter, presentation: { code: { code: 'K7QF-2M9X' } } })
    expect(parseTicketUri(uri).presentation).toEqual({ code: { code: 'K7QF-2M9X' } })
  })
  it('recognises the scheme case-insensitively and trims whitespace', () => {
    expect(isTicketUri('  VETTING-TICKET:?v=1 ')).toBe(true)
    expect(isTicketUri('keyring://vti/invitation?c=x')).toBe(false)
  })
  it('refuses what the reference reader refuses', () => {
    const base = `vetting-ticket:?v=1&community=${encodeURIComponent(community)}&vetter=${encodeURIComponent(vetter)}`
    const fails = (u: string, kind: 'malformed' | 'unsupportedVersion' = 'malformed') => {
      try {
        parseTicketUri(u)
      } catch (e) {
        expect(e).toBeInstanceOf(TicketUriError)
        expect((e as TicketUriError).kind).toBe(kind)
        return
      }
      throw new Error(`accepted: ${u}`)
    }
    fails(`${base}&code=K7QF-2M9X#frag`) // no fragment
    fails(`${base}&code=K7QF-2M9X&code=K7QF-2M9X`) // repeated member
    fails(`${base}&ticket=vt-1`) // scanned needs both halves
    fails(`${base}&ticket=vt-1&secret=${secret}&code=K7QF-2M9X`) // not both forms
    fails(base) // no ticket
    fails(`${base}&code=K7QF-2M9I`) // I is not Crockford
    fails(`${base}&ticket=vt-1&secret=too-short`)
    fails(`other-scheme:?v=1&code=K7QF-2M9X`)
    fails(`vetting-ticket:?v=2&community=${encodeURIComponent(community)}&vetter=${encodeURIComponent(vetter)}&code=K7QF-2M9X`, 'unsupportedVersion')
  })
  it('ignores members a later version may add', () => {
    const uri = `vetting-ticket:?v=1&community=${encodeURIComponent(community)}&vetter=${encodeURIComponent(vetter)}&code=K7QF-2M9X&note=hi`
    expect(parseTicketUri(uri).presentation).toEqual({ code: { code: 'K7QF-2M9X' } })
  })
})
