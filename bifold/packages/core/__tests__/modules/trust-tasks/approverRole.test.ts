/**
 * Becoming someone's trusted approver, both phones, through the REAL Trust Task pipeline (TrustTasksService.consume:
 * schema, identity cross-check, recipient check, proof required). The signature is a stand-in that verifies only under
 * the DID that made it, over the document as it was signed, so what is tested is the protocol's own decisions: who is
 * asked, what is refused unverified, what answer counts, and what is kept for Sam to write on Sam's agent.
 */
import {
  OFFER_OPEN_FOR,
  ROLE_OFFER_ASK,
  acceptedRoleOffers,
  approverNames,
  approverRemoved,
  approverRoleEvents,
  approversWithAccepted,
  approvingFor,
  closeRoleOffer,
  isYesNotAdded,
  nextTrustedRules,
  setAsideRoleOffer,
  setAsideRoleOffers,
  roleOfferAskOn,
  withoutApprover,
  handleRoleOfferRequest,
  handleRoleOfferResponse,
  handleRoleStepDown,
  stepDownAsApprover,
  steppedDownApprovers,
  approversWaitedOn,
  offerApproverRole,
  respondToRoleOffer,
  restoreRoleOfferPrompts,
  roleOfferPromptStore,
} from '../../../src/modules/trust-tasks/approverRole'
import { ROLE_ACTIONS, STEP_DOWN_TYPE_URI, TYPE_URI } from '../../../src/modules/trust-tasks/approverRoleSpec'
import { TRUSTED_TASKS } from '../../../src/modules/trust-tasks/module/trustedApprovers'
import {
  TRUSTED_APPROVERS_REMOTE_OFF,
  setTrustedApproversEnabled,
} from '../../../src/modules/trust-tasks/module/trustedApproversFlag'
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

// Contact names as the relationship gives them (the stored-card lookup is not what is under test).
jest.mock('../../../src/modules/vrc/utils/rcardDisplayUtils', () => ({
  resolveContactDisplayInfo: (_credentials: unknown, did: string) => ({
    name: ({ 'did:peer:jordan-rel': 'Jordan', 'did:peer:sam-rel': 'Sam' } as Record<string, string>)[did],
  }),
}))

const SAM_AGENT = 'did:webvh:sams-agent.example'
const JORDAN_APPROVES_AS = 'did:peer:2.jordans-phone'

