/**
 * What a rooms log line may say (34VR-Y58H, 277.8, 11-03): a community or room by short id, and a session kept for
 * another identity by its kind alone. The hold's reason names a step, possibly a hidden-vetting persona's; beside a
 * community's DID that pairs the two, which vtiAgent `VtiSessionHeld` forbids.
 */
import { VtiRefusal } from '../../trust-tasks/module/vtiAgent'
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

  describe('a refusal, by its closed code', () => {
    const SAID = "did:key:persona-a may act as 2 personas holding room did:webvh:QmSecret, named 'Hidden'"

    test("a refusal says its code, and a VTA's reason where everything reads taskFailed", () => {
      expect(failureCategory(new VtiRefusal('permissionDenied', SAID))).toBe('refused (permissionDenied)')
      expect(failureCategory(new VtiRefusal('taskFailed', SAID, { reason: 'conflict' }))).toBe(
        'refused (taskFailed, conflict)'
      )
      expect(failureCategory(new VtiRefusal('taskFailed', SAID, { reason: 'not_found' }))).toBe(
        'refused (taskFailed, not_found)'
      )
    })

    test("a task's own code in details stands in for the framework's, without its task prefix", () => {
      expect(failureCategory(new VtiRefusal('taskFailed', SAID, { code: 'rooms/keys/browse:notMember' }))).toBe(
        'refused (notMember)'
      )
    })

    test('the framework codes are all known, none of them read as other', () => {
      for (const code of [
        'malformedRequest',
        'unsupportedType',
        'unsupportedVersion',
        'unsupportedExtension',
        'expired',
        'proofRequired',
        'proofInvalid',
        'permissionDenied',
        'wrongRecipient',
        'identityMismatch',
        'idConflict',
        'cancelled',
        'taskFailed',
        'unavailable',
        'internalError',
        'indeterminate',
      ]) {
        expect(failureCategory(new VtiRefusal(code, SAID))).toBe(`refused (${code})`)
      }
    })

    test.each([
      'hostRefused',
      'hostUnreachable',
      'cannotOpen',
      'notAttempted',
      'principalAmbiguous',
      'versionConflict',
    ])("a room task's own %s is known, the way a read's refusal carries it", (code) => {
      expect(failureCategory(new VtiRefusal(`rooms/keys/read:${code}`, SAID))).toBe(`refused (${code})`)
      expect(failureCategory(new VtiRefusal('taskFailed', SAID, { code: `rooms/keys/read:${code}` }))).toBe(
        `refused (${code})`
      )
    })

    test.each([
      ['free text as the code', () => new VtiRefusal(SAID, 'x')],
      ['a DID as the code', () => new VtiRefusal('did:key:persona-a', 'x')],
      ['free text in the details code', () => new VtiRefusal('taskFailed', 'x', { code: SAID })],
      ['a DID in the details code', () => new VtiRefusal('taskFailed', 'x', { code: 'did:key:persona-a' })],
      ['a word the list does not hold', () => new VtiRefusal('personaAIsHidden', 'x')],
      ['a word every object inherits', () => new VtiRefusal('constructor', 'x')],
      ['a code that is not a string', () => new VtiRefusal(7 as unknown as string, 'x')],
      ['an empty code', () => new VtiRefusal('', 'x')],
    ])('%s reads as other', (_what, make) => {
      expect(failureCategory(make())).toBe('refused (other)')
    })

    test.each([
      ['free text', SAID],
      ['a DID', 'did:key:persona-a'],
      ['a word the list does not hold', 'personaAIsHidden'],
      ['a word every object inherits', 'constructor'],
      ['not a string', 7],
    ])('%s as the reason is left out', (_what, reason) => {
      expect(failureCategory(new VtiRefusal('taskFailed', SAID, { reason }))).toBe('refused (taskFailed)')
    })

    test.each([
      ['no details', undefined],
      ['null details', null],
      ['details that are text', SAID],
    ])('%s: the code alone', (_what, details) => {
      expect(failureCategory(new VtiRefusal('taskFailed', SAID, details))).toBe('refused (taskFailed)')
    })

    test('a refusal the service passed on is closed the same way, its detail unread', () => {
      expect(failureCategory(new RoomsRefused('listNotes', 'notMember', false, SAID))).toBe('refused (notMember)')
      expect(failureCategory(new RoomsRefused('listNotes', 'welcomeMissing', false, SAID))).toBe(
        'refused (welcomeMissing)'
      )
      expect(failureCategory(new RoomsRefused('listNotes', SAID, false))).toBe('refused (other)')
      expect(failureCategory(new RoomsRefused('listNotes', 'did:key:persona-a', false))).toBe('refused (other)')
    })

    test('nothing a community wrote reaches the line, whatever carries it', () => {
      const carriers = [
        new VtiRefusal(SAID, SAID, { code: SAID, reason: SAID, message: SAID }),
        new VtiRefusal('taskFailed', SAID, { code: SAID, reason: SAID, extra: SAID }),
        new VtiRefusal('permissionDenied', SAID, { reason: 'conflict', extra: SAID }),
        new RoomsRefused('listNotes', SAID, false, SAID),
      ]
      for (const e of carriers) {
        const line = failureCategory(e)
        expect(line).toMatch(/^refused \([a-zA-Z]+(, [a-z_]+)?\)$/)
        expect(line).not.toMatch(/persona|Secret|Hidden|did:/)
      }
    })
  })
})
