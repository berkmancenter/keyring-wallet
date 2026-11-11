/**
 * "Confirm it's you", both phones, through the REAL Trust Task pipeline (TrustTasksService.consume: schema, identity
 * cross-check, recipient check, proof required). The signature is a stand-in that verifies only under the DID that
 * made it, over the document as it was signed (as in approverRole.test.ts), so what is tested is the protocol's own
 * decisions: what is refused unverified, what answer counts, what the owner must confirm, when a request lapses, and
 * what each switch turns off.
 */
import fs from 'fs'
import path from 'path'

import {
  CONFIRM_ASKS,
  CONFIRM_KEPT,
  CONFIRM_OPEN_AT_MOST,
  CONFIRM_OPEN_FOR,
  CONFIRM_PROMPT,
  answerConfirmRequest,
  cancelConfirmRequest,
  confirmAsksOn,
  confirmPromptStore,
  confirmStatusOf,
  handleConfirmRequest,
  handleConfirmResponse,
  namedLock,
  restoreConfirmPrompts,
  sendConfirmRequest,
} from '../../../src/modules/trust-tasks/confirmItsYou'
import { NOTE_MAX, TYPE_URI } from '../../../src/modules/trust-tasks/confirmItsYouSpec'
import { signDocumentProof } from '../../../src/modules/trust-tasks/documentProof'
import {
  CONFIRM_ITS_YOU_REMOTE_OFF,
  setConfirmItsYouEnabled,
} from '../../../src/modules/trust-tasks/module/confirmItsYouFlag'
import { SEDI_KERI_REMOTE_OFF } from '../../../src/modules/trust-tasks/module/sediKeriRemoteOff'
import { TrustTasksService } from '../../../src/modules/trust-tasks/services/TrustTasksService'
import { memoryGenericRecords } from '../vrc/fixtures/memoryGenericRecords'
import { readOneClock } from '../../helpers/oneClock'

const mockSent: { connectionId: string; document: Record<string, unknown> }[] = []
jest.mock('../../../src/modules/trust-tasks/ceremony', () => ({
  sendTrustTaskDocument: async (_agent: unknown, connectionId: string, document: Record<string, unknown>) => {
    mockSent.push({ connectionId, document })
  },
  getTrustTasksService: () => ({ retain: async () => undefined }),
}))

// A stand-in signature: names the DID that made it and the document it was made over.
jest.mock('../../../src/modules/trust-tasks/documentProof', () => {
  const over = (doc: Record<string, unknown>) => {
    const { proof: _proof, ...rest } = doc
    return JSON.stringify(rest)
  }
  return {
    signDocumentProof: async (_agent: unknown, doc: Record<string, unknown>, did: string) => ({
      ...doc,
      proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', by: did, over: over(doc) },
    }),
    verifyDocumentProof: async (_agent: unknown, doc: Record<string, unknown>, controller: string) => {
      const proof = doc.proof as { by?: string; over?: string } | undefined
      return proof?.by === controller && proof.over === over(doc)
    },
  }
})

jest.mock('../../../src/modules/vrc/utils/rcardDisplayUtils', () => ({
  resolveContactDisplayInfo: (_credentials: unknown, did: string) => ({
    name: ({ 'did:peer:jordan-rel': 'Jordan', 'did:peer:sam-rel': 'Sam' } as Record<string, string>)[did],
  }),
}))

interface Side {
  connectionId: string
  mine: string
  theirs: string
  myRel: string
  theirRel: string | null
}
const SAM: Side = {
  connectionId: 'c-sam',
  mine: 'did:conn:sam',
  theirs: 'did:conn:jordan',
  myRel: 'did:peer:sam-rel',
  theirRel: 'did:peer:jordan-rel',
}
const JORDAN: Side = {
  connectionId: 'c-jordan',
  mine: 'did:conn:jordan',
  theirs: 'did:conn:sam',
  myRel: 'did:peer:jordan-rel',
  theirRel: 'did:peer:sam-rel',
}

