import {
  CROCKFORD,
  TicketUriError,
  encodeTicketUri,
  isTicketUri,
  matchCodeFromDigest,
  parseTicketUri,
  vettingMatchCode,
} from '@bifold/trust-tasks'
import { sha256 } from '@noble/hashes/sha2.js'

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

// The match code is read aloud between two people, and its whole value is
// that hearing the right eight characters means you are in the session you
// think you are in. That rests on the domain tag, which until now was asserted
// only by a comment. These are the properties the tag is there to buy.
describe('vetting match code — domain separation', () => {
  const DOMAIN_TAG = 'vetting-session-match/v1\0'
  const encoder = new TextEncoder()
  /** What the code would be under some other protocol's tag over the same id. */
  const codeUnderTag = (tag: string, id: string) =>
    matchCodeFromDigest(sha256(new Uint8Array([...encoder.encode(tag), ...encoder.encode(id)])))

  const sessionId = 'urn:uuid:5b0e1c2a-7d4f-4a51-9c6e-2f1b8d3a9e70'

  it('is tagged, not a bare digest of the session id', () => {
    // If the tag were ever dropped, this is the shape the code would collapse
    // to — and any other protocol hashing the same identifier would then read
    // out the same eight characters.
    expect(vettingMatchCode(sessionId)).not.toBe(matchCodeFromDigest(sha256(encoder.encode(sessionId))))
  })

  it('uses the tag the wire format specifies', () => {
    expect(vettingMatchCode(sessionId)).toBe(codeUnderTag(DOMAIN_TAG, sessionId))
  })

  it('cannot collide with another protocol reading the same identifier', () => {
    // A personhood challenge over the identical id must never speak the same
    // code — that collision is what would let one ceremony's spoken code be
    // replayed to satisfy the other.
    for (const tag of ['personhood-challenge/v1\0', 'vetting-session-match/v2\0', 'vetting-card-match/v1\0']) {
      expect(vettingMatchCode(sessionId)).not.toBe(codeUnderTag(tag, sessionId))
    }
  })

  it('separates the tag from the id, so no shifted split collides', () => {
    // Without a terminator, 'tag' + 'Xabc' and 'tagX' + 'abc' hash the same
    // bytes and two distinct sessions read out one code. The NUL is what
    // makes them different inputs.
    expect(vettingMatchCode('Xabc')).not.toBe(codeUnderTag('vetting-session-match/v1X', 'abc'))
    // And the other direction: a tag that is a strict prefix of this one,
    // with the remainder pushed into the identifier, does not collide either —
    // the NUL lands in a different place.
    expect(vettingMatchCode(sessionId)).not.toBe(codeUnderTag('vetting-session-match/v', `1${sessionId}`))

    // The guarantee this rests on, stated exactly: for two tags that contain
    // no NUL themselves, neither `tagA + NUL` nor `tagB + NUL` can be a prefix
    // of the other, so no identifier can shift one into the other. It follows
    // that an identifier carrying a NUL is outside the guarantee — a document
    // id never does, and if one ever could, this is the line that would have
    // to change rather than a comment somewhere.
    expect(DOMAIN_TAG.slice(0, -1)).not.toContain('\0')
    expect(sessionId).not.toContain('\0')
  })

  it('never speaks a character that can be misheard as another', () => {
    // I/L/O/U are absent from Crockford precisely so a code read down a phone
    // line cannot be written back as a different valid code.
    for (let i = 0; i < 500; i++) {
      const code = vettingMatchCode(`urn:uuid:sample-${i}`)
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
    }
  })

  it('changes completely when the session does', () => {
    // Neighbouring ids must not produce neighbouring codes: a vetter comparing
    // two sessions by eye should not be able to confuse them by a character.
    const a = vettingMatchCode('urn:uuid:00000000-0000-0000-0000-000000000000')
    const b = vettingMatchCode('urn:uuid:00000000-0000-0000-0000-000000000001')
    const differing = [...a].filter((c, i) => c !== b[i]).length
    expect(differing).toBeGreaterThan(2)
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
