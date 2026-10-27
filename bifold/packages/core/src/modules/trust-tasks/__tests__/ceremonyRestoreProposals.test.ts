/**
 * A relationship proposal asked for consent, then the app killed before the
 * person answered. The prompt lived only in memory, and the proposer does not
 * resend, so the request was lost for good. On restart the responder now asks
 * again, from what was persisted — and only for a propose that really was
 * asked and never answered.
 *
 * Each "process" below loads the ceremony afresh (jest.isolateModules), so
 * nothing in memory survives a restart; only the stored records do.
 */
import * as propose from '@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload'
import { readOneClock } from '../../../../__tests__/helpers/oneClock'

jest.mock('../../vrc/vrc-manager', () => ({
  RCE_PROTOCOL_VERSION: 4,
  getOrCreateRelationshipDid: jest.fn(async () => 'did:peer:0zMyRel'),
  getConnectedWitnessConnectionId: jest.fn(() => undefined),
  isWitnessingPreferred: jest.fn(async () => false),
  issueRCardForAcceptedExchange: jest.fn(async () => undefined),
  // A credential that passes W3cCredential's validation, so a delivery can run to its send.
  prepareVrcCredentialWithEvidence: jest.fn(async () => ({
    credential: {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential'],
      issuer: 'did:peer:0zMyRel',
      issuanceDate: '2026-10-22T10:00:00Z',
      credentialSubject: { id: 'did:peer:0zPeerRel' },
    },
    biometricSkipped: false,
  })),
  getVrcJsonLdProofOptions: jest.fn(async () => ({ proofType: 'DataIntegrityProof', cryptosuite: 'eddsa-rdfc-2022' })),
}))

jest.mock('../documentProof', () => ({
  ...jest.requireActual('../documentProof'),
  signDocumentProof: jest.fn(async (_agent: unknown, document: Record<string, unknown>) => ({
    ...document,
    proof: { type: 'DataIntegrityProof', proofValue: 'zStub' },
  })),
  verifyDocumentProof: jest.fn(async () => true),
}))

const ME = 'did:peer:4zzz' // this phone: the responder
const PEER = 'did:peer:4aaa' // the proposer
const CONNECTION_ID = 'conn-1'

/** What a phone keeps across a restart. */
interface Disk {
  documents: unknown[]
  genericRecords: { content: unknown; tags: Record<string, string>; createdAt: Date; getTag(k: string): unknown }[]
  clock: number
}
const newDisk = (): Disk => ({ documents: [], genericRecords: [], clock: Date.parse('2026-10-22T10:00:00Z') })