let random = 0
function phone(side: Side) {
  const store = memoryGenericRecords()
  const warned: string[] = []
  const agent = {
    context: {},
    config: { logger: { info: () => undefined, warn: (line: string) => warned.push(line) } },
    genericRecords: store,
    w3cCredentials: { getAll: async () => [] },
    kms: { randomBytes: ({ length }: { length: number }) => new Uint8Array(length).fill(++random) },
    dependencyManager: {
      resolve: () => ({
        getAll: async () =>
          side.theirRel
            ? [
                {
                  connectionId: side.connectionId,
                  myRelationshipDid: side.myRel,
                  counterpartyRelationshipDid: side.theirRel,
                },
              ]
            : [],
      }),
    },
    // No VTA, no agent link, no vtaAgent: the flow must need none of them.
    modules: {
      didcomm: { connections: { getById: async (id: string) => ({ id, did: side.mine, theirDid: side.theirs }) } },
    },
  } as any
  return { agent, store, side, warned }
}
type Phone = ReturnType<typeof phone>

let pipeline: TrustTasksService
const context = (to: Phone) => ({
  connectionId: to.side.connectionId,
  senderDid: to.side.theirs,
  recipientDid: to.side.mine,
})
const last = () => mockSent[mockSent.length - 1].document
async function deliver(to: Phone, document = last()) {
  const handle = String(document.type).includes('#response') ? handleConfirmResponse : handleConfirmRequest
  await handle(to.agent, pipeline, document, context(to))
}
const ok = jest.fn(async () => ({ ok: true }))
const NOTE = 'Is this you calling? Do you need me to send money?'
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A request built by hand and signed as Sam's phone signs, for payloads the sender would never make. */
async function craftedRequest(sam: Phone, payload: Record<string, unknown>) {
  const document = {
    id: 'crafted-1',
    type: TYPE_URI,
    threadId: 'crafted-1',
    issuer: SAM.mine,
    recipient: SAM.theirs,
    issuedAt: new Date().toISOString(),
    payload,
  }
  return signDocumentProof(sam.agent, document, SAM.myRel)
}
const CHALLENGE = 'c'.repeat(43)

beforeEach(() => {
  mockSent.length = 0
  confirmPromptStore.clear()
  CONFIRM_ITS_YOU_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
  setConfirmItsYouEnabled(true)
  ok.mockClear()
  pipeline = new TrustTasksService({ save: async () => undefined } as never)
})
afterAll(() => setConfirmItsYouEnabled(false))

readOneClock()

describe('the round trip', () => {
  test("Sam asks with a note, Jordan's phone shows it as written, Jordan says it's them with the lock, Sam's phone shows it", async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    expect(await sendConfirmRequest(sam.agent, SAM.connectionId, `  ${NOTE}  `)).toBe('sent')
    expect(last()).toMatchObject({ type: TYPE_URI, payload: { note: NOTE } })
    expect(confirmStatusOf((await confirmAsksOn(sam.agent, SAM.connectionId))[0])).toBe('waiting')

    await deliver(jordan)
    expect(confirmPromptStore.get(JORDAN.connectionId)).toMatchObject({ open: true, asker: 'Sam', note: NOTE })

    expect(await answerConfirmRequest(jordan.agent, JORDAN.connectionId, 'itsMe', ok, 'Tell Sam', 'faceId')).toBe(
      'sent'
    )
    expect(ok).toHaveBeenCalledWith('Tell Sam')
    expect(confirmPromptStore.get(JORDAN.connectionId)).toBeUndefined()
    const signedAt = (last().payload as { respondedAt: string }).respondedAt
    await deliver(sam)

    const [answered] = await confirmAsksOn(sam.agent, SAM.connectionId)
    expect(answered).toMatchObject({ state: 'itsMe', confirmedWith: 'faceId', respondedAt: signedAt })
    expect(confirmStatusOf(answered)).toBe('itsMe')
    // One record per contact on each phone, changed in place, never deleted.
    expect(sam.store.records.map((r) => r.tags.recordType)).toEqual([CONFIRM_ASKS])
    expect(jordan.store.records.map((r) => [r.tags.recordType, r.content.open, r.content.answered])).toEqual([
      [CONFIRM_PROMPT, false, 'itsMe'],
    ])
    expect(sam.store.deleteById).not.toHaveBeenCalled()
    expect(jordan.store.deleteById).not.toHaveBeenCalled()
  })

  test("a 'not me' goes back signed the same way and reads as not them (control: the row above reads itsMe)", async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    await sendConfirmRequest(sam.agent, SAM.connectionId, NOTE)
    await deliver(jordan)
    expect(await answerConfirmRequest(jordan.agent, JORDAN.connectionId, 'notMe', ok, 'Tell Sam')).toBe('sent')
    expect(last().proof).toMatchObject({ by: JORDAN.myRel })
    await deliver(sam)
    const [answered] = await confirmAsksOn(sam.agent, SAM.connectionId)
    expect(confirmStatusOf(answered)).toBe('notMe')
    expect(answered.confirmedWith).toBeUndefined()
  })

  test('nothing in the flow reaches for an agent or a VTA', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../../src/modules/trust-tasks/confirmItsYou.ts'), 'utf8')
    expect(source).not.toMatch(/vtaAgent|VtaClient|vtiAgent|trustedApprovers/)
  })
})

