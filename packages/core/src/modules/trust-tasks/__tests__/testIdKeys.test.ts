/**
 * testID handles come from the whole DID: two phones on one mediator, or two
 * communities on one host, share a DID's tail and must not share a handle.
 */
import { communityCardKey } from '../screens/CommunityCard'
import { didHashKey, didLabelKey } from '../screens/testIdKey'
import { deviceKey } from '../screens/VtaDevices'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const SAFE = /^[A-Za-z0-9_-]+$/

// Two did:peer:2 keys on one mediator: different keys, the same encoded
// service block, so the same last 8 characters ("oiZG0ifQ").
const SERVICE =
  '.SeyJ0IjoiZG0iLCJzIjp7InVyaSI6Imh0dHBzOi8vbWVkaWF0b3IuZXhhbXBsZS5vcmciLCJhIjpbImRpZGNvbW0vdjIiXX0sInQiOiJkbSIsIiI6ImRtIiwidCI6ImRtIiwiIjoiZG0ifQ'
const PHONE_A = `did:peer:2.Ez6LSbysY2xFMRpGMhb7tFTLMpeuPRaqaWM1yECx2AtzE3KCc.Vz6MkqRYqQiSgvZQdnBytw86Qbs2ZWUkGv22od935YF4s8M7V${SERVICE}`
const PHONE_B = `did:peer:2.Ez6LSg8zQom395jKLrGiBNruENtEAmQ4U6Q7WBfTMr8D1qxp9.Vz6MkrgqJ1ZWhxvFvSZG7wZ8FJBc7sSn3FkJv2hQ3YhN6pYtE${SERVICE}`

// Communities on one host, told apart only before their tails.
const FARM_ALPHA = 'did:webvh:QmScidAlpha:farm.example.org:alpha:keyring-test-vtc'
const FARM_BETA = 'did:webvh:QmScidBeta:farm.example.org:beta:keyring-test-vtc'
const LAB_ONE = 'did:webvh:QmLabOne:4f2a-81-203-1-9.ngrok.app'
const LAB_TWO = 'did:webvh:QmLabTwo:9c1e-81-203-1-9.ngrok.app'
const SAME_PLACE_A = 'did:webvh:QmFirstScid:vtc.example.org'
const SAME_PLACE_B = 'did:webvh:QmOtherScid:vtc.example.org'

describe('device row handles', () => {
  test('two phones on one mediator (same DID tail) get different handles', () => {
    expect(PHONE_A.slice(-8)).toBe(PHONE_B.slice(-8))
    expect(deviceKey(PHONE_A)).not.toBe(deviceKey(PHONE_B))
  })

  test('a handle is stable for the same DID and testID-safe', () => {
    expect(deviceKey(PHONE_A)).toBe(deviceKey(`${PHONE_A}`))
    for (const did of [PHONE_A, PHONE_B, 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK']) {
      expect(deviceKey(did)).toMatch(SAFE)
    }
  })
})

describe('community card handles', () => {
  test.each([
    ['one host, different paths', FARM_ALPHA, FARM_BETA],
    ['two ngrok lab hosts', LAB_ONE, LAB_TWO],
    ['one host and path, different SCIDs', SAME_PLACE_A, SAME_PLACE_B],
  ])('%s get different handles', (_name, a, b) => {
    expect(a.slice(-8)).toBe(b.slice(-8))
    expect(communityCardKey(a)).not.toBe(communityCardKey(b))
  })

  test('a handle is stable, testID-safe, and starts with a readable label', () => {
    for (const did of [FARM_ALPHA, FARM_BETA, LAB_ONE, LAB_TWO, SAME_PLACE_A]) {
      expect(communityCardKey(did)).toBe(communityCardKey(`${did}`))
      expect(communityCardKey(did)).toMatch(SAFE)
    }
    expect(communityCardKey(FARM_ALPHA)).toBe(`keyring-test-vtc-${didHashKey(FARM_ALPHA)}`)
    expect(communityCardKey(SAME_PLACE_A)).toBe(`vtc-example-org-${didHashKey(SAME_PLACE_A)}`)
    expect(communityCardKey(LAB_ONE)).toBe(`4f2a-81-203-1-9-${didHashKey(LAB_ONE)}`)
  })

  test('with nothing readable after the last colon, the handle is the hash alone', () => {
    expect(communityCardKey('did:example:')).toBe(didHashKey('did:example:'))
  })
})

describe('the hash runners mirror', () => {
  // Pinned values (the published FNV-1a 32 vectors: "a" = 0xe40c292c, "foobar"
  // = 0xbf9cf968), so a runner's JS copy of the algorithm can be checked.
  test.each([
    ['', '0ztntfp'],
    ['a', '1r9wi7g'],
    ['foobar', '1h5yxyg'],
    ['did:webvh:QmCommunity:vtc.example.org', '0gfh0vg'],
  ])('FNV-1a 32, base 36, padded to 7: %j', (input, expected) => {
    expect(didHashKey(input)).toBe(expected)
  })

  test('the label is cut to 16 and trimmed of dashes', () => {
    expect(didLabelKey('did:webvh:Qm:abcdefghijklmno.pqrs')).toBe('abcdefghijklmno')
    expect(didLabelKey('did:webvh:Qm:..x..')).toBe('x')
  })
})
