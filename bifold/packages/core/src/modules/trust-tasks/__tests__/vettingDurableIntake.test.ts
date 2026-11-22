/**
 * A vetting request that reaches the shared session while no desk is listening
 * is kept for the desk. The desk listens only while the Vetting screen is open,
 * and a delivery every handler has finished is acknowledged, so a request
 * arriving with the vetter elsewhere in the app was gone from the mediator and
 * reached no desk (reproduced 2026-11-04).
 *
 * The inbox and the store are the shipping ones and every document is really
 * signed. Only the session is a stand-in: `deliver` runs the handlers and
 * acknowledges as vtiAgent.deliver does.
 */
const mockSent: { to: string; type: string; body?: { payload?: Record<string, unknown> } }[] = []
const mockHandlers: Array<(m: unknown) => unknown> = []
const mockSession = { did: undefined as string | undefined, signingInAs: undefined as string | undefined }
const mockLogged: string[] = []

jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  vtiAgent: {
    send: jest.fn(async (to: string, type: string, body?: { payload?: Record<string, unknown> }) => {
      mockSent.push({ to, type, body })
    }),
    onInbound: (handler: (m: unknown) => unknown) => {
      mockHandlers.push(handler)
      return () => mockHandlers.splice(mockHandlers.indexOf(handler), 1)
    },
    subscribe: () => () => undefined,
    getState: () => ({ status: 'connected', did: mockSession.did, signingInAs: mockSession.signingInAs }),
    get isConnected() {
      return Boolean(mockSession.did)
    },
    connect: jest.fn(async () => undefined),
    fetchManifest: async () => ({ criteria: [{ id: 'vetted', vetting: { minStatements: 1 } }] }),
  },
}))
jest.mock('../module/vtaAgent', () => ({
  ...jest.requireActual('../module/vtaAgent'),
  vtaAgent: { installKeyFetcher: jest.fn(), refetchPersonaKeys: jest.fn(async () => undefined) },
}))
jest.mock('../module/releaseLog', () => ({
  ...jest.requireActual('../module/releaseLog'),
  releaseWarn: (line: string) => void mockLogged.push(line),
}))
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

// eslint-disable-next-line import/order
import { DidKey, TypedArrayEncoder } from '@credo-ts/core'
// eslint-disable-next-line import/order
import { ed25519 } from '@noble/curves/ed25519.js'
// eslint-disable-next-line import/order
import { signDocumentProof } from '@bifold/trust-tasks'

// eslint-disable-next-line import/order
import { readOneClock } from '../../../../__tests__/helpers/oneClock'
// eslint-disable-next-line import/order
import { startPersonaInbox } from '../module/vtiPersonaInbox'
// eslint-disable-next-line import/order
import {
  GenericRecordsVettingStore,
  VETTING,
  VtiVetterDesk,
  MAX_PARKED_PER_TICKET,
  MAX_PARKED_REQUEST_CHARS,
  closeExpiredParkedRequests,
  parkVettingRequest,
  type ParkedVettingRequest,
  type VettingTicket,
} from '../module/vtiVetting'

// A grant's window is read with `new Date()`, a ticket's with `Date.now()`: on a phone they are one clock.
readOneClock()

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }

type Rec = { id: string; tags: Record<string, string>; content: Record<string, unknown> }

function didKeySigner(records: Rec[] = []) {
  const secret = ed25519.utils.randomSecretKey()
  const did = `did:key:z${TypedArrayEncoder.toBase58(new Uint8Array([0xed, 0x01, ...ed25519.getPublicKey(secret)]))}`
  const verificationMethodId = DidKey.fromDid(did).didDocument.verificationMethod?.[0]?.id as string
  const agent = {
    config: { logger },
    genericRecords: {
      findAllByQuery: async (query: Record<string, string>) =>
        records
          .filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v))
          .map((r) => ({ ...r, content: JSON.parse(JSON.stringify(r.content)) })),
      save: async ({ content, tags }: Pick<Rec, 'content' | 'tags'>) =>
        void records.push({ id: `r${records.length}`, tags, content: JSON.parse(JSON.stringify(content)) }),
      update: async (record: Rec) => {
        const held = records.find((r) => r.id === record.id)
        if (held) held.content = JSON.parse(JSON.stringify(record.content))
      },
      delete: async (record: Rec) =>
        void records.splice(
          records.findIndex((r) => r.id === record.id),
          1
        ),
    },
    dids: { resolveDidDocument: jest.fn(async (d: string) => DidKey.fromDid(d).didDocument) },
    dependencyManager: {
      resolve: () => ({ sign: async ({ data }: { data: Uint8Array }) => ({ signature: ed25519.sign(data, secret) }) }),
    },
  }
  return { did, verificationMethodId, agent, records }
}