describe('the lock an answer names', () => {
  test('an unknown lock is never sent: the answer leaves the field out (control: Face ID is sent and read back)', async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    await sendConfirmRequest(sam.agent, SAM.connectionId, NOTE)
    await deliver(jordan)
    expect(await answerConfirmRequest(jordan.agent, JORDAN.connectionId, 'itsMe', ok, 'r', 'unknown')).toBe('sent')
    expect(last().payload).not.toHaveProperty('confirmedWith')
    await deliver(sam)
    expect((await confirmAsksOn(sam.agent, SAM.connectionId))[0].confirmedWith).toBeUndefined()

    const sam2 = phone(SAM)
    const jordan2 = phone(JORDAN)
    await sendConfirmRequest(sam2.agent, SAM.connectionId, NOTE)
    await deliver(jordan2)
    await answerConfirmRequest(jordan2.agent, JORDAN.connectionId, 'itsMe', ok, 'r', 'faceId')
    expect(last().payload).toMatchObject({ confirmedWith: 'faceId' })
    await deliver(sam2)
    expect((await confirmAsksOn(sam2.agent, SAM.connectionId))[0].confirmedWith).toBe('faceId')
  })

  test("namedLock names a lock only for a listed lock: absent, null, 'unknown' or anything else name none", () => {
    for (const none of [undefined, null, '', 'unknown', 'retina', 'FaceID']) expect(namedLock(none)).toBeUndefined()
    for (const lock of ['faceId', 'touchId', 'opticId', 'fingerprint', 'face', 'iris', 'screenLock'])
      expect(namedLock(lock)).toBe(lock)
  })
})

