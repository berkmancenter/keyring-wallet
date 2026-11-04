/**
 * What a rooms log line may say (34VR-Y58H, 277.8, 11-03): a community or room by short id, and a session kept for
 * another identity by its kind alone. The hold's reason names a step, possibly a hidden-vetting persona's; beside a
 * community's DID that pairs the two, which vtiAgent `VtiSessionHeld` forbids.
 */
import { failureCategory, logRef } from '../roomsLogWords'
import { RoomsRefused, RoomsUnavailable } from '../types'

const held = Object.assign(
  new Error("vtiAgent: the session is kept for another of this phone's identities (signed in for a step just now)"),
  { name: 'VtiSessionHeld', heldAs: 'did:webvh:QmHidden:ids.example:step-persona' }
)

describe('rooms log words', () => {
  test('a DID by its short form, never whole; a short one as it is', () => {
    const long = 'did:webvh:QmcSLGfx8V7PJNheJJSXN6HxihM6NNLUXw8TWx8bBDbhz3:dids.oma.ic3.dev:vtc'
    expect(logRef(long)).toBe('did:webvh:QmcSLG….dev:vtc')
    expect(logRef('did:webvh:community:a')).toBe('did:webvh:community:a')
    expect(logRef(undefined)).toBe('none')
  })

  test('a kept session says only that it is kept: no reason, no identity', () => {
    expect(failureCategory(held)).toBe('the session is kept for another identity')
    expect(failureCategory(held)).not.toMatch(/step|Hidden/)
  })

  test('by kind only: unavailable, refused, unanswered, else its name or "failed"', () => {
    expect(failureCategory(new RoomsUnavailable('listNotes', 'communityUnreachable', 'did:webvh:x said no'))).toBe(
      'unavailable (communityUnreachable)'
    )
    expect(failureCategory(new RoomsRefused('listNotes', 'notMember', false, 'did:key:persona-a is not one'))).toBe(
      'refused (notMember)'
    )
    expect(failureCategory(Object.assign(new Error('sent x'), { name: 'VtiSentNoAnswer' }))).toBe('no answer yet')
    expect(failureCategory(new TypeError("did:key:persona-a's agent is gone"))).toBe('TypeError')
    expect(failureCategory(new Error("did:key:persona-a's agent is no longer linked"))).toBe('failed')
    expect(failureCategory('a string')).toBe('failed')
  })
})