const community = didKeySigner()
const applicant = didKeySigner()
const CODE = 'AAAA-BBBB'
const QR_SECRET = 'qr-secret-that-must-not-stay'
const RESPONSE = `${VETTING.request}#response`
const DAY_MS = 86400000

/** What the applicant was sent; a refusal shows its code and details, so a failure here says why. */
const answers = () =>
  mockSent.map((s) => (s.type === RESPONSE ? s.type : `${s.type} ${JSON.stringify(s.body?.payload ?? {})}`))

const signed = (from: ReturnType<typeof didKeySigner>, to: string, payload: Record<string, unknown>) =>
  signDocumentProof(
    from.agent as never,
    {
      id: `urn:uuid:${Math.random().toString(16).slice(2)}`,
      type: VETTING.request,
      issuer: from.did,
      recipient: to,
      issuedAt: new Date().toISOString(),
      payload,
    },
    from.did,
    { kmsKeyId: 'sig', verificationMethodId: from.verificationMethodId }
  )

/** What vtiAgent.deliver does: every handler runs, and the message is acknowledged unless one failed. */
async function deliver(m: unknown): Promise<'acknowledged'> {
  const results = await Promise.allSettled(mockHandlers.map(async (handler) => handler(m)))
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failed) throw failed.reason
  return 'acknowledged'
}

async function phone(options: { uses?: number } = {}) {
  const vetter = didKeySigner([])
  const persona = {
    did: vetter.did,
    communityDid: community.did,
    vtaKeyIds: { signing: vetter.verificationMethodId, keyAgreement: vetter.verificationMethodId },
    kmsKeyIds: { signing: 'sig', keyAgreement: 'ka' },
    createdAt: '2026-11-01T00:00:00Z',
  }
  vetter.records.push({
    id: 'persona',
    tags: { recordType: 'keyring/vti-identity', kind: 'persona', key: community.did },
    content: persona,
  })
  const store = new GenericRecordsVettingStore(vetter.agent as never)
  const ticket: VettingTicket = {
    ticketId: 'vt-1',
    code: CODE,
    secret: QR_SECRET,
    communityDid: community.did,
    usesLeft: options.uses ?? 1,
    expiresAt: new Date(Date.now() + DAY_MS).toISOString(),
    createdAt: new Date().toISOString(),
  }
  await store.saveTicket(ticket)
  const credential = await signDocumentProof(
    community.agent as never,
    {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://firstperson.network/credentials/dtg/v1'],
      type: ['VerifiableCredential', 'DTGCredential', 'EndorsementCredential'],
      id: 'urn:uuid:grant-1',
      issuer: community.did,
      validFrom: new Date(Date.now() - DAY_MS).toISOString(),
      validUntil: new Date(Date.now() + 90 * DAY_MS).toISOString(),
      credentialSubject: {
        id: vetter.did,
        endorsement: { type: 'CommunityRole', role: 'vetter', communityDid: community.did },
      },
    },
    community.did,
    { kmsKeyId: 'sig', verificationMethodId: community.verificationMethodId }
  )
  const grants = {
    listHeldCredentials: async () => [
      { kind: 'vetter-grant', communityDid: community.did, subjectDid: vetter.did, credential, receivedAt: 't' },
    ],
  }
  const newDesk = () => new VtiVetterDesk(vetter.agent as never, persona as never, store, grants as never)
  /** Seat a desk, as opening the Vetting screen does, and wait for its look at what is kept. */
  const openDesk = async (desk = newDesk()) => {
    const stop = desk.listen()
    await (desk as unknown as { takingParked?: Promise<void> }).takingParked
    return { desk, stop }
  }
  const parked = () => vetter.records.filter((r) => r.tags.kind === 'parked')
  const request = async (ticketPayload: Record<string, unknown> = { code: CODE }, from = applicant) => ({
    id: `urn:uuid:${Math.random().toString(16).slice(2)}`,
    type: VETTING.request,
    from: from.did,
    body: await signed(from, vetter.did, { community: community.did, joinDid: from.did, ticket: ticketPayload }),
  })
  return {
    vetter,
    persona,
    store,
    openDesk,
    parked,
    request,
    inbox: () => startPersonaInbox(vetter.agent as never, {}),
  }
}