describe('nothing is read unverified', () => {
  test('a request changed after Sam signed it is dropped and logged (control: the same request untouched shows)', async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    await sendConfirmRequest(sam.agent, SAM.connectionId, NOTE)
    const signed = last()
    await deliver(jordan, { ...signed, payload: { ...(signed.payload as object), note: 'Send it now.' } })
    expect(confirmPromptStore.get(JORDAN.connectionId)).toBeUndefined()
    expect(jordan.warned.join('\n')).toMatch(/not taken: it did not pass its check/)

    await deliver(jordan, signed)
    expect(confirmPromptStore.get(JORDAN.connectionId)).toMatchObject({ note: NOTE })
  })

  test('a request checked against the wrong relationship DID is dropped (control: the right one shows)', async () => {
    const sam = phone(SAM)
    await sendConfirmRequest(sam.agent, SAM.connectionId, NOTE)
    const wrong = phone({ ...JORDAN, theirRel: 'did:peer:someone-else' })
    await deliver(wrong)
    expect(confirmPromptStore.get(JORDAN.connectionId)).toBeUndefined()
    expect(wrong.warned.join('\n')).toMatch(/did not pass its check/)

    await deliver(phone(JORDAN))
    expect(confirmPromptStore.get(JORDAN.connectionId)).toBeDefined()
  })

  test('with no relationship on the connection, a request is dropped unread, never accepted unverified', async () => {
    const sam = phone(SAM)
    await sendConfirmRequest(sam.agent, SAM.connectionId, NOTE)
    const stranger = phone({ ...JORDAN, theirRel: null })
    await deliver(stranger)
    expect(confirmPromptStore.get(JORDAN.connectionId)).toBeUndefined()
    expect(stranger.warned.join('\n')).toMatch(/no relationship with this contact/)
  })

  test("an answer carrying another challenge counts for nothing (control: the request's own challenge counts)", async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    await sendConfirmRequest(sam.agent, SAM.connectionId, NOTE)
    await deliver(jordan)
    const prompt = confirmPromptStore.get(JORDAN.connectionId)!
    const real = prompt.request
    confirmPromptStore.set({
      ...prompt,
      request: { ...real, payload: { ...(real.payload as object), challenge: 'z'.repeat(43) } },
    })
    await answerConfirmRequest(jordan.agent, JORDAN.connectionId, 'itsMe', ok, 'r')
    await deliver(sam)
    expect(confirmStatusOf((await confirmAsksOn(sam.agent, SAM.connectionId))[0])).toBe('waiting')
    expect(sam.warned.join('\n')).toMatch(/does not carry the request/)

    confirmPromptStore.set({ ...prompt, request: real })
    await answerConfirmRequest(jordan.agent, JORDAN.connectionId, 'itsMe', ok, 'r')
    await deliver(sam)
    expect(confirmStatusOf((await confirmAsksOn(sam.agent, SAM.connectionId))[0])).toBe('itsMe')
  })

  test('an answer to a request this phone never sent is dropped and logged', async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    await sendConfirmRequest(sam.agent, SAM.connectionId, NOTE)
    await deliver(jordan)
    await answerConfirmRequest(jordan.agent, JORDAN.connectionId, 'itsMe', ok, 'r')
    const elsewhere = phone(SAM)
    await deliver(elsewhere)
    expect(await confirmAsksOn(elsewhere.agent, SAM.connectionId)).toEqual([])
    expect(elsewhere.warned.join('\n')).toMatch(/answers no request this phone sent/)
  })
})

describe('the note', () => {
  test('an empty note, or one over the cap, is not sent (control: exactly the cap is)', async () => {
    const sam = phone(SAM)
    expect(await sendConfirmRequest(sam.agent, SAM.connectionId, '   ')).toBe('badNote')
    expect(await sendConfirmRequest(sam.agent, SAM.connectionId, 'x'.repeat(NOTE_MAX + 1))).toBe('badNote')
    expect(mockSent).toHaveLength(0)
    expect(await sendConfirmRequest(sam.agent, SAM.connectionId, 'x'.repeat(NOTE_MAX))).toBe('sent')
  })

  test('an arriving note over the cap, or a request with an extra field, is refused (control: at the cap it shows)', async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    const expiresAt = new Date(Date.now() + CONFIRM_OPEN_FOR).toISOString()
    await deliver(
      jordan,
      await craftedRequest(sam, { challenge: CHALLENGE, note: 'x'.repeat(NOTE_MAX + 1), expiresAt })
    )
    expect(confirmPromptStore.get(JORDAN.connectionId)).toBeUndefined()
    await deliver(jordan, await craftedRequest(sam, { challenge: CHALLENGE, note: NOTE, expiresAt, amount: '500' }))
    expect(confirmPromptStore.get(JORDAN.connectionId)).toBeUndefined()

    await deliver(jordan, await craftedRequest(sam, { challenge: CHALLENGE, note: 'x'.repeat(NOTE_MAX), expiresAt }))
    expect(confirmPromptStore.get(JORDAN.connectionId)).toBeDefined()
  })
})