interface Side {
  name: string
  connectionId: string
  /** My connection DID, and theirs. */
  mine: string
  theirs: string
  /** My relationship DID with them, and theirs with me. */
  myRel: string
  theirRel?: string
}
const SAM: Side = {
  name: 'sam',
  connectionId: 'c-sam',
  mine: 'did:conn:sam',
  theirs: 'did:conn:jordan',
  myRel: 'did:peer:sam-rel',
  theirRel: 'did:peer:jordan-rel',
}
const JORDAN: Side = {
  name: 'jordan',
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
/** Deliver the last document sent to the other phone, as its dispatch would. */
async function deliver(to: Phone, document = mockSent[mockSent.length - 1].document) {
  const handle = String(document.type).includes('#response') ? handleRoleOfferResponse : handleRoleOfferRequest
  await handle(to.agent, pipeline, document, context(to))
}

beforeEach(() => {
  mockSent.length = 0
  roleOfferPromptStore.clear()
  TRUSTED_APPROVERS_REMOTE_OFF.off = false
  setTrustedApproversEnabled(true)
  pipeline = new TrustTasksService({ save: async () => undefined } as never)
})
afterAll(() => setTrustedApproversEnabled(false))

readOneClock()

describe('becoming a trusted approver', () => {
  test("Sam asks, Jordan's phone shows the offer, Jordan says yes, and Sam's phone keeps it to write", async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    const answered = jest.fn()
    approverRoleEvents.on('answered', answered)

    expect(await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity', 'shareCredential'])).toBe(
      'sent'
    )
    expect(mockSent[0].document).toMatchObject({ type: TYPE_URI, payload: { agent: SAM_AGENT } })
    await deliver(jordan)
    expect(roleOfferPromptStore.get(JORDAN.connectionId)).toMatchObject({
      agentDid: SAM_AGENT,
      actions: ['joinCommunity', 'shareCredential'],
    })

    await respondToRoleOffer(jordan.agent, JORDAN.connectionId, true, JORDAN_APPROVES_AS)
    expect(roleOfferPromptStore.get(JORDAN.connectionId)).toBeUndefined()
    await deliver(sam)

    const [kept] = await acceptedRoleOffers(sam.agent)
    expect(kept).toMatchObject({ agentDid: SAM_AGENT, acceptedAs: JORDAN_APPROVES_AS })
    expect(answered).toHaveBeenCalledWith({ connectionId: SAM.connectionId, decision: 'accepted' })
    expect(approversWithAccepted({ approvers: [], keys: [] }, kept)).toEqual({
      approvers: [JORDAN_APPROVES_AS],
      keys: ['shareCredential', 'joinCommunity'],
    })
    await closeRoleOffer(sam.agent, SAM.connectionId)
    expect(await acceptedRoleOffers(sam.agent)).toEqual([])
    // Nothing is deleted: one record per contact on each phone, its state changed in place.
    expect(sam.store.records.map((r) => [r.tags.recordType, r.content.state])).toEqual([[ROLE_OFFER_ASK, 'closed']])
    expect(jordan.store.records.map((r) => r.content.open)).toEqual([false])
    expect(sam.store.deleteById).not.toHaveBeenCalled()
    expect(jordan.store.deleteById).not.toHaveBeenCalled()
    approverRoleEvents.off('answered', answered)
  })

  test("a no is sent signed too, and closes the offer on Sam's phone", async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['addDevice'])
    await deliver(jordan)
    await respondToRoleOffer(jordan.agent, JORDAN.connectionId, false)
    expect(mockSent[1].document).toMatchObject({ payload: { decision: 'declined' }, proof: { by: JORDAN.myRel } })
    await deliver(sam)
    expect(sam.store.records.map((r) => r.content.state)).toEqual(['closed'])
    expect(await acceptedRoleOffers(sam.agent)).toEqual([])
  })

  test('an offer not signed by the relationship is never shown, and with no relationship nothing is read unverified', async () => {
    const sam = phone(SAM)
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity'])
    const genuine = mockSent[0].document
    const signedByStranger = { ...genuine, proof: { ...(genuine.proof as object), by: 'did:peer:stranger' } }
    const altered = { ...genuine, payload: { ...(genuine.payload as object), agent: 'did:webvh:someone-else' } }

    await deliver(phone(JORDAN), signedByStranger)
    await deliver(phone(JORDAN), altered)
    await deliver(phone({ ...JORDAN, theirRel: undefined }), genuine)
    expect(roleOfferPromptStore.list()).toEqual([])
    // Control: the genuine offer, on the relationship, is shown.
    await deliver(phone(JORDAN), genuine)
    expect(roleOfferPromptStore.list()).toHaveLength(1)
  })

  test("an answer counts only with this offer's challenge, signed by the relationship", async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity'])
    await deliver(jordan)
    await respondToRoleOffer(jordan.agent, JORDAN.connectionId, true, JORDAN_APPROVES_AS)
    const yes = mockSent[1].document
    const unsigned = { ...yes, proof: { ...(yes.proof as object), by: 'did:peer:stranger' } }
    const resign = async (doc: Record<string, unknown>) => {
      const { signDocumentProof } = jest.requireMock('../../../src/modules/trust-tasks/documentProof')
      const { proof: _p, ...rest } = doc
      return signDocumentProof(null, rest, JORDAN.myRel)
    }
    const otherChallenge = await resign({
      ...yes,
      payload: { ...(yes.payload as object), challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    })

    await deliver(sam, unsigned)
    await deliver(sam, otherChallenge)
    expect(await acceptedRoleOffers(sam.agent)).toEqual([])
    // Control: the real answer counts.
    await deliver(sam, yes)
    expect(await acceptedRoleOffers(sam.agent)).toHaveLength(1)
  })

  test('an answer on a thread Sam never offered counts for nothing, even one Jordan opened himself', async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    // Jordan "offers" Sam a role (Sam's phone stores it as a request it received), then sends a yes on that same
    // thread, with that offer's challenge, signed by his relationship key: everything but an offer Sam made.
    await offerApproverRole(jordan.agent, JORDAN.connectionId, 'did:webvh:jordans-agent', ['joinCommunity'])
    const planted = mockSent[0].document
    await deliver(sam, planted)
    const { signDocumentProof } = jest.requireMock('../../../src/modules/trust-tasks/documentProof')
    const forged = await signDocumentProof(
      null,
      {
        id: 'forged-yes',
        type: `${TYPE_URI}#response`,
        threadId: planted.id,
        issuer: JORDAN.mine,
        recipient: JORDAN.theirs,
        issuedAt: new Date().toISOString(),
        payload: {
          decision: 'accepted',
          challenge: (planted.payload as { challenge: string }).challenge,
          approver: JORDAN_APPROVES_AS,
          respondedAt: new Date().toISOString(),
        },
      },
      JORDAN.myRel
    )
    await deliver(sam, forged)
    expect(await acceptedRoleOffers(sam.agent)).toEqual([])
    // Control: the same forged shape on a thread Sam did offer, with its challenge, counts.
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity'])
    const real = mockSent[1].document
    const { proof: _p, ...unsigned } = forged
    await deliver(
      sam,
      await signDocumentProof(
        null,
        {
          ...unsigned,
          threadId: real.id,
          payload: { ...unsigned.payload, challenge: (real.payload as { challenge: string }).challenge },
        },
        JORDAN.myRel
      )
    )
    expect(await acceptedRoleOffers(sam.agent)).toHaveLength(1)
  })

  test("a yes on another thread counts for nothing, even with this offer's challenge", async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity'])
    await deliver(jordan)
    await respondToRoleOffer(jordan.agent, JORDAN.connectionId, true, JORDAN_APPROVES_AS)
    const { signDocumentProof } = jest.requireMock('../../../src/modules/trust-tasks/documentProof')
    const { proof: _p, ...yes } = mockSent[1].document
    await deliver(sam, await signDocumentProof(null, { ...yes, threadId: 'another-thread' }, JORDAN.myRel))
    expect(await acceptedRoleOffers(sam.agent)).toEqual([])
    // Control: the same yes on the offer's own thread counts.
    await deliver(sam, mockSent[1].document)
    expect(await acceptedRoleOffers(sam.agent)).toHaveLength(1)
  })

  test('an old yes sent again after the offer closed does not bring it back', async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity'])
    await deliver(jordan)
    await respondToRoleOffer(jordan.agent, JORDAN.connectionId, true, JORDAN_APPROVES_AS)
    const yes = mockSent[1].document
    await deliver(sam, yes)
    await closeRoleOffer(sam.agent, SAM.connectionId)
    await deliver(sam, yes)
    expect(await acceptedRoleOffers(sam.agent)).toEqual([])
  })

  test('a yes needs the DID the phone approves as, and nothing is sent without it', async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity'])
    await deliver(jordan)
    await expect(respondToRoleOffer(jordan.agent, JORDAN.connectionId, true)).rejects.toThrow(/DID/)
    await expect(respondToRoleOffer(jordan.agent, JORDAN.connectionId, true, 'jordan')).rejects.toThrow(/DID/)
    expect(mockSent).toHaveLength(1)
    expect(roleOfferPromptStore.get(JORDAN.connectionId)).toBeDefined()
  })

  test('an offer lapses: a late yes changes nothing', async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity'])
    await deliver(jordan)
    await respondToRoleOffer(jordan.agent, JORDAN.connectionId, true, JORDAN_APPROVES_AS)
    const ask = sam.store.records.find((r) => r.tags.recordType === ROLE_OFFER_ASK)!
    ask.content.askedAt = new Date(Date.now() - OFFER_OPEN_FOR - 1000).toISOString()
    await deliver(sam)
    expect(await acceptedRoleOffers(sam.agent)).toEqual([])
    // Control: the same yes inside the window counts.
    ask.content.askedAt = new Date().toISOString()
    await deliver(sam)
    expect(await acceptedRoleOffers(sam.agent)).toHaveLength(1)
  })

  test('with the switch off, nothing is offered, shown or kept; a release can turn it off whatever was saved', async () => {
    const sam = phone(SAM)
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity'])
    const offer = mockSent[0].document

    setTrustedApproversEnabled(false)
    expect(await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity'])).toBe('off')
    await deliver(phone(JORDAN), offer)
    setTrustedApproversEnabled(true)
    TRUSTED_APPROVERS_REMOTE_OFF.off = true
    await deliver(phone(JORDAN), offer)
    expect(mockSent).toHaveLength(1)
    expect(roleOfferPromptStore.list()).toEqual([])
    // Control: on, and not turned off remotely, the same offer is shown.
    TRUSTED_APPROVERS_REMOTE_OFF.off = false
    await deliver(phone(JORDAN), offer)
    expect(roleOfferPromptStore.list()).toHaveLength(1)
  })

  test('an offer that goes no further says why in the log, naming the connection, never the contents (control: one shown says nothing of the kind)', async () => {
    // Alberto's two phones, 278.12, 11-10: the offer reached the receiving phone (report F928-36ZG, 23:16:34.951Z) and
    // then nothing at all was logged, because its switch was off.
    const sam = phone(SAM)
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity'])
    const offer = mockSent[0].document
    const notTaken = (p: Phone) => p.warned.filter((line) => line.includes('not taken'))

    setTrustedApproversEnabled(false)
    const off = phone(JORDAN)
    await deliver(off, offer)
    setTrustedApproversEnabled(true)
    expect(notTaken(off)).toEqual([expect.stringMatching(/approver offer on connection .+ not taken: .*switched off/)])
    expect(notTaken(off)[0]).toContain(JORDAN.connectionId)

    const noRelationship = phone({ ...JORDAN, theirRel: undefined })
    await deliver(noRelationship, offer)
    expect(notTaken(noRelationship)).toEqual([expect.stringMatching(/no relationship/)])

    const forged = phone(JORDAN)
    await deliver(forged, { ...offer, proof: { ...(offer.proof as object), by: 'did:peer:stranger' } })
    expect(notTaken(forged)).toEqual([expect.stringMatching(/did not pass its check/)])
    // Never the contents: no action, agent or challenge in any line. The challenge is checked by its value, so a leak
    // is caught however it is written, not only one that spells out the word.
    const { challenge, agent: askedAgent } = offer.payload as { challenge: string; agent: string }
    expect(challenge.length).toBeGreaterThan(8)
    for (const line of [...notTaken(off), ...notTaken(noRelationship), ...notTaken(forged)]) {
      expect(line).not.toContain(challenge)
      expect(line).not.toContain(askedAgent)
      expect(line).not.toMatch(/joinCommunity/)
    }

    const shown = phone(JORDAN)
    await deliver(shown, offer)
    expect(roleOfferPromptStore.list()).toHaveLength(1)
    expect(notTaken(shown)).toEqual([])
  })

  test("an offer waits across a restart on Jordan's phone", async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity'])
    await deliver(jordan)
    roleOfferPromptStore.clear()
    await restoreRoleOfferPrompts(jordan.agent)
    expect(roleOfferPromptStore.get(JORDAN.connectionId)).toMatchObject({ agentDid: SAM_AGENT })
  })

  test('the actions an offer can name are exactly the ones a trusted approver rule holds', () => {
    expect([...ROLE_ACTIONS]).toEqual(TRUSTED_TASKS.map((t) => t.key))
  })

  test('a new offer replaces the earlier one on the same contact: a yes to the earlier one counts for nothing', async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity'])
    await deliver(jordan)
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['addDevice'])
    expect(sam.store.records.filter((r) => r.tags.recordType === ROLE_OFFER_ASK)).toHaveLength(1)
    await respondToRoleOffer(jordan.agent, JORDAN.connectionId, true, JORDAN_APPROVES_AS)
    await deliver(sam)
    expect(await acceptedRoleOffers(sam.agent)).toEqual([])
    // Control: the yes to the current offer counts.
    await deliver(jordan, mockSent[1].document)
    await respondToRoleOffer(jordan.agent, JORDAN.connectionId, true, JORDAN_APPROVES_AS)
    await deliver(sam)
    expect(await acceptedRoleOffers(sam.agent)).toEqual([expect.objectContaining({ actions: ['addDevice'] })])
  })
})