describe('a vetting request delivered with no desk listening', () => {
  let stops: Array<() => void> = []
  const seat = <T extends { inbox: () => () => void; vetter: { did: string } }>(p: T): T => {
    mockSession.did = p.vetter.did
    stops.push(p.inbox())
    return p
  }

  beforeEach(() => {
    mockSent.length = 0
    mockLogged.length = 0
    mockHandlers.length = 0
    mockSession.did = undefined
    mockSession.signingInAs = undefined
    logger.warn.mockClear()
    logger.info.mockClear()
    logger.debug.mockClear()
  })
  afterEach(async () => {
    stops.forEach((stop) => stop())
    stops = []
    // Back to the one clock, not to jestSetup's pin: an expiry test moved it.
    jest.spyOn(Date, 'now').mockImplementation(() => new Date().getTime())
    // What a store write announced goes out on the next timer: not after the suite has gone.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('reaches the desk when the vetter opens it, though it was acknowledged while they were elsewhere', async () => {
    const p = seat(await phone())
    await expect(deliver(await p.request())).resolves.toBe('acknowledged')
    expect(mockSent).toHaveLength(0)

    await p.openDesk()

    expect(answers()).toEqual([RESPONSE])
    const [row] = await p.store.listDesk()
    expect(row).toMatchObject({ applicantDid: applicant.did, status: 'accepted' })
    expect((await p.store.listTickets(community.did))[0]).toMatchObject({ usesLeft: 0, boundTo: applicant.did })
  })

  it('holds a ticket secret only until it is taken, and never logs it', async () => {
    const p = seat(await phone())
    const qr = { ticketId: 'vt-1', secret: QR_SECRET }
    await deliver(await p.request(qr))
    // The secret is really there to lose: without this, the check below would pass on a record that never held it.
    expect(JSON.stringify(p.parked())).toContain(QR_SECRET)

    await p.openDesk()

    expect(answers()).toEqual([RESPONSE])
    expect(p.parked()).toHaveLength(1)
    expect(JSON.stringify(p.parked())).not.toContain(QR_SECRET)
    expect(p.parked()[0].content).toMatchObject({ closed: 'taken' })
    expect(p.parked()[0].content.message).toBeUndefined()
    const logs = JSON.stringify([mockLogged, logger.warn.mock.calls, logger.info.mock.calls, logger.debug.mock.calls])
    expect(logs).not.toContain(QR_SECRET)
  })

  it('blanks a code the same way', async () => {
    const p = seat(await phone())
    await deliver(await p.request())
    expect(JSON.stringify(p.parked())).toContain(CODE)
    await p.openDesk()
    expect(JSON.stringify(p.parked())).not.toContain(CODE)
  })

  it('is blanked when its ticket expires, wherever the vetter is, and is never taken', async () => {
    const p = seat(await phone())
    await deliver(await p.request({ ticketId: 'vt-1', secret: QR_SECRET }))
    const later = Date.now() + 2 * DAY_MS

    // On an unlock: the inbox starting, with the vetter nowhere near the desk.
    jest.spyOn(Date, 'now').mockReturnValue(later)
    stops.push(p.inbox())
    await new Promise(setImmediate)
    await new Promise(setImmediate)

    expect(p.parked()[0].content).toMatchObject({ closed: 'expired' })
    expect(JSON.stringify(p.parked())).not.toContain(QR_SECRET)

    await p.openDesk()
    expect(mockSent).toHaveLength(0)
    expect((await p.store.listTickets(community.did))[0].usesLeft).toBe(1)
  })

  it('is blanked by the desk too, when its look is what finds it expired', async () => {
    const p = seat(await phone())
    await deliver(await p.request({ ticketId: 'vt-1', secret: QR_SECRET }))
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * DAY_MS)
    await p.openDesk()
    expect(p.parked()[0].content).toMatchObject({ closed: 'expired' })
    expect(mockSent).toHaveLength(0)
  })

  it('leaves a request alone until its ticket has expired', async () => {
    const p = seat(await phone())
    await deliver(await p.request())
    await closeExpiredParkedRequests(p.store)
    expect(p.parked()[0].content.closed).toBeUndefined()
    expect(p.parked()[0].content.message).toBeDefined()
  })

  it('is not kept without a live ticket: a stranger cannot fill the wallet, nor a wrong secret be stored', async () => {
    const p = seat(await phone())
    await expect(deliver(await p.request({ code: 'WRON-GCOD' }))).resolves.toBe('acknowledged')
    await expect(deliver(await p.request({ ticketId: 'vt-1', secret: 'wrong' }))).resolves.toBe('acknowledged')
    expect(p.parked()).toHaveLength(0)
  })

  it('waits on the mediator while nobody knows whose session it is, and nothing is kept', async () => {
    const p = await phone()
    mockSession.did = undefined
    stops.push(p.inbox())
    await expect(deliver(await p.request())).rejects.toThrow('not taken yet')
    expect(p.parked()).toHaveLength(0)
  })

  it('waits while another identity holds the session, and goes out once this one does', async () => {
    const p = seat(await phone())
    await deliver(await p.request())

    mockSession.did = 'did:webvh:example:another-identity'
    const { desk } = await p.openDesk()
    expect(mockSent).toHaveLength(0)
    expect(p.parked()[0].content.closed).toBeUndefined()

    mockSession.did = p.vetter.did
    await p.openDesk(desk)
    expect(answers()).toEqual([RESPONSE])
  })

  it('is answered once, however many copies come and however often the screen listens', async () => {
    const p = seat(await phone({ uses: 2 }))
    const m = await p.request()
    await deliver(m)
    await deliver(m)
    expect(p.parked()).toHaveLength(1)

    const { desk } = await p.openDesk()
    await p.openDesk(desk)
    await deliver(m)

    expect(answers()).toEqual([RESPONSE])
    expect(await p.store.listDesk()).toHaveLength(1)
    expect((await p.store.listTickets(community.did))[0].usesLeft).toBe(1)
    expect(JSON.stringify(p.parked())).not.toContain(CODE)
  })

  it('leaves no secret behind when a desk was listening all along', async () => {
    const p = seat(await phone())
    const { desk } = await p.openDesk()
    await deliver(await p.request({ ticketId: 'vt-1', secret: QR_SECRET }))
    expect(answers()).toEqual([RESPONSE])

    await p.openDesk(desk)

    expect(mockSent).toHaveLength(1)
    expect(JSON.stringify(p.parked())).not.toContain(QR_SECRET)
  })

  it('keeps waiting when its proof cannot be checked offline, then goes out', async () => {
    const p = seat(await phone())
    await deliver(await p.request())
    const resolve = p.vetter.agent.dids.resolveDidDocument
    resolve.mockImplementation(async () => Promise.reject(new Error('offline')))

    const { desk } = await p.openDesk()
    expect(mockSent).toHaveLength(0)
    expect(p.parked()[0].content.closed).toBeUndefined()
    // The screen looks every few seconds: a request waiting out a bad connection doesn't write a refusal each time.
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('refused unread')

    resolve.mockImplementation(async (d: string) => DidKey.fromDid(d).didDocument)
    await p.openDesk(desk)
    expect(answers()).toEqual([RESPONSE])
  })

  it('keeps waiting too when the desk heard it live but could not check its proof offline', async () => {
    const p = seat(await phone())
    const m = await p.request()
    // Kept first, so the desk's refusal below has a record to close: delivered together, the order is a race.
    await deliver(m)
    expect(p.parked()).toHaveLength(1)
    const resolve = p.vetter.agent.dids.resolveDidDocument
    resolve.mockImplementation(async () => Promise.reject(new Error('offline')))
    const { desk } = await p.openDesk()

    await deliver(m)

    expect(mockSent).toHaveLength(0)
    expect(p.parked()[0].content.closed).toBeUndefined()

    resolve.mockImplementation(async (d: string) => DidKey.fromDid(d).didDocument)
    await p.openDesk(desk)
    expect(answers()).toEqual([RESPONSE])
  })

  it('is not kept once the desk has a row for it', async () => {
    const p = await phone({ uses: 2 })
    mockSession.did = p.vetter.did
    const { stop } = await p.openDesk()
    const m = await p.request()
    await deliver(m)
    expect(answers()).toEqual([RESPONSE])
    stop()

    await parkVettingRequest(p.store, p.persona as never, m as never)

    expect(p.parked()).toHaveLength(0)
  })

  it('is refused unread and closed when its sender is not its issuer, spending nothing', async () => {
    const p = seat(await phone())
    const impostor = didKeySigner()
    const m = await p.request()
    await deliver({ ...m, from: impostor.did })
    expect(p.parked()).toHaveLength(1)

    await p.openDesk()

    expect(mockSent).toHaveLength(0)
    expect((await p.store.listTickets(community.did))[0].usesLeft).toBe(1)
    expect(p.parked()[0].content).toMatchObject({ closed: 'taken' })
    expect(p.parked()[0].content.message).toBeUndefined()

    // The ticket is still live, so a copy delivered again would pass the test to be kept: the note stops it.
    await deliver({ ...m, from: impostor.did })
    expect(p.parked()).toHaveLength(1)
    expect(p.parked()[0].content.message).toBeUndefined()
  })

  describe('what one ticket can keep', () => {
    const impostor = didKeySigner()
    const fill = async (p: Awaited<ReturnType<typeof phone>>, count: number) => {
      for (let i = 0; i < count; i++) await deliver({ ...(await p.request()), from: impostor.did })
    }

    it('is bounded: one shared code cannot write without limit, though keeping spends no use', async () => {
      const p = seat(await phone())
      await fill(p, MAX_PARKED_PER_TICKET + 5)
      expect(p.parked()).toHaveLength(MAX_PARKED_PER_TICKET)
      expect((await p.store.listTickets(community.did))[0].usesLeft).toBe(1)
      // Said, with nothing of the request in it: a request not kept must not look like one that never came.
      expect(mockLogged.join()).toContain('was not kept for the desk')
      expect(mockLogged.join()).not.toContain(CODE)
    })

    it('is not refilled by requests the desk refuses, which close and leave the ticket live', async () => {
      const p = seat(await phone())
      await fill(p, MAX_PARKED_PER_TICKET)
      await p.openDesk()
      expect(p.parked().every((r) => r.content.closed === 'taken')).toBe(true)
      expect((await p.store.listTickets(community.did))[0].usesLeft).toBe(1)

      await fill(p, 5)

      expect(p.parked()).toHaveLength(MAX_PARKED_PER_TICKET)
    })

    it('is counted per ticket: another ticket still keeps its request', async () => {
      const p = seat(await phone())
      await fill(p, MAX_PARKED_PER_TICKET)
      const [first] = await p.store.listTickets(community.did)
      await p.store.saveTicket({ ...first, ticketId: 'vt-2', code: 'CCCC-DDDD', secret: 'another-secret' })

      await deliver(await p.request({ code: 'CCCC-DDDD' }))

      expect(p.parked()).toHaveLength(MAX_PARKED_PER_TICKET + 1)
    })

    it('leaves a desk that is listening able to take a request past the bound', async () => {
      const p = seat(await phone())
      await fill(p, MAX_PARKED_PER_TICKET)
      await p.openDesk()

      await deliver(await p.request())

      expect(answers()).toEqual([RESPONSE])
      expect(p.parked()).toHaveLength(MAX_PARKED_PER_TICKET)
    })

    it('does not keep a request larger than any real one', async () => {
      const p = seat(await phone())
      const m = await p.request()
      await deliver({ ...m, padding: 'x'.repeat(MAX_PARKED_REQUEST_CHARS) })
      expect(p.parked()).toHaveLength(0)
      await deliver(m)
      expect(p.parked()).toHaveLength(1)
    })
  })

  it('is not taken by a later identity in the same community', async () => {
    const p = seat(await phone())
    await deliver(await p.request())
    const note = p.parked()[0].content as unknown as ParkedVettingRequest
    p.parked()[0].content = { ...note, personaDid: 'did:webvh:example:an-earlier-identity' }

    await p.openDesk()

    expect(mockSent).toHaveLength(0)
    expect(p.parked()[0].content.closed).toBeUndefined()
  })

  it('goes when the community is forgotten, note included', async () => {
    const p = seat(await phone())
    await deliver(await p.request())
    await p.openDesk()
    expect(p.parked()).toHaveLength(1)
    await p.store.forget(community.did)
    expect(p.parked()).toHaveLength(0)
  })
})