describe("the owner's lock", () => {
  test.each(['itsMe', 'notMe'] as const)(
    '%s: a cancelled lock prompt sends nothing and the request stays (control: confirmed, it goes)',
    async (decision) => {
      const sam = phone(SAM)
      const jordan = phone(JORDAN)
      await sendConfirmRequest(sam.agent, SAM.connectionId, NOTE)
      await deliver(jordan)
      const sentBefore = mockSent.length
      const cancelled = jest.fn(async () => ({ ok: false, reason: 'cancelled' as const }))
      expect(await answerConfirmRequest(jordan.agent, JORDAN.connectionId, decision, cancelled, 'r')).toBe('cancelled')
      expect(cancelled).toHaveBeenCalledTimes(1)
      expect(mockSent).toHaveLength(sentBefore)
      expect(confirmPromptStore.get(JORDAN.connectionId)).toMatchObject({ open: true })

      expect(await answerConfirmRequest(jordan.agent, JORDAN.connectionId, decision, ok, 'r')).toBe('sent')
      expect(mockSent).toHaveLength(sentBefore + 1)
    }
  )

  test('a phone with no lock at all cannot answer, and says so', async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    await sendConfirmRequest(sam.agent, SAM.connectionId, NOTE)
    await deliver(jordan)
    const none = jest.fn(async () => ({ ok: false, reason: 'unavailable' as const }))
    expect(await answerConfirmRequest(jordan.agent, JORDAN.connectionId, 'notMe', none, 'r')).toBe('unavailable')
    expect(mockSent).toHaveLength(1)
  })
})

describe('time', () => {
  test('a request already past its time is not shown (control: one in time is)', async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    await sendConfirmRequest(sam.agent, SAM.connectionId, NOTE, 5)
    await sleep(20)
    await deliver(jordan)
    expect(confirmPromptStore.get(JORDAN.connectionId)).toBeUndefined()
    expect(jordan.warned.join('\n')).toMatch(/past its time/)

    await sendConfirmRequest(sam.agent, SAM.connectionId, NOTE)
    await deliver(jordan)
    expect(confirmPromptStore.get(JORDAN.connectionId)).toBeDefined()
  })

  test('a request asking to stay open longer than a request may is not shown (control: at most is)', async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    const tooLong = new Date(Date.now() + CONFIRM_OPEN_AT_MOST + 10 * 60 * 1000).toISOString()
    await deliver(jordan, await craftedRequest(sam, { challenge: CHALLENGE, note: NOTE, expiresAt: tooLong }))
    expect(confirmPromptStore.get(JORDAN.connectionId)).toBeUndefined()
    expect(jordan.warned.join('\n')).toMatch(/longer than a request may/)

    const atMost = new Date(Date.now() + CONFIRM_OPEN_AT_MOST).toISOString()
    await deliver(jordan, await craftedRequest(sam, { challenge: CHALLENGE, note: NOTE, expiresAt: atMost }))
    expect(confirmPromptStore.get(JORDAN.connectionId)).toBeDefined()
  })

  test('an answer that arrives after the request lapsed on the asking phone is dropped; it reads as no answer', async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    await sendConfirmRequest(sam.agent, SAM.connectionId, NOTE, 60)
    await deliver(jordan)
    await answerConfirmRequest(jordan.agent, JORDAN.connectionId, 'itsMe', ok, 'r')
    await sleep(80)
    await deliver(sam)
    expect(confirmStatusOf((await confirmAsksOn(sam.agent, SAM.connectionId))[0])).toBe('expired')
    expect(sam.warned.join('\n')).toMatch(/no longer waiting/)
  })

  test('by default a request is open for 15 minutes', async () => {
    const sam = phone(SAM)
    const before = Date.now()
    await sendConfirmRequest(sam.agent, SAM.connectionId, NOTE)
    const [ask] = await confirmAsksOn(sam.agent, SAM.connectionId)
    const open = Date.parse(ask.expiresAt) - before
    expect(CONFIRM_OPEN_FOR).toBe(15 * 60 * 1000)
    expect(open).toBeGreaterThan(CONFIRM_OPEN_FOR - 2000)
    expect(open).toBeLessThanOrEqual(CONFIRM_OPEN_FOR + 2000)
  })

  test('a request kept on the asked phone comes back after a restart while open; a lapsed one does not', async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    await sendConfirmRequest(sam.agent, SAM.connectionId, NOTE)
    await deliver(jordan)
    confirmPromptStore.clear()
    await restoreConfirmPrompts(jordan.agent)
    expect(confirmPromptStore.get(JORDAN.connectionId)).toMatchObject({ note: NOTE })

    const lapsed = phone(JORDAN)
    await sendConfirmRequest(sam.agent, SAM.connectionId, NOTE, 30)
    await deliver(lapsed)
    confirmPromptStore.clear()
    await sleep(50)
    await restoreConfirmPrompts(lapsed.agent)
    expect(confirmPromptStore.get(JORDAN.connectionId)).toBeUndefined()
  })
})

