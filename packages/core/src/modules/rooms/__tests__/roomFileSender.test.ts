/**
 * Who shared a file, checked (`real/files/sender.ts`): the three checks upstream's reader makes on a record body
 * (vtc-client `rooms/body.rs` `verify_record_body`), each broken alone against a body that passes, so no refusal
 * passes for a reason other than the one it names.
 */
import { checkSender, type ReadAt } from '../real/files/sender'

import { resolverOf, signBody, testAuthor } from './fixtures/signedBody'

const ROOM = 'did:webvh:room:0123456789abcdef'
const ALICE = testAuthor('did:webvh:alice.example', 7)
const MALLORY = testAuthor('did:webvh:mallory.example', 9)

const unsigned = (over: Record<string, unknown> = {}) => ({
  roomId: ROOM,
  key: 'f1',
  version: 4,
  author: ALICE.did,
  file: { fileId: 'A'.repeat(43), name: 'minutes.pdf', size: 1234 },
  ...over,
})
const AT: ReadAt = { roomId: ROOM, key: 'f1', version: 4, hostAuthor: ALICE.did }
const { resolve } = resolverOf(ALICE, MALLORY)

describe('who shared a file, checked', () => {
  it('control: a body its author signed, read where it was signed, by the author the host recorded, is confirmed', async () => {
    expect(await checkSender(signBody(ALICE, unsigned()), AT, resolve)).toEqual({
      check: 'confirmed',
      kind: 'holds',
      signer: ALICE.did,
      why: 'the signature holds',
    })
  })

  describe('1: the signature holds for the author', () => {
    it('a body changed after it was signed is refused', async () => {
      const signed = signBody(ALICE, unsigned())
      const changed = { ...signed, file: { ...(signed.file as object), name: 'payroll.pdf' } }
      expect((await checkSender(changed, AT, resolve)).check).toBe('refused')
    })

    it('a body naming Alice but signed with another key under her method id is refused', async () => {
      const forged = signBody({ ...MALLORY, method: ALICE.method }, unsigned())
      expect((await checkSender(forged, AT, resolve)).check).toBe('refused')
    })

    it('a body naming Alice and signed by Mallory, under Mallory’s own key, is refused', async () => {
      const signed = signBody(MALLORY, unsigned())
      expect(await checkSender(signed, AT, resolve)).toMatchObject({
        check: 'refused',
        why: expect.stringMatching(/not by the author/),
      })
    })

    it('a key Alice lists only for authentication, not for assertion, is refused', async () => {
      const authOnly = testAuthor(ALICE.did, 7)
      authOnly.document = { ...authOnly.document, assertionMethod: [] }
      const r = await checkSender(signBody(ALICE, unsigned()), AT, resolverOf(authOnly).resolve)
      expect(r.check).toBe('refused')
    })

    it('a proof made for authentication is refused', async () => {
      const signed = signBody(ALICE, unsigned(), { proofPurpose: 'authentication' })
      expect((await checkSender(signed, AT, resolve)).check).toBe('refused')
    })
  })

  describe('2: it was signed for where it was read', () => {
    it('read at another version than it was sealed at: refused', async () => {
      expect((await checkSender(signBody(ALICE, unsigned()), { ...AT, version: 5 }, resolve)).check).toBe('refused')
    })

    it('read under another key: refused', async () => {
      expect((await checkSender(signBody(ALICE, unsigned()), { ...AT, key: 'f2' }, resolve)).check).toBe('refused')
    })

    it('read in another room: refused', async () => {
      const elsewhere = { ...AT, roomId: 'did:webvh:room:other' }
      expect((await checkSender(signBody(ALICE, unsigned()), elsewhere, resolve)).check).toBe('refused')
    })
  })

  describe('3: on an attributed room, the author is the one the host recorded', () => {
    it('the host recorded someone else: refused', async () => {
      const r = await checkSender(signBody(ALICE, unsigned()), { ...AT, hostAuthor: MALLORY.did }, resolve)
      expect(r).toMatchObject({ check: 'refused', why: expect.stringMatching(/host recorded/) })
    })

    it('a private room, where the host records no author: the signature alone decides', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { hostAuthor, ...privateRoom } = AT
      expect((await checkSender(signBody(ALICE, unsigned()), privateRoom, resolve)).check).toBe('confirmed')
    })
  })

  describe('refused outright, before any fetch', () => {
    it('no proof', async () => {
      const r = resolverOf(ALICE)
      expect((await checkSender(unsigned(), AT, r.resolve)).check).toBe('refused')
      expect(r.asked).toEqual([])
    })

    it('a suite a record body is never signed with', async () => {
      const signed = signBody(ALICE, unsigned(), { cryptosuite: 'bbs-2023' })
      expect((await checkSender(signed, AT, resolve)).check).toBe('refused')
    })
  })

  describe('unconfirmed: it could not be checked, and nothing is said about who shared it', () => {
    it('the author’s DID document could not be had', async () => {
      const r = await checkSender(signBody(ALICE, unsigned()), AT, resolverOf().resolve)
      expect(r).toMatchObject({ check: 'unconfirmed' })
      expect(r.signer).toBeUndefined()
    })

    it('this build fetches no DID documents', async () => {
      expect((await checkSender(signBody(ALICE, unsigned()), AT, undefined)).check).toBe('unconfirmed')
    })

    it('signed only with ecdsa-jcs-2019 (a hardware signer), which this client does not verify', async () => {
      const signed = signBody(ALICE, unsigned(), { cryptosuite: 'ecdsa-jcs-2019' })
      expect((await checkSender(signed, AT, resolve)).check).toBe('unconfirmed')
    })

    it('but a body that fails a check is refused even when the document can’t be had', async () => {
      const r = await checkSender(signBody(ALICE, unsigned()), { ...AT, version: 5 }, resolverOf().resolve)
      expect(r.check).toBe('refused')
    })
  })
})
