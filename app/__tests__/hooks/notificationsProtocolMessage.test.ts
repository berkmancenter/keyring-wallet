/**
 * The home-screen notification cards (app/src/hooks/notifications.ts) leave
 * out protocol traffic carried as basic messages, using bifold's one shared
 * predicate. The wallet's own JSON-only copy let the relationship-DID
 * announcement through as a card.
 */
import { isProtocolMessage } from '@bifold/core'

describe('notification cards: what counts as protocol traffic', () => {
  it('the relationship-DID announcement a new contact sends', () => {
    expect(isProtocolMessage('This is my relationship DID: vrc:relationshipDid:did:peer:2.abc vrc:rceVersion:4')).toBe(
      true
    )
  })

  it('a JSON protocol message, as before', () => {
    expect(isProtocolMessage('{"@type":"https://didcomm.org/x"}')).toBe(true)
  })

  it('a message from a person', () => {
    expect(isProtocolMessage('See you at 6')).toBe(false)
  })
})