describe('cancel and ask again', () => {
  test('cancelling stops waiting here only, and a late answer is ignored and logged (control: not cancelled, it counts)', async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    await sendConfirmRequest(sam.agent, SAM.connectionId, NOTE)
    await deliver(jordan)
    const [ask] = await confirmAsksOn(sam.agent, SAM.connectionId)
    const sentBefore = mockSent.length
    expect(await cancelConfirmRequest(sam.agent, SAM.connectionId, ask.threadId)).toBe('cancelled')
    expect(mockSent).toHaveLength(sentBefore)
    expect(confirmStatusOf((await confirmAsksOn(sam.agent, SAM.connectionId))[0])).toBe('cancelled')
    await answerConfirmRequest(jordan.agent, JORDAN.connectionId, 'itsMe', ok, 'r')
    await deliver(sam)
    expect(confirmStatusOf((await confirmAsksOn(sam.agent, SAM.connectionId))[0])).toBe('cancelled')
    expect(sam.warned.join('\n')).toMatch(/no longer waiting/)
    expect(sam.store.deleteById).not.toHaveBeenCalled()
    // Only a waiting request can be cancelled.
    expect(await cancelConfirmRequest(sam.agent, SAM.connectionId, ask.threadId)).toBe('notWaiting')

    const other = phone(SAM)
    const jordan2 = phone(JORDAN)
    await sendConfirmRequest(other.agent, SAM.connectionId, NOTE)
    await deliver(jordan2)
    await answerConfirmRequest(jordan2.agent, JORDAN.connectionId, 'itsMe', ok, 'r')
    await deliver(other)
    expect(confirmStatusOf((await confirmAsksOn(other.agent, SAM.connectionId))[0])).toBe('itsMe')
  })

  test('asking again sends a new request with a new challenge; the last few are kept in one record, newest first', async () => {
    const sam = phone(SAM)
    for (let i = 0; i < CONFIRM_KEPT + 2; i++) await sendConfirmRequest(sam.agent, SAM.connectionId, `${NOTE} ${i}`)
    const asks = await confirmAsksOn(sam.agent, SAM.connectionId)
    expect(asks).toHaveLength(CONFIRM_KEPT)
    expect(asks[0].note).toBe(`${NOTE} ${CONFIRM_KEPT + 1}`)
    expect(new Set(asks.map((a) => a.challenge)).size).toBe(CONFIRM_KEPT)
    expect(new Set(mockSent.map((s) => s.document.threadId)).size).toBe(CONFIRM_KEPT + 2)
    expect(sam.store.records).toHaveLength(1)
    expect(sam.store.deleteById).not.toHaveBeenCalled()
  })
})

describe('the switches', () => {
  test.each([
    ['the switch off', () => setConfirmItsYouEnabled(false)],
    ['its remote off', () => (CONFIRM_ITS_YOU_REMOTE_OFF.off = true)],
    ['the SEDI/KERI umbrella off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
  ])('%s: nothing is sent, shown, brought back or answered (control: on, each works)', async (_name, switchOff) => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    // Control first, all on.
    expect(await sendConfirmRequest(sam.agent, SAM.connectionId, NOTE)).toBe('sent')
    await deliver(jordan)
    expect(confirmPromptStore.get(JORDAN.connectionId)).toBeDefined()

    switchOff()
    expect(await sendConfirmRequest(sam.agent, SAM.connectionId, NOTE)).toBe('off')
    expect(await answerConfirmRequest(jordan.agent, JORDAN.connectionId, 'itsMe', ok, 'r')).toBe('off')
    expect(ok).not.toHaveBeenCalled()

    const fresh = phone(JORDAN)
    confirmPromptStore.clear()
    await deliver(fresh, mockSent[0].document)
    expect(confirmPromptStore.get(JORDAN.connectionId)).toBeUndefined()
    expect(fresh.warned.join('\n')).toMatch(/switched off/)
    await restoreConfirmPrompts(jordan.agent)
    expect(confirmPromptStore.get(JORDAN.connectionId)).toBeUndefined()
  })
})