describe('what the screens read', () => {
  /** Sam asks for `actions`, Jordan answers, and the answer reaches Sam. */
  async function asked(actions: Parameters<typeof offerApproverRole>[3], accept: boolean) {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, actions)
    await deliver(jordan)
    await respondToRoleOffer(jordan.agent, JORDAN.connectionId, accept, accept ? JORDAN_APPROVES_AS : undefined)
    await deliver(sam)
    return { sam, jordan }
  }

  test("the contact's row reads where the offer stands: open, then said yes, then written, then removed", async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    expect(await roleOfferAskOn(sam.agent, SAM.connectionId)).toBeUndefined()
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity'])
    expect(await roleOfferAskOn(sam.agent, SAM.connectionId)).toMatchObject({ state: 'open' })
    await deliver(jordan)
    await respondToRoleOffer(jordan.agent, JORDAN.connectionId, true, JORDAN_APPROVES_AS)
    await deliver(sam)
    expect(await roleOfferAskOn(sam.agent, SAM.connectionId)).toMatchObject({ state: 'accepted' })

    await closeRoleOffer(sam.agent, SAM.connectionId, true)
    expect(await roleOfferAskOn(sam.agent, SAM.connectionId)).toMatchObject({ state: 'closed', written: true })
    await approverRemoved(sam.agent, 'did:peer:2.someone-else')
    expect(await roleOfferAskOn(sam.agent, SAM.connectionId)).toMatchObject({ written: true })
    await approverRemoved(sam.agent, JORDAN_APPROVES_AS)
    expect(await roleOfferAskOn(sam.agent, SAM.connectionId)).toMatchObject({ state: 'closed', written: false })
    expect(sam.store.deleteById).not.toHaveBeenCalled()
  })

  test('an open offer past its time reads as closed, so it can be asked again (control: one inside its time is open)', async () => {
    const sam = phone(SAM)
    const now = Date.now()
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now)
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity'])
    const [record] = sam.store.records
    record.content.askedAt = new Date(now - OFFER_OPEN_FOR + 60_000).toISOString()
    expect(await roleOfferAskOn(sam.agent, SAM.connectionId)).toMatchObject({ state: 'open' })
    record.content.askedAt = new Date(now - OFFER_OPEN_FOR - 60_000).toISOString()
    expect(await roleOfferAskOn(sam.agent, SAM.connectionId)).toMatchObject({ state: 'closed' })
    clock.mockRestore()
  })

  test('adding a yes leaves out an action another rule holds; removing the last approver holds nothing', () => {
    const view = {
      approvers: ['did:peer:2.amy'],
      keys: ['shareCredential' as const],
      heldElsewhere: ['addDevice' as const],
    }
    const ask = { acceptedAs: JORDAN_APPROVES_AS, actions: ['addDevice' as const, 'joinCommunity' as const] }
    expect(nextTrustedRules(view, ask)).toEqual({
      approvers: ['did:peer:2.amy', JORDAN_APPROVES_AS],
      keys: ['shareCredential', 'joinCommunity'],
    })
    // Control: with nothing held elsewhere, the offered action is kept.
    expect(nextTrustedRules({ ...view, heldElsewhere: [] }, ask).keys).toEqual([
      'shareCredential',
      'joinCommunity',
      'addDevice',
    ])
    const two = { approvers: ['did:peer:2.amy', JORDAN_APPROVES_AS], keys: ['shareCredential' as const] }
    expect(withoutApprover(two, JORDAN_APPROVES_AS)).toEqual({
      approvers: ['did:peer:2.amy'],
      keys: ['shareCredential'],
    })
    expect(withoutApprover({ approvers: [JORDAN_APPROVES_AS], keys: ['shareCredential'] }, JORDAN_APPROVES_AS)).toEqual(
      {
        approvers: [],
        keys: [],
      }
    )
  })

  test('an approver is named from the relationship the offer went over; a no names nobody', async () => {
    const yes = await asked(['joinCommunity'], true)
    expect(await approverNames(yes.sam.agent)).toEqual({ [JORDAN_APPROVES_AS]: 'Jordan' })
    const no = await asked(['joinCommunity'], false)
    expect(await approverNames(no.sam.agent)).toEqual({})
  })

  test("People I approve for: the yeses Jordan's phone sent, not the noes", async () => {
    const yes = await asked(['joinCommunity'], true)
    expect(await approvingFor(yes.jordan.agent)).toEqual([
      expect.objectContaining({ asker: 'Sam', answered: 'accepted', answeredAs: JORDAN_APPROVES_AS, open: false }),
    ])
    const no = await asked(['joinCommunity'], false)
    expect(await approvingFor(no.jordan.agent)).toEqual([])
  })

  test('the offer sheet hears an offer brought back at start, and hears it answered', async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    const offer = jest.fn()
    const cleared = jest.fn()
    approverRoleEvents.on('offer', offer)
    approverRoleEvents.on('promptCleared', cleared)
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity'])
    await deliver(jordan)
    roleOfferPromptStore.clear()
    offer.mockClear()
    await restoreRoleOfferPrompts(jordan.agent)
    expect(offer).toHaveBeenCalledWith({ connectionId: JORDAN.connectionId })
    await respondToRoleOffer(jordan.agent, JORDAN.connectionId, false)
    expect(cleared).toHaveBeenCalledWith({ connectionId: JORDAN.connectionId })
    approverRoleEvents.off('offer', offer)
    approverRoleEvents.off('promptCleared', cleared)
  })
})