/** One run of the app: fresh modules, the same disk. */
function boot(disk: Disk, options: { oldBuild?: boolean } = {}) {
  let mods!: {
    ceremony: typeof import('../ceremony')
    core: typeof import('@credo-ts/core')
    didcomm: typeof import('@credo-ts/didcomm')
    store: typeof import('../../vrc/witnessStatusStore')
    message: typeof import('../messages/TrustTaskMessage')
    relationships: typeof import('../../vrc/repositories/RelationshipDidRepository')
  }
  jest.isolateModules(() => {
    mods = {
      ceremony: require('../ceremony'),
      core: require('@credo-ts/core'),
      didcomm: require('@credo-ts/didcomm'),
      store: require('../../vrc/witnessStatusStore'),
      message: require('../messages/TrustTaskMessage'),
      relationships: require('../../vrc/repositories/RelationshipDidRepository'),
    }
  })

  const sent: Record<string, unknown>[] = []
  const relationshipRepo = {
    getAll: jest.fn(async () => []),
    updateCounterpartyRelationshipDid: jest.fn(async () => null),
    findByConnectionDid: jest.fn(async () => ({
      myRelationshipDid: 'did:peer:0zMyRel',
      counterpartyRelationshipDid: 'did:peer:0zPeerRel',
    })),
  }
  const registrations = new Map<unknown, { useFactory: (c: unknown) => unknown }>()
  const singletons = new Map<unknown, unknown>()
  const container = {
    isRegistered: (token: unknown) => registrations.has(token) || singletons.has(token),
    register: (token: unknown, provider: { useFactory: (c: unknown) => unknown }) => {
      registrations.set(token, provider)
    },
    resolve: (token: unknown): unknown => {
      if (singletons.has(token)) return singletons.get(token)
      const registration = registrations.get(token)
      if (registration) {
        const instance = registration.useFactory(container)
        singletons.set(token, instance)
        return instance
      }
      throw new Error(`fake container cannot resolve ${String(token)}`)
    },
  }
  singletons.set(mods.core.InjectionSymbols.StorageService, {
    save: async (_ctx: unknown, record: unknown) => {
      disk.documents.push(record)
    },
    update: async () => undefined,
    findByQuery: async (_ctx: unknown, _cls: unknown, query: Record<string, string>) =>
      disk.documents.filter((r) =>
        Object.entries(query).every(
          ([k, v]) => ((r as { getTags: () => Record<string, unknown> }).getTags() ?? {})[k] === v
        )
      ),
  })
  singletons.set(mods.core.EventEmitter, { emit: () => undefined })
  singletons.set(mods.relationships.RelationshipDidRepository, relationshipRepo)
  singletons.set(mods.didcomm.DidCommMessageSender, {
    sendMessage: async (outbound: { message: { document: Record<string, unknown> } }) => {
      sent.push(outbound.message.document)
    },
  })
  let handle: ((ctx: unknown) => Promise<unknown>) | undefined
  singletons.set(mods.didcomm.DidCommMessageHandlerRegistry, {
    registerMessageHandler: (handler: { handle: (ctx: unknown) => Promise<unknown> }) => {
      handle = handler.handle
    },
  })

  const connection = { id: CONNECTION_ID, did: ME, theirDid: PEER, theirLabel: 'Peer Wallet' }
  const agent = {
    context: {},
    config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
    dependencyManager: { container, registerSingleton: () => undefined },
    dids: { resolveDidDocument: async () => ({ verificationMethod: [] }) },
    genericRecords: {
      save: jest.fn(async ({ content, tags }: { content: unknown; tags: Record<string, string> }) => {
        disk.clock += 1000
        disk.genericRecords.push({ content, tags, createdAt: new Date(disk.clock), getTag: (k) => tags[k] })
      }),
      findAllByQuery: jest.fn(async (query: Record<string, string>) =>
        disk.genericRecords.filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v))
      ),
      delete: jest.fn(async (record: unknown) => {
        if (options.oldBuild) return // a build before markers were forgotten
        const i = disk.genericRecords.indexOf(record as Disk['genericRecords'][number])
        if (i >= 0) disk.genericRecords.splice(i, 1)
      }),
    },
    w3cCredentials: {
      signCredential: jest.fn(async () => ({})),
      verifyCredential: jest.fn(async () => ({ isValid: true })),
      getAll: jest.fn(async () => []),
      store: jest.fn(async () => undefined),
    },
    modules: {
      didcomm: {
        connections: { getById: async () => connection, findById: async () => connection },
      },
    },
  } as never
  mods.ceremony.setupTrustTasksInbound(agent)

  return {
    agent,
    sent,
    relationshipRepo,
    ceremony: mods.ceremony,
    store: mods.store.vrcFlowStore,
    /** A document arriving from the peer on this connection. */
    receive: async (document: Record<string, unknown>) => {
      if (!handle) throw new Error('handler not registered')
      await handle({
        message: new mods.message.TrustTaskMessage({ document }),
        connection: { id: CONNECTION_ID, did: ME, theirDid: PEER },
      })
    },
  }
}

const proposeDoc = (id: string, payload: Record<string, unknown> = { relationshipDid: 'did:peer:0zPeerRel' }) => ({
  id,
  type: propose.TYPE_URI,
  threadId: id,
  issuer: PEER,
  recipient: ME,
  issuedAt: new Date().toISOString(),
  payload,
})
const FIRST = 'aaaa1111-1111-4111-8111-111111111111'
const SECOND = 'aaaa2222-2222-4222-8222-222222222222'
const flush = () => new Promise((resolve) => setTimeout(resolve, 50))

// Every boot() reloads the ceremony's whole module graph (a real restart, in
// effect): a few seconds each on a loaded CI runner, and most tests boot twice.
jest.setTimeout(45_000)

