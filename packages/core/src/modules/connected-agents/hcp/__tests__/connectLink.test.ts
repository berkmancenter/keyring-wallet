/**
 * The HCP connect link (brief, "The connect link"): exactly `_from`, `_id` and `_type` in the fragment of
 * `https://link.trustoverip.org/t`, at most 251 UTF-8 bytes. Everything else is not an HCP connect link.
 */
import { utf8ToBytes } from '@noble/hashes/utils.js'

import { HCP_LINK_MAX_BYTES, hcpConnectLink, readHcpConnectLink } from '../connectLink'
import vectors from './vectors/match-number.json'

const CLIENT = vectors.cases[0].clientVid
const UUID = vectors.cases[0].threadId.slice('urn:uuid:'.length)
const BASE = 'https://link.trustoverip.org/t#'
const bytes = (text: string) => utf8ToBytes(text).length

describe('readHcpConnectLink', () => {
  it('control: the 166-byte link of the vectors’ first case reads back to its parts', () => {
    const link = hcpConnectLink({ clientVid: CLIENT, uuid: UUID })
    expect(link).toBe(`${BASE}_from=${CLIENT}&_id=${UUID}&_type=/vti/flow/hcp-connect/0.1`)
    expect(bytes(link)).toBe(166)
    expect(readHcpConnectLink(link)).toEqual({ clientVid: CLIENT, uuid: UUID, threadId: vectors.cases[0].threadId })
  })

  it('round-trips every vector', () => {
    for (const { threadId, clientVid } of vectors.cases) {
      const uuid = threadId.slice('urn:uuid:'.length)
      expect(readHcpConnectLink(hcpConnectLink({ clientVid, uuid }))).toEqual({ clientVid, uuid, threadId })
    }
  })

  it('reads both _type forms, the members in any order, and percent-encoded values', () => {
    const parts = { clientVid: CLIENT, uuid: UUID, threadId: `urn:uuid:${UUID}` }
    expect(
      readHcpConnectLink(
        `${BASE}_from=${CLIENT}&_id=${UUID}&_type=https://link.trustoverip.org/vti/flow/hcp-connect/0.1`
      )
    ).toEqual(parts)
    expect(readHcpConnectLink(`${BASE}_type=/vti/flow/hcp-connect/0.1&_id=${UUID}&_from=${CLIENT}`)).toEqual(parts)
    expect(
      readHcpConnectLink(
        `${BASE}_from=${CLIENT.replace(/:/g, '%3A')}&_id=${UUID}&_type=%2Fvti%2Fflow%2Fhcp-connect%2F0.1`
      )
    ).toEqual(parts)
  })

  const ok = `_from=${CLIENT}&_id=${UUID}&_type=/vti/flow/hcp-connect/0.1`
  it.each([
    ['another host', `https://link.example.org/t#${ok}`],
    ['another scheme', `http://link.trustoverip.org/t#${ok}`],
    ['another path', `https://link.trustoverip.org/c#${ok}`],
    ['a query instead of a fragment', `https://link.trustoverip.org/t?${ok}`],
    ['a query before the fragment', `https://link.trustoverip.org/t?x=1#${ok}`],
    ['a missing _from', `${BASE}_id=${UUID}&_type=/vti/flow/hcp-connect/0.1`],
    ['a missing _id', `${BASE}_from=${CLIENT}&_type=/vti/flow/hcp-connect/0.1`],
    ['a missing _type', `${BASE}_from=${CLIENT}&_id=${UUID}`],
    ['_id twice', `${BASE}${ok}&_id=${UUID}`],
    ['_from twice', `${BASE}_from=${CLIENT}&${ok}`],
    ['an extra member', `${BASE}${ok}&_vta=did:web:example.org`],
    ['an empty member', `${BASE}${ok}&`],
    ['a member without a value', `${BASE}${ok}&_x`],
    ['another flow', `${BASE}_from=${CLIENT}&_id=${UUID}&_type=/vti/flow/agent-connect/0.1`],
    [
      'a did:key that is not Ed25519',
      `${BASE}_from=did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169&_id=${UUID}&_type=/vti/flow/hcp-connect/0.1`,
    ],
    ['a did:web', `${BASE}_from=did:web:example.org&_id=${UUID}&_type=/vti/flow/hcp-connect/0.1`],
    ['an upper-case UUID', `${BASE}_from=${CLIENT}&_id=${UUID.toUpperCase()}&_type=/vti/flow/hcp-connect/0.1`],
    ['a v1 UUID', `${BASE}_from=${CLIENT}&_id=7c2a9e41-5b3d-1f6a-8e1c-0a9b8d7c6e51&_type=/vti/flow/hcp-connect/0.1`],
    ['a urn:uuid _id', `${BASE}_from=${CLIENT}&_id=urn:uuid:${UUID}&_type=/vti/flow/hcp-connect/0.1`],
    ['a malformed percent-escape', `${BASE}${ok}`.replace('_id=', '_id=%E0%A4%A')],
  ])('refuses %s', (_name, link) => {
    expect(readHcpConnectLink(link)).toBeUndefined()
  })

  /**
   * The absolute `_type` form with its first `n` characters percent-encoded: the same link, read to the same parts,
   * two bytes longer per escape. Every well-formed link has an even length (166 or 194 bytes, plus two per escape),
   * so the longest one read is 250 bytes and the shortest refused for its length alone is 252.
   */
  const padded = (n: number) => {
    const type = 'https://link.trustoverip.org/vti/flow/hcp-connect/0.1'
    const escaped = [...type].map((c, i) => (i < n ? `%${c.charCodeAt(0).toString(16).toUpperCase()}` : c)).join('')
    return `${BASE}_from=${CLIENT}&_id=${UUID}&_type=${escaped}`
  }

  it('reads a link of 250 bytes', () => {
    expect(bytes(padded(28))).toBe(250)
    expect(readHcpConnectLink(padded(28))).toEqual({ clientVid: CLIENT, uuid: UUID, threadId: `urn:uuid:${UUID}` })
  })

  it('control: refuses the same link at 252 bytes, over the 251-byte limit', () => {
    expect(bytes(padded(29))).toBe(HCP_LINK_MAX_BYTES + 1)
    expect(readHcpConnectLink(padded(29))).toBeUndefined()
  })
})

describe('hcpConnectLink', () => {
  it('refuses to write a link the reader would refuse', () => {
    expect(() => hcpConnectLink({ clientVid: 'did:web:example.org', uuid: UUID })).toThrow()
    expect(() => hcpConnectLink({ clientVid: CLIENT, uuid: UUID.toUpperCase() })).toThrow()
  })
})