describe('"Not now" sets a yes aside (Alberto, 278.19: the request must be viewable again)', () => {
  /** Sam asks, Jordan says yes, Sam's phone holds the yes, not yet added. */
  async function saidYes() {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity', 'changeApprovers'])
    await deliver(jordan)
    await respondToRoleOffer(jordan.agent, JORDAN.connectionId, true, JORDAN_APPROVES_AS)
    await deliver(sam)
    mockSent.length = 0
    return { sam, jordan }
  }

  test('set aside: kept with its yes, no longer waiting, listed as set aside; nothing is sent or deleted', async () => {
    const { sam } = await saidYes()
    const asked = jest.fn()
    approverRoleEvents.on('asked', asked)
    expect(await setAsideRoleOffer(sam.agent, SAM.connectionId)).toBe('setAside')
    approverRoleEvents.off('asked', asked)
    expect(await acceptedRoleOffers(sam.agent)).toEqual([])
    const [aside] = await setAsideRoleOffers(sam.agent)
    expect(aside).toMatchObject({
      state: 'setAside',
      acceptedAs: JORDAN_APPROVES_AS,
      actions: ['joinCommunity', 'changeApprovers'],
    })
    expect(isYesNotAdded(aside)).toBe(true)
    expect(asked).toHaveBeenCalledWith({ connectionId: SAM.connectionId })
    expect(mockSent).toHaveLength(0)
    expect(sam.store.deleteById).not.toHaveBeenCalled()
  })

  test('only a yes waiting to be added can be set aside: an open offer, a closed one, or none is left as it was', async () => {
    const sam = phone(SAM)
    expect(await setAsideRoleOffer(sam.agent, SAM.connectionId)).toBe('notAccepted')
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity'])
    expect(await setAsideRoleOffer(sam.agent, SAM.connectionId)).toBe('notAccepted')
    expect((await roleOfferAskOn(sam.agent, SAM.connectionId))?.state).toBe('open')
    const { sam: other } = await saidYes()
    await closeRoleOffer(other.agent, SAM.connectionId)
    expect(await setAsideRoleOffer(other.agent, SAM.connectionId)).toBe('notAccepted')
    expect((await roleOfferAskOn(other.agent, SAM.connectionId))?.state).toBe('closed')
  })

  test('Add from set aside writes it as an add from waiting does (control: the same yes, not set aside)', async () => {
    const { sam } = await saidYes()
    await setAsideRoleOffer(sam.agent, SAM.connectionId)
    const [aside] = await setAsideRoleOffers(sam.agent)
    expect(approversWithAccepted({ approvers: [], keys: [] }, aside)).toEqual({
      approvers: [JORDAN_APPROVES_AS],
      keys: ['joinCommunity', 'changeApprovers'],
    })
    await closeRoleOffer(sam.agent, SAM.connectionId, true)
    expect(await roleOfferAskOn(sam.agent, SAM.connectionId)).toMatchObject({
      state: 'closed',
      written: true,
      writtenAs: JORDAN_APPROVES_AS,
    })
    expect(await setAsideRoleOffers(sam.agent)).toEqual([])
  })

  test('Forget closes it, not written: in neither list, and an earlier written arrangement stays', async () => {
    const { sam } = await saidYes()
    await setAsideRoleOffer(sam.agent, SAM.connectionId)
    await closeRoleOffer(sam.agent, SAM.connectionId, false)
    expect(await setAsideRoleOffers(sam.agent)).toEqual([])
    expect(await acceptedRoleOffers(sam.agent)).toEqual([])
    expect(await roleOfferAskOn(sam.agent, SAM.connectionId)).toMatchObject({ state: 'closed', written: false })
  })

  test('the contact steps down while it is set aside: it is taken back (closed), no longer addable', async () => {
    const { sam, jordan } = await saidYes()
    await setAsideRoleOffer(sam.agent, SAM.connectionId)
    await stepDownAsApprover(jordan.agent, JORDAN.connectionId)
    await handleRoleStepDown(sam.agent, pipeline, mockSent[mockSent.length - 1].document, context(sam))
    expect(await roleOfferAskOn(sam.agent, SAM.connectionId)).toMatchObject({
      state: 'closed',
      steppedDown: expect.any(String),
    })
    expect(await setAsideRoleOffers(sam.agent)).toEqual([])
  })

  test('an offer an earlier build closed with "Not now" stays closed: it is not revived as set aside', async () => {
    const { sam } = await saidYes()
    // What "Not now" did before this change.
    await closeRoleOffer(sam.agent, SAM.connectionId, false)
    expect(await setAsideRoleOffers(sam.agent)).toEqual([])
    expect(isYesNotAdded(await roleOfferAskOn(sam.agent, SAM.connectionId))).toBe(false)
  })
})