// The pipeline reads Date.now() and the fixtures stamp with new Date(): one clock (see the helper).
readOneClock()

describe('a proposal asked, then the app killed before an answer', () => {
  test('on restart it is asked again, the same exchange, and accepting answers it', async () => {
    const disk = newDisk()
    const before = boot(disk)
    await before.receive(proposeDoc(FIRST))
    expect(before.store.getProposalPrompt(CONNECTION_ID)?.exchangeId).toBe(FIRST)

    const after = boot(disk) // killed and relaunched
    expect(after.store.getProposalPrompt(CONNECTION_ID)).toBeUndefined()
    await after.ceremony.resumeInterruptedExchanges(after.agent)
    expect(after.store.getProposalPrompt(CONNECTION_ID)).toEqual({
      connectionId: CONNECTION_ID,
      exchangeId: FIRST,
      counterpartyLabel: 'Peer Wallet',
    })

    await after.ceremony.respondToRelationshipProposal(after.agent, CONNECTION_ID, true)
    await flush()
    const response = after.sent.find((d) => d.type === `${propose.TYPE_URI}#response`) as
      | { threadId: string; payload: { accept: boolean } }
      | undefined
    expect(response?.threadId).toBe(FIRST)
    expect(response?.payload.accept).toBe(true)
    // The restored answer names the proposer as the restored context says.
    expect(after.relationshipRepo.updateCounterpartyRelationshipDid).toHaveBeenCalledWith(
      expect.anything(),
      PEER,
      'did:peer:0zPeerRel',
      4
    )
  })

  test.each([
    ['accepted', true],
    ['declined', false],
  ])('%s before the kill, it is not asked again', async (_answer, accept) => {
    const disk = newDisk()
    const before = boot(disk)
    await before.receive(proposeDoc(FIRST))
    await before.ceremony.respondToRelationshipProposal(before.agent, CONNECTION_ID, accept)
    await flush()

    const after = boot(disk)
    await after.ceremony.resumeInterruptedExchanges(after.agent)
    expect(after.store.getProposalPrompt(CONNECTION_ID)).toBeUndefined()
  })

  test('a propose the pipeline rejected was never asked, so is not asked after a restart either', async () => {
    const disk = newDisk()
    const before = boot(disk)
    await before.receive(proposeDoc(FIRST, {})) // no relationshipDid: invalid
    expect(before.store.getProposalPrompt(CONNECTION_ID)).toBeUndefined()
    // ...though it is retained, as consume() retains every inbound document.
    expect(disk.documents.length).toBeGreaterThan(0)

    const after = boot(disk)
    await after.ceremony.resumeInterruptedExchanges(after.agent)
    expect(after.store.getProposalPrompt(CONNECTION_ID)).toBeUndefined()
  })

  test('of two proposes asked on a connection, only the newer is asked again, as live', async () => {
    const disk = newDisk()
    const before = boot(disk)
    await before.receive(proposeDoc(FIRST))
    await before.receive(proposeDoc(SECOND))
    expect(before.store.getProposalPrompt(CONNECTION_ID)?.exchangeId).toBe(SECOND)

    const after = boot(disk)
    await after.ceremony.resumeInterruptedExchanges(after.agent)
    expect(after.store.getProposalPrompt(CONNECTION_ID)?.exchangeId).toBe(SECOND)
  })

  test('a propose asked before this release kept no mark, and is not asked again', async () => {
    const disk = newDisk()
    const before = boot(disk)
    await before.receive(proposeDoc(FIRST))
    disk.genericRecords.length = 0

    const after = boot(disk)
    await after.ceremony.resumeInterruptedExchanges(after.agent)
    expect(after.store.getProposalPrompt(CONNECTION_ID)).toBeUndefined()
  })
})

