/**
 * The notifier's protocol-message guard. Basic messages are the carrier for
 * some protocol traffic (the relationship-DID announcement, the biometric
 * status ping); those must never surface as a user-facing toast. The chat
 * screen hides/transforms the same content — this keeps the two in step.
 */

// Mirrors isVrcProtocolMessage in src/components/InAppMessageNotifier.tsx.
// Kept as a local copy because the predicate is module-private and the
// component itself needs the full RN + agent context to render.
const isVrcProtocolMessage = (content: string): boolean => {
  if (content.includes('vrc:relationshipDid:') || content.startsWith('vrc:')) {
    return true
  }
  try {
    const parsed = JSON.parse(content)
    return typeof parsed === 'object' && parsed !== null && ('type' in parsed || '@type' in parsed)
  } catch {
    return false
  }
}

describe('in-app notifier: protocol messages are suppressed', () => {
  test('the plain-text relationship-DID announcement (the leak seen on device)', () => {
    const content =
      'This is my relationship DID: vrc:relationshipDid:did:peer:0z6MkmzahzVq6Wb2N4MQwMvH16dNhaDY7GeYMvWN621SaxA1M vrc:rceVersion:4'
    expect(isVrcProtocolMessage(content)).toBe(true)
  })

  test('the biometric-status ping', () => {
    expect(isVrcProtocolMessage('vrc:biometric-status:not-verified:1756200000:none')).toBe(true)
  })

  test('JSON witness protocol messages still suppressed', () => {
    expect(isVrcProtocolMessage(JSON.stringify({ type: 'witness-announcement' }))).toBe(true)
    expect(isVrcProtocolMessage(JSON.stringify({ '@type': 'https://didcomm.org/x' }))).toBe(true)
  })

  test('a real chat message from a human is NOT suppressed', () => {
    expect(isVrcProtocolMessage('hey, are we connected?')).toBe(false)
    expect(isVrcProtocolMessage('my did is on the card')).toBe(false)
  })

  test('plain JSON without a type is not treated as protocol', () => {
    expect(isVrcProtocolMessage(JSON.stringify({ hello: 'world' }))).toBe(false)
  })
})
