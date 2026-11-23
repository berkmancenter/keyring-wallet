import { jcsCanonicalize } from '@bifold/vrc-contexts'

/**
 * JCS (RFC 8785) canonicalization — used for the VWC digest.
 * Expected values follow the RFC's rules: keys sorted by UTF-16 code units
 * at EVERY nesting level, ES `JSON.stringify` number/string serialization.
 */
describe('jcsCanonicalize (RFC 8785)', () => {
  test('sorts keys recursively, not just at the top level', () => {
    const input = {
      b: { z: 1, a: 2 },
      a: { nested: { y: true, x: false } },
    }

    expect(jcsCanonicalize(input)).toBe('{"a":{"nested":{"x":false,"y":true}},"b":{"a":2,"z":1}}')
  })

  test('produces identical output for identical data in different key order', () => {
    const a = { one: 1, two: { inner: [1, 2, { deep: 'v', also: 'w' }] }, three: null }
    const b = { three: null, two: { inner: [1, 2, { also: 'w', deep: 'v' }] }, one: 1 }

    expect(jcsCanonicalize(a)).toBe(jcsCanonicalize(b))
  })

  test('preserves array element order', () => {
    expect(jcsCanonicalize({ list: [3, 1, 2] })).toBe('{"list":[3,1,2]}')
  })

  test('serializes primitives like JSON.stringify', () => {
    expect(jcsCanonicalize('text')).toBe('"text"')
    expect(jcsCanonicalize(1e30)).toBe('1e+30')
    expect(jcsCanonicalize(0.000001)).toBe('0.000001')
    expect(jcsCanonicalize(true)).toBe('true')
    expect(jcsCanonicalize(null)).toBe('null')
  })

  test('drops undefined object members and nullifies undefined array elements', () => {
    expect(jcsCanonicalize({ a: 1, b: undefined })).toBe('{"a":1}')
    expect(jcsCanonicalize([1, undefined, 2])).toBe('[1,null,2]')
  })

  test('escapes strings per JSON rules', () => {
    expect(jcsCanonicalize({ euro: '\u20ac', newline: '\n' })).toBe('{"euro":"€","newline":"\\n"}')
  })

  test('throws on non-JSON values', () => {
    expect(() => jcsCanonicalize(undefined)).toThrow(TypeError)
    expect(() => jcsCanonicalize(() => 1)).toThrow(TypeError)
  })

  test('RFC 8785 sample: canonical form of a representative credential', () => {
    const vrc = {
      type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      credentialSubject: { id: 'did:peer:2.subject' },
      issuer: 'did:peer:2.issuer',
      issuanceDate: '2026-01-01T00:00:00Z',
      proof: {
        type: 'Ed25519Signature2018',
        created: '2026-01-01T00:00:00Z',
        jws: 'abc',
      },
    }

    expect(jcsCanonicalize(vrc)).toBe(
      '{"@context":["https://www.w3.org/2018/credentials/v1"],' +
        '"credentialSubject":{"id":"did:peer:2.subject"},' +
        '"issuanceDate":"2026-01-01T00:00:00Z",' +
        '"issuer":"did:peer:2.issuer",' +
        '"proof":{"created":"2026-01-01T00:00:00Z","jws":"abc","type":"Ed25519Signature2018"},' +
        '"type":["VerifiableCredential","DTGCredential","RelationshipCredential"]}'
    )
  })
})