describe('an upgrade request, asked then killed', () => {
  /** The first exchange, accepted on this phone, so the next propose is an upgrade. */
  async function related(disk: Disk) {
    const phone = boot(disk)
    await phone.receive(proposeDoc(FIRST))
    await phone.ceremony.respondToRelationshipProposal(phone.agent, CONNECTION_ID, true)
    await flush()
    return phone
  }

  test('is asked again worded as an upgrade, with its witness', async () => {
    const disk = newDisk()
    const before = await related(disk)
    await before.receive(proposeDoc(SECOND, { relationshipDid: 'did:peer:0zPeerRel', witnessed: true }))
    expect(before.store.getProposalPrompt(CONNECTION_ID)?.upgrade).toBe('witness')

    const after = boot(disk)
    await after.ceremony.resumeInterruptedExchanges(after.agent)
    expect(after.store.getProposalPrompt(CONNECTION_ID)).toEqual({
      connectionId: CONNECTION_ID,
      exchangeId: SECOND,
      counterpartyLabel: 'Peer Wallet',
      upgrade: 'witness',
    })
  })

  test('one refused for naming another relationship is never asked, before or after a restart', async () => {
    const disk = newDisk()
    const before = await related(disk)
    await before.receive(proposeDoc(SECOND, { relationshipDid: 'did:peer:0zSomeoneElse' }))
    expect(before.store.getProposalPrompt(CONNECTION_ID)).toBeUndefined()

    const after = boot(disk)
    await after.ceremony.resumeInterruptedExchanges(after.agent)
    expect(after.store.getProposalPrompt(CONNECTION_ID)).toBeUndefined()
  })
})

describe('asked proposes are forgotten once answered', () => {
  const marks = (disk: Disk) => disk.genericRecords.map((r) => r.tags.exchangeId)

  test.each([
    ['accepting', true],
    ['declining', false],
  ])('%s forgets the mark', async (_answer, accept) => {
    const disk = newDisk()
    const phone = boot(disk)
    await phone.receive(proposeDoc(FIRST))
    expect(marks(disk)).toEqual([FIRST])
    await phone.ceremony.respondToRelationshipProposal(phone.agent, CONNECTION_ID, accept)
    await flush()
    expect(marks(disk)).toEqual([])
  })

  test('a superseded propose is not promoted: A asked, B asked and accepted, nothing asked after a restart', async () => {
    const disk = newDisk()
    const before = boot(disk)
    await before.receive(proposeDoc(FIRST))
    await before.receive(proposeDoc(SECOND))
    await before.ceremony.respondToRelationshipProposal(before.agent, CONNECTION_ID, true)
    await flush()
    expect(marks(disk)).toEqual([])

    const after = boot(disk)
    await after.ceremony.resumeInterruptedExchanges(after.agent)
    expect(after.store.getProposalPrompt(CONNECTION_ID)).toBeUndefined()
  })

  test('a propose asked between two asks of the answered one was superseded too, and is not asked again', async () => {
    const THIRD = 'aaaa3333-3333-4333-8333-333333333333'
    const disk = newDisk()
    const before = boot(disk)
    await before.receive(proposeDoc(SECOND))
    await before.receive(proposeDoc(THIRD))
    await before.receive(proposeDoc(SECOND)) // redelivered: asked again, replacing THIRD's prompt
    expect(before.store.getProposalPrompt(CONNECTION_ID)?.exchangeId).toBe(SECOND)
    await before.ceremony.respondToRelationshipProposal(before.agent, CONNECTION_ID, true)
    await flush()
    expect(marks(disk)).toEqual([])

    const after = boot(disk)
    await after.ceremony.resumeInterruptedExchanges(after.agent)
    expect(after.store.getProposalPrompt(CONNECTION_ID)).toBeUndefined()
  })

  test('a propose that arrives while an answer is sent keeps its mark', async () => {
    const disk = newDisk()
    const phone = boot(disk)
    await phone.receive(proposeDoc(FIRST))
    // Marked after FIRST's, as a propose arriving mid-answer would be.
    disk.clock += 1000
    const tags = { recordType: 'keyring.vrc-propose-awaiting-consent', connectionId: CONNECTION_ID, exchangeId: SECOND }
    disk.genericRecords.push({
      content: {},
      tags,
      createdAt: new Date(disk.clock),
      getTag: (k) => tags[k as keyof typeof tags],
    })
    await phone.ceremony.respondToRelationshipProposal(phone.agent, CONNECTION_ID, true)
    await flush()
    expect(marks(disk)).toEqual([SECOND])
  })

  test('a propose asked but left unmarked (its save failed) still clears the older marks when answered', async () => {
    const disk = newDisk()
    const before = boot(disk)
    await before.receive(proposeDoc(FIRST))
    const save = (before.agent as unknown as { genericRecords: { save: jest.Mock } }).genericRecords.save
    save.mockRejectedValueOnce(new Error('storage busy'))
    await before.receive(proposeDoc(SECOND))
    expect(before.store.getProposalPrompt(CONNECTION_ID)?.exchangeId).toBe(SECOND) // asked all the same
    expect(marks(disk)).toEqual([FIRST])
    await before.ceremony.respondToRelationshipProposal(before.agent, CONNECTION_ID, true)
    await flush()
    expect(marks(disk)).toEqual([])

    const after = boot(disk)
    await after.ceremony.resumeInterruptedExchanges(after.agent)
    expect(after.store.getProposalPrompt(CONNECTION_ID)).toBeUndefined()
  })

  test('marks left by a build that never forgot them are cleared by the next restart, nothing asked', async () => {
    const disk = newDisk()
    const old = boot(disk, { oldBuild: true })
    await old.receive(proposeDoc(FIRST))
    await old.receive(proposeDoc(SECOND))
    await old.ceremony.respondToRelationshipProposal(old.agent, CONNECTION_ID, true)
    await flush()
    expect(marks(disk)).toEqual([FIRST, SECOND])

    const after = boot(disk)
    await after.ceremony.resumeInterruptedExchanges(after.agent)
    expect(after.store.getProposalPrompt(CONNECTION_ID)).toBeUndefined()
    expect(marks(disk)).toEqual([])
  })
})