describe('stepping down', () => {
  /** Sam asks, Jordan says yes, Sam's phone has the yes; `written` as if Sam then added Jordan on Who approves. */
  async function approving(
    written: boolean,
    actions: ('joinCommunity' | 'shareCredential' | 'changeApprovers')[] = ['joinCommunity', 'changeApprovers']
  ) {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, actions)
    await deliver(jordan)
    await respondToRoleOffer(jordan.agent, JORDAN.connectionId, true, JORDAN_APPROVES_AS)
    await deliver(sam)
    if (written) await closeRoleOffer(sam.agent, SAM.connectionId, true)
    mockSent.length = 0
    return { sam, jordan }
  }
  const stepDownTo = (to: Phone, document = mockSent[mockSent.length - 1].document) =>
    handleRoleStepDown(to.agent, pipeline, document, context(to))
  const askOnSam = async (sam: Phone) => roleOfferAskOn(sam.agent, SAM.connectionId)

  test("Jordan steps down: signed under Jordan's relationship DID, Jordan's phone stops approving for Sam, and nothing is deleted", async () => {
    const { jordan } = await approving(true)
    expect(await approvingFor(jordan.agent)).toHaveLength(1)
    expect(await stepDownAsApprover(jordan.agent, JORDAN.connectionId)).toBe('sent')
    expect(mockSent).toHaveLength(1)
    expect(mockSent[0].document).toMatchObject({
      type: STEP_DOWN_TYPE_URI,
      payload: { agent: SAM_AGENT, approver: JORDAN_APPROVES_AS },
      proof: { by: JORDAN.myRel },
    })
    expect(await approvingFor(jordan.agent)).toEqual([])
    expect(jordan.store.deleteById).not.toHaveBeenCalled()
  })

  test("Sam's phone, on a verified step-down, marks the written yes: still written (the agent holds it) until removed", async () => {
    const { sam, jordan } = await approving(true)
    await stepDownAsApprover(jordan.agent, JORDAN.connectionId)
    await stepDownTo(sam)
    expect(await askOnSam(sam)).toMatchObject({ written: true, steppedDown: expect.any(String) })
    expect(await steppedDownApprovers(sam.agent)).toEqual([JORDAN_APPROVES_AS])
    // Once removed from the agent, it no longer asks to be removed.
    await approverRemoved(sam.agent, JORDAN_APPROVES_AS)
    expect(await steppedDownApprovers(sam.agent)).toEqual([])
    expect(sam.store.deleteById).not.toHaveBeenCalled()
  })

  test('a yes not yet written is simply taken back: it no longer waits to be added', async () => {
    const { sam, jordan } = await approving(false)
    expect(await acceptedRoleOffers(sam.agent)).toHaveLength(1)
    await stepDownAsApprover(jordan.agent, JORDAN.connectionId)
    await stepDownTo(sam)
    expect(await acceptedRoleOffers(sam.agent)).toEqual([])
    expect(await askOnSam(sam)).toMatchObject({ state: 'closed', steppedDown: expect.any(String) })
    expect(await steppedDownApprovers(sam.agent)).toEqual([])
  })

  test("a step-down not signed under Jordan's relationship DID changes nothing (control: the real one above does)", async () => {
    const { sam, jordan } = await approving(true)
    await stepDownAsApprover(jordan.agent, JORDAN.connectionId)
    const forged = {
      ...mockSent[0].document,
      proof: { ...(mockSent[0].document.proof as object), by: 'did:peer:someone-else' },
    }
    await stepDownTo(sam, forged)
    expect((await askOnSam(sam))?.steppedDown).toBeUndefined()
  })

  test('a step-down naming another approver DID, or another agent, changes nothing (control: the same re-signing, unaltered, counts)', async () => {
    const cases: [Record<string, string>, boolean][] = [
      [{}, true],
      [{ approver: 'did:peer:2.someone-else' }, false],
      [{ agent: 'did:webvh:another-agent.example' }, false],
    ]
    for (const [payload, counts] of cases) {
      const { sam, jordan } = await approving(true)
      await stepDownAsApprover(jordan.agent, JORDAN.connectionId)
      const signed = mockSent[0].document
      // Re-signed by Jordan over the altered payload, so only the payload check can refuse it.
      const altered: Record<string, unknown> = { ...signed, payload: { ...(signed.payload as object), ...payload } }
      const { proof: _p, ...unsigned } = altered
      const resigned = {
        ...unsigned,
        proof: {
          type: 'DataIntegrityProof',
          cryptosuite: 'eddsa-jcs-2022',
          by: JORDAN.myRel,
          over: JSON.stringify(unsigned),
        },
      }
      await stepDownTo(sam, resigned)
      expect(Boolean((await askOnSam(sam))?.steppedDown)).toBe(counts)
    }
  })

  // Re-signed by Jordan over an altered payload, so only the payload check can refuse it.
  const resign = (signed: Record<string, unknown>, payload: Record<string, string>) => {
    const altered: Record<string, unknown> = { ...signed, payload: { ...(signed.payload as object), ...payload } }
    const { proof: _p, ...unsigned } = altered
    return {
      ...unsigned,
      proof: {
        type: 'DataIntegrityProof',
        cryptosuite: 'eddsa-jcs-2022',
        by: JORDAN.myRel,
        over: JSON.stringify(unsigned),
      },
    }
  }

  test("Change, then Jordan steps down: the written approver is marked stepped down, the re-offer closes, and Who approves asks to remove them (review lane's sequence)", async () => {
    const { sam, jordan } = await approving(true)
    // Jordan steps down from the arrangement in force, which Sam's re-offer has not reached yet.
    await stepDownAsApprover(jordan.agent, JORDAN.connectionId)
    const stepDown = mockSent[0].document
    // Sam taps "Change what Jordan approves": a new open offer, which must not overwrite who is written on the agent.
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity'])
    expect(await askOnSam(sam)).toMatchObject({ state: 'open', written: true, writtenAs: JORDAN_APPROVES_AS })
    expect((await askOnSam(sam))?.acceptedAs).toBeUndefined()
    expect(await approverNames(sam.agent)).toEqual({ [JORDAN_APPROVES_AS]: 'Jordan' })

    await stepDownTo(sam, stepDown)
    expect(await askOnSam(sam)).toMatchObject({ state: 'closed', written: true, steppedDown: expect.any(String) })
    expect(await steppedDownApprovers(sam.agent)).toEqual([JORDAN_APPROVES_AS])
    expect(sam.store.deleteById).not.toHaveBeenCalled()
  })

  test('during a re-offer, a step-down naming a DID that is neither written nor accepted changes nothing (control: the row above)', async () => {
    const { sam, jordan } = await approving(true)
    await stepDownAsApprover(jordan.agent, JORDAN.connectionId)
    const stepDown = mockSent[0].document
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity'])
    await stepDownTo(sam, resign(stepDown, { approver: 'did:peer:2.someone-else' }))
    expect(await askOnSam(sam)).toMatchObject({ state: 'open' })
    expect((await askOnSam(sam))?.steppedDown).toBeUndefined()
    expect(await steppedDownApprovers(sam.agent)).toEqual([])
  })

  test('a first offer still open counts no step-down: nothing is written for that contact (the in-flight crossing)', async () => {
    const sam = phone(SAM)
    const { jordan } = await approving(true)
    await stepDownAsApprover(jordan.agent, JORDAN.connectionId)
    const stepDown = mockSent[0].document
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity'])
    await stepDownTo(sam, stepDown)
    expect(await askOnSam(sam)).toMatchObject({ state: 'open' })
    expect((await askOnSam(sam))?.steppedDown).toBeUndefined()
  })

  test("an answer to an offer that is no longer open is dropped, and says so in the log (Jordan steps down, then accepts Sam's re-offer)", async () => {
    const { sam, jordan } = await approving(true)
    await stepDownAsApprover(jordan.agent, JORDAN.connectionId)
    const stepDown = mockSent[0].document
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity'])
    const reOffer = mockSent[mockSent.length - 1].document
    await stepDownTo(sam, stepDown)
    await deliver(jordan, reOffer)
    await respondToRoleOffer(jordan.agent, JORDAN.connectionId, true, JORDAN_APPROVES_AS)
    await deliver(sam)
    // Sam's record keeps the step-down: safe-direction (less protection than Jordan believes, never more).
    expect(await askOnSam(sam)).toMatchObject({ state: 'closed', steppedDown: expect.any(String) })
    expect(sam.warned.filter((line) => line.includes('no longer open'))).toHaveLength(1)
  })

  test('with the switch off, nothing is sent and an arriving step-down changes nothing', async () => {
    const { sam, jordan } = await approving(true)
    setTrustedApproversEnabled(false)
    expect(await stepDownAsApprover(jordan.agent, JORDAN.connectionId)).toBe('off')
    expect(mockSent).toHaveLength(0)
    setTrustedApproversEnabled(true)
    await stepDownAsApprover(jordan.agent, JORDAN.connectionId)
    setTrustedApproversEnabled(false)
    await stepDownTo(sam)
    setTrustedApproversEnabled(true)
    expect((await askOnSam(sam))?.steppedDown).toBeUndefined()
  })

  test('a phone that never said yes, or already stepped down, sends nothing', async () => {
    const jordan = phone(JORDAN)
    expect(await stepDownAsApprover(jordan.agent, JORDAN.connectionId)).toBe('notApproving')
    const both = await approving(true)
    await stepDownAsApprover(both.jordan.agent, JORDAN.connectionId)
    mockSent.length = 0
    expect(await stepDownAsApprover(both.jordan.agent, JORDAN.connectionId)).toBe('notApproving')
    expect(mockSent).toHaveLength(0)
  })
})

describe('who a held task waits on', () => {
  const MINT = TRUSTED_TASKS.find((t) => t.key === 'joinCommunity')!.taskTypes[1]
  const SHARE = TRUSTED_TASKS.find((t) => t.key === 'shareCredential')!.taskTypes[0]

  test('a task an approver Sam wrote covers names them (control: an action not offered, or not yet written, names nobody)', async () => {
    const sam = phone(SAM)
    const jordan = phone(JORDAN)
    await offerApproverRole(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity'])
    await deliver(jordan)
    await respondToRoleOffer(jordan.agent, JORDAN.connectionId, true, JORDAN_APPROVES_AS)
    await deliver(sam)
    expect(await approversWaitedOn(sam.agent, MINT)).toEqual([])
    await closeRoleOffer(sam.agent, SAM.connectionId, true)
    expect(await approversWaitedOn(sam.agent, MINT)).toEqual(['Jordan'])
    expect(await approversWaitedOn(sam.agent, SHARE)).toEqual([])
    expect(await approversWaitedOn(sam.agent, 'https://trusttasks.org/spec/keys/export-secret/0.1')).toEqual([])
  })
})