// UI-smoothness plan, Phase 4: Accept closed the sheet at once, and nothing showed until about six awaits later. It
// now says "preparing" the moment the person accepts; every way on that does not deliver ends the flow, so a failed
// Accept never leaves the overlay preparing.
describe('the overlay from the moment the person accepts', () => {
  type W3c = { signCredential: jest.Mock }
  const w3c = (phone: ReturnType<typeof boot>) => (phone.agent as unknown as { w3cCredentials: W3c }).w3cCredentials
  /** A phone whose relationship DID has a key, so its delivery can sign (the harness's has none, and fails). */
  const canSign = (phone: ReturnType<typeof boot>) => {
    ;(phone.agent as unknown as { dids: { resolveDidDocument: () => Promise<unknown> } }).dids.resolveDidDocument =
      async () => ({ verificationMethod: [{ id: 'did:peer:0zMyRel#key-1' }] })
    return phone
  }

  test('preparing at once, before anything is awaited; then the delivery takes it on (the control)', async () => {
    const phone = canSign(boot(newDisk()))
    await phone.receive(proposeDoc(FIRST))
    const answering = phone.ceremony.respondToRelationshipProposal(phone.agent, CONNECTION_ID, true)
    expect(phone.store.getStatus(CONNECTION_ID)).toBe('preparing-offer')
    await answering
    await flush()
    expect(phone.store.getStatus(CONNECTION_ID)).toBe('offer-sent')
    expect(phone.store.flowEndedWith(CONNECTION_ID)).toBeUndefined()
  })

  // The responder's discovery query runs beside its delivery: "Checking what your contact supports…" replaced
  // "Preparing your relationship credential…" while this phone was still preparing it.
  test('while this phone prepares its credential, the overlay never goes back to checking the contact', async () => {
    const phone = canSign(boot(newDisk()))
    await phone.receive(proposeDoc(FIRST))
    const statuses: string[] = []
    const record = (e: { connectionId: string; status: string }) => {
      if (e.connectionId === CONNECTION_ID) statuses.push(e.status)
    }
    phone.store.on('flowUpdate', record)
    await phone.ceremony.respondToRelationshipProposal(phone.agent, CONNECTION_ID, true)
    await flush()
    phone.store.off('flowUpdate', record)
    expect(statuses[0]).toBe('preparing-offer')
    expect(statuses.slice(statuses.indexOf('preparing-offer'))).not.toContain('discovering')
    expect(statuses[statuses.length - 1]).toBe('offer-sent')
  })

  test('the acceptance itself fails: the flow ends as an error, and the caller hears it', async () => {
    const phone = boot(newDisk())
    await phone.receive(proposeDoc(FIRST))
    phone.relationshipRepo.updateCounterpartyRelationshipDid.mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(phone.ceremony.respondToRelationshipProposal(phone.agent, CONNECTION_ID, true)).rejects.toThrow(
      'storage unavailable'
    )
    expect(phone.store.getStatus(CONNECTION_ID)).toBe('idle')
    expect(phone.store.flowEndedWith(CONNECTION_ID)).toBe('error')
  })

  test('the delivery cannot start (relationship DIDs incomplete): the flow ends, not left preparing', async () => {
    const phone = boot(newDisk())
    await phone.receive(proposeDoc(FIRST))
    phone.relationshipRepo.findByConnectionDid.mockResolvedValue({} as never)
    await phone.ceremony.respondToRelationshipProposal(phone.agent, CONNECTION_ID, true)
    await flush()
    expect(phone.store.getStatus(CONNECTION_ID)).toBe('idle')
    expect(phone.store.flowEndedWith(CONNECTION_ID)).toBe('error')
  })

  test('the delivery fails: the flow ends, not left preparing until the overlay times out', async () => {
    const phone = canSign(boot(newDisk()))
    await phone.receive(proposeDoc(FIRST))
    w3c(phone).signCredential.mockRejectedValueOnce(new Error('signing failed'))
    await phone.ceremony.respondToRelationshipProposal(phone.agent, CONNECTION_ID, true)
    await flush()
    expect(phone.store.getStatus(CONNECTION_ID)).toBe('idle')
    expect(phone.store.flowEndedWith(CONNECTION_ID)).toBe('error')
  })

  // A delivery that finds this side's credential already issued is done, not failed (it once read as "skipped",
  // which the acceptance ended as an error — a failure shown for an exchange that had worked).
  test('this side already issued on the exchange: back to sent, not ended as an error', async () => {
    const phone = canSign(boot(newDisk()))
    await phone.receive(proposeDoc(FIRST))
    await expect(phone.ceremony.deliverVrcViaTrustTaskForExchange(phone.agent, CONNECTION_ID, FIRST)).resolves.toBe(
      'delivered'
    )
    const statuses: string[] = []
    const record = (e: { connectionId: string; status: string }) => {
      if (e.connectionId === CONNECTION_ID) statuses.push(e.status)
    }
    phone.store.on('flowUpdate', record)
    await phone.ceremony.respondToRelationshipProposal(phone.agent, CONNECTION_ID, true)
    await flush()
    phone.store.off('flowUpdate', record)
    expect(phone.store.flowEndedWith(CONNECTION_ID)).toBeUndefined()
    // Sent, as a delivery leaves it, and not left preparing (the discovery query may then show its wait).
    expect(statuses.slice(statuses.indexOf('preparing-offer'))).toContain('offer-sent')
    expect(phone.store.getStatus(CONNECTION_ID)).not.toBe('preparing-offer')
  })

  test('a delivery already under way for the exchange: its status stands, and it carries on', async () => {
    const phone = canSign(boot(newDisk()))
    await phone.receive(proposeDoc(FIRST))
    let release: () => void = () => undefined
    w3c(phone).signCredential.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({}))))
    const first = phone.ceremony.deliverVrcViaTrustTaskForExchange(phone.agent, CONNECTION_ID, FIRST)
    await flush()
    await phone.ceremony.respondToRelationshipProposal(phone.agent, CONNECTION_ID, true)
    await flush()
    // The acceptance's delivery was the duplicate: it does not end the flow the first run owns (the status may have
    // moved on — the acceptance also starts a discovery query — but the flow is not ended).
    expect(phone.store.getStatus(CONNECTION_ID)).not.toBe('idle')
    expect(phone.store.flowEndedWith(CONNECTION_ID)).toBeUndefined()
    release()
    await expect(first).resolves.toBe('delivered')
    expect(phone.store.getStatus(CONNECTION_ID)).toBe('offer-sent')
  })
})
