import { AgentRoomsService, offerIdOf, type RoomsBackend, type RoomsCommunity } from '../real/agentRoomsService'
import { OFFERS_LIST_TYPES, ROOMS_TASK } from '../real/wire'
import { PREVIEW_TOKEN_TTL_MS, RoomsPreviewExpired, RoomsRefused, RoomsUnavailable } from '../types'

const COMMUNITY: RoomsCommunity = { did: 'did:webvh:community:a', personaDid: 'did:key:persona-a' }
const OPEN_ROOM = 'did:webvh:room:open1'
const SEALED_ROOM = 'did:webvh:room:sealed1'
const JOINED_ROOM = 'did:webvh:room:joined1'

/** A refusal as both legs throw it (`VtiRefusal`): the framework's code, and the task's own in `details`. */
class FakeRefusal extends Error {
  public constructor(
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(`refused: ${code}`)
    this.name = 'VtiRefusal'
  }
}
const taskRefusal = (local: string) => new FakeRefusal('taskFailed', { code: `vtc/rooms/offers/accept:${local}` })

const credentials = (room: string) => ({
  invitation: `{"id":"urn:inv:${room}"}`,
  membership: `{"id":"urn:vmc:${room}","credentialSubject":{"id":"did:key:persona-a"}}`,
  authority: `{"id":"urn:vac:${room}","credentialSubject":{"id":"did:key:persona-a"}}`,
})

const offer = (
  roomId: string,
  visibility: string,
  state: 'open' | 'accepted',
  extra: Record<string, unknown> = {}
) => ({
  roomId,
  host: COMMUNITY.did,
  label: `Room ${roomId.slice(-7)}`,
  visibility,
  actions: ['read', 'write'],
  validUntil: '2026-12-01T00:00:00Z',
  offeredAt: '2026-10-26T00:00:00Z',
  state,
  credentials: credentials(roomId),
  ...extra,
})

const ALL_SERVED = [
  ROOMS_TASK.keysList02,
  ROOMS_TASK.keysKeyPackage,
  ROOMS_TASK.keysWelcome,
  ROOMS_TASK.keysBackfill,
  ROOMS_TASK.vaultReceive,
  ROOMS_TASK.vaultQuery,
  ROOMS_TASK.vaultGet02,
  ROOMS_TASK.keysAct06,
]

interface Setup {
  offers?: Record<string, unknown>[]
  renewals?: Record<string, unknown>[]
  held?: string[]
  served?: string[]
  hidden?: string[]
  accept?: (payload: Record<string, unknown>) => unknown
  welcome?: () => unknown
  /** The `vtc/rooms/offers/list` versions the community serves: all three unless given. */
  lists?: string[]
}

/**
 * A community's answer to `vtc/rooms/offers/list` at `type`, as the spec shapes it: 0.4's renewals name the instant
 * `renewsAt` (vtc/_shared/0.4 `Renewal`), 0.3's `renews` (0.1), and 0.2 carries no renewals.
 */
const listAnswer = (type: string, offers: Record<string, unknown>[], renewals?: Record<string, unknown>[]) => {
  if (type === ROOMS_TASK.offersList02) return { items: offers }
  if (type === ROOMS_TASK.offersList03) return { items: offers, renewals }
  return {
    items: offers,
    renewals: renewals?.map(({ renews, ...rest }) => ({ ...rest, renewsAt: renews })),
  }
}

function setup(o: Setup = {}) {
  const calls: string[] = []
  const hidden = [...(o.hidden ?? [])]
  const agentTask = jest.fn(async (type: string, payload: Record<string, unknown>): Promise<unknown> => {
    calls.push(type)
    switch (type) {
      case ROOMS_TASK.keysList02:
        return {
          rooms: (o.held ?? []).map((roomId) => ({
            roomId,
            epoch: 1,
            earliestReadableEpoch: 1,
            member: COMMUNITY.personaDid,
          })),
        }
      case ROOMS_TASK.vaultReceive:
        return { id: 'stored', types: [], status: 'valid' }
      case ROOMS_TASK.vaultQuery:
        return { credentials: [{ id: `held-${String(payload.type)}`, types: [], status: 'valid' }] }
      case ROOMS_TASK.vaultGet02:
      case ROOMS_TASK.vaultGet01:
        return { credential: { credentialSubject: { id: COMMUNITY.personaDid } } }
      case ROOMS_TASK.keysKeyPackage:
        return { keyPackage: 'kp-abc', expiresAt: '2026-11-01T00:00:00Z', alreadyMinted: false }
      case ROOMS_TASK.keysWelcome:
        return o.welcome ? o.welcome() : { epoch: 2 }
      case ROOMS_TASK.keysBackfill:
        return { roomId: payload.roomId, earliestReadableEpoch: 1 }
      case ROOMS_TASK.keysAct06: {
        // The agent completes the request as the member: issuer and proof added, nothing else changed.
        const document = payload.document as Record<string, unknown>
        return { principal: COMMUNITY.personaDid, document: { ...document, proof: { type: 'DataIntegrityProof' } } }
      }
      default:
        throw new Error(`unexpected agent task ${type}`)
    }
  })
  const answer = (type: string, payload: Record<string, unknown>): unknown => {
    if ((OFFERS_LIST_TYPES as readonly string[]).includes(type)) {
      const lists: readonly string[] = o.lists ?? OFFERS_LIST_TYPES
      if (!lists.includes(type)) throw new FakeRefusal('unsupportedVersion')
      return listAnswer(type, o.offers ?? [], o.renewals)
    }
    if (type === ROOMS_TASK.offersAccept) {
      if (o.accept) return o.accept(payload)
      return { roomId: payload.roomId, state: 'admitted', epoch: 1, welcome: 'welcome-bytes' }
    }
    throw new Error(`unexpected community task ${type}`)
  }
  const communityTask = jest.fn(
    async (_did: string, type: string, payload: Record<string, unknown>): Promise<unknown> => {
      calls.push(type)
      return answer(type, payload)
    }
  )
  const sendCompleted = jest.fn(
    async (_did: string, _recipient: string, document: Record<string, unknown>): Promise<unknown> => {
      calls.push(String(document.type))
      return answer(String(document.type), document.payload as Record<string, unknown>)
    }
  )
  let ids = 0
  const sleeps: number[] = []
  let clock = 1_000_000
  const b: RoomsBackend = {
    agentLinked: () => true,
    agentServedTypes: async () => o.served ?? ALL_SERVED,
    agentTask,
    communities: async () => [COMMUNITY],
    communityTask,
    sendCompleted,
    newId: () => `id-${++ids}`,
    leaveCommunity: jest.fn(async () => undefined),
    decodeBase64Url: (s) => Buffer.from(s, 'base64url').toString('utf8'),
    encodeBase64Url: (text) => Buffer.from(text, 'utf8').toString('base64url'),
    hiddenOffers: async () => [...hidden],
    hideOffer: jest.fn(async (offerId: string) => {
      hidden.push(offerId)
    }),
    warn: jest.fn(),
  }
  const service = new AgentRoomsService(b, undefined, {
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
  })
  return {
    service,
    b,
    agentTask,
    communityTask,
    sendCompleted,
    calls,
    sleeps,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

const sent = (mock: jest.Mock, type: string) => mock.mock.calls.filter((c) => c.includes(type))
/** The documents the phone delivered as the agent completed them, of one type. */
const delivered = (mock: jest.Mock, type: string): Record<string, unknown>[] =>
  mock.mock.calls.map((c) => c[2] as Record<string, unknown>).filter((d) => d.type === type)

describe('AgentRoomsService offers', () => {
  it('lists what the member can act on, read from the community as the persona', async () => {
    const { service, communityTask } = setup({
      offers: [
        offer(OPEN_ROOM, 'open', 'open', { description: 'Seeds <b>and</b> soil' }),
        offer(SEALED_ROOM, 'attributed', 'accepted'), // accepted elsewhere, not joined: accepting again finishes it
        offer(JOINED_ROOM, 'attributed', 'accepted'), // joined: nothing to do
        offer('did:webvh:room:open2', 'open', 'accepted'), // an open room has no group: accepted is joined
        offer('did:webvh:room:elsewhere', 'open', 'open', { host: 'did:webvh:other' }),
        { roomId: 'did:webvh:room:broken', host: COMMUNITY.did, visibility: 'open', state: 'open' }, // no credentials
      ],
      held: [JOINED_ROOM],
    })
    const offers = await service.listOffers()

    expect(communityTask).toHaveBeenCalledWith(COMMUNITY.did, ROOMS_TASK.offersList04, {})
    expect(offers.map((x) => x.roomId)).toEqual([OPEN_ROOM, SEALED_ROOM])
    expect(offers[0]).toMatchObject({
      offerId: offerIdOf(COMMUNITY.did, OPEN_ROOM),
      communityDid: COMMUNITY.did,
      tier: 'open',
      verbs: ['read', 'write'],
      validUntil: '2026-12-01T00:00:00Z',
    })
    expect(String(offers[0].description)).toBe('Seeds <b>and</b> soil') // inert: kept as text
    expect(offers[0]).not.toHaveProperty('credentials')
    expect(sent(communityTask, ROOMS_TASK.offersAccept)).toHaveLength(0)
  })

  it('carries the community\'s name only when it has one, never a cut of its DID (276.9: "nity-a-vtc")', async () => {
    const { service, b } = setup({ offers: [offer(OPEN_ROOM, 'open', 'open')] })
    const [unnamed] = await service.listOffers()
    expect(unnamed.communityName).toBeUndefined()

    b.communities = async () => [{ ...COMMUNITY, name: 'Keyring Lab' }]
    const [named] = await service.listOffers()
    expect(String(named.communityName)).toBe('Keyring Lab')
  })

  it("leaves out an accepted sealed offer while the agent can't say which rooms it holds: never offered as new (276.9)", async () => {
    const s = setup({ offers: [offer(OPEN_ROOM, 'open', 'open'), offer(SEALED_ROOM, 'attributed', 'accepted')] })
    const answer = s.agentTask.getMockImplementation()!
    s.agentTask.mockImplementation(async (type: string, payload: Record<string, unknown>) => {
      if (type === ROOMS_TASK.keysList02) throw new Error('the agent did not answer')
      return answer(type, payload)
    })
    expect((await s.service.listOffers()).map((x) => x.roomId)).toEqual([OPEN_ROOM])
    expect(s.b.warn).toHaveBeenCalledWith(expect.stringContaining(`whether ${SEALED_ROOM} was joined is unknown`))

    // Control: the agent answers, and holds none: accepted elsewhere, not joined, so it is offered.
    s.agentTask.mockImplementation(answer)
    expect((await s.service.listOffers()).map((x) => x.roomId)).toEqual([OPEN_ROOM, SEALED_ROOM])
  })

  it('an offered room the community named none is what tells it apart, said to be that, never a cut of its ID (276.9)', async () => {
    const unnamed = 'did:webvh:QmScid123456:rooms.example:community-a-vtc'
    const { service } = setup({
      offers: [offer(unnamed, 'open', 'open', { label: undefined }), offer(OPEN_ROOM, 'open', 'open')],
    })
    const [byId, named] = await service.listOffers()
    expect(String(byId.roomName)).toBe('community-a-vtc')
    expect(byId.roomNameFrom).toBe('roomId')
    expect(String(named.roomName)).toBe(`Room ${OPEN_ROOM.slice(-7)}`)
    expect(named).not.toHaveProperty('roomNameFrom')
  })

  it('reads a community without renewals at 0.2', async () => {
    const { service, communityTask } = setup({
      offers: [offer(OPEN_ROOM, 'open', 'open')],
      lists: [ROOMS_TASK.offersList02],
    })
    expect((await service.listOffers()).map((x) => x.roomId)).toEqual([OPEN_ROOM])
    expect(communityTask.mock.calls.map((c) => c[1])).toEqual([...OFFERS_LIST_TYPES])
  })

  it('remembers a community answered at 0.2, and asks it 0.2 alone from then on', async () => {
    const { service, communityTask } = setup({
      offers: [offer(OPEN_ROOM, 'open', 'open')],
      lists: [ROOMS_TASK.offersList02],
    })
    await service.listOffers()
    await service.listOffers()
    await service.listOffers()
    // 0.4 and 0.3 refused once on the first listing, then 0.2 only: five requests for three listings, not nine.
    expect(sent(communityTask, ROOMS_TASK.offersList04)).toHaveLength(1)
    expect(sent(communityTask, ROOMS_TASK.offersList03)).toHaveLength(1)
    expect(sent(communityTask, ROOMS_TASK.offersList02)).toHaveLength(3)
  })

  it('keeps asking 0.4 of a community that serves it', async () => {
    const { service, communityTask } = setup({ offers: [offer(OPEN_ROOM, 'open', 'open')] })
    await service.listOffers()
    await service.listOffers()
    expect(sent(communityTask, ROOMS_TASK.offersList04)).toHaveLength(2)
    expect(communityTask).toHaveBeenCalledTimes(2)
  })

  it('reads a community that moved on to 0.4 alone (VTC 0.16) after it answered 0.2', async () => {
    const lists: string[] = [ROOMS_TASK.offersList02]
    const { service, communityTask } = setup({ offers: [offer(OPEN_ROOM, 'open', 'open')], lists })
    await service.listOffers()
    lists.splice(0, 1, ROOMS_TASK.offersList04)
    communityTask.mockClear()
    expect((await service.listOffers()).map((x) => x.roomId)).toEqual([OPEN_ROOM])
    expect(communityTask.mock.calls.map((c) => c[1])).toEqual([ROOMS_TASK.offersList02, ROOMS_TASK.offersList04])
  })

  it('control: any other refusal of 0.4 is passed on, not asked again at 0.3', async () => {
    const { service, communityTask } = setup()
    communityTask.mockImplementation(async () => {
      throw new FakeRefusal('taskFailed', { code: 'vtc/rooms/offers/list:notAMember' })
    })
    // Asked of the one community, so its refusal reaches the caller rather than a warning.
    await expect(service.listOffers(COMMUNITY.did)).rejects.toThrow()
    expect(communityTask.mock.calls.map((c) => c[1])).toEqual([ROOMS_TASK.offersList04])
  })

  describe('a renewal, by the version the community serves', () => {
    const renewal = {
      roomId: JOINED_ROOM,
      host: COMMUNITY.did,
      validUntil: '2027-01-01T00:00:00Z',
      renews: '2026-11-01T00:00:00Z',
      issuedAt: '2026-10-26T00:00:00Z',
      credentials: { membership: '{"id":"urn:vmc:new"}', authority: '{"id":"urn:vac:new"}' },
    }

    it.each([
      ['VTC 0.16: 0.4 only (renewsAt)', [ROOMS_TASK.offersList04], ROOMS_TASK.offersList04],
      ['VTC 0.15: 0.2 and 0.4', [ROOMS_TASK.offersList02, ROOMS_TASK.offersList04], ROOMS_TASK.offersList04],
      ['a community at 0.3 (renews)', [ROOMS_TASK.offersList02, ROOMS_TASK.offersList03], ROOMS_TASK.offersList03],
    ])('%s: is stored in place of what it renews', async (_label, lists, answered) => {
      const { service, agentTask, communityTask } = setup({ renewals: [renewal], held: [JOINED_ROOM], lists })
      await service.listOffers()
      expect(communityTask).toHaveBeenLastCalledWith(COMMUNITY.did, answered, {})
      expect(sent(agentTask, ROOMS_TASK.vaultReceive)).toHaveLength(2)
    })

    it('control: a renewal naming neither renewsAt nor renews is left, and nothing is stored', async () => {
      const unnamed: Record<string, unknown> = { ...renewal }
      delete unnamed.renews
      const { service, agentTask } = setup({
        renewals: [unnamed],
        held: [JOINED_ROOM],
        lists: [ROOMS_TASK.offersList03],
      })
      await service.listOffers()
      expect(sent(agentTask, ROOMS_TASK.vaultReceive)).toHaveLength(0)
    })
  })

  it('stores a renewal in place of what it renews, once, and never accepts it', async () => {
    const renewal = {
      roomId: JOINED_ROOM,
      host: COMMUNITY.did,
      label: 'Joined',
      visibility: 'attributed',
      actions: ['read'],
      validUntil: '2027-01-01T00:00:00Z',
      renews: '2026-11-01T00:00:00Z',
      issuedAt: '2026-10-26T00:00:00Z',
      credentials: { membership: '{"id":"urn:vmc:new"}', authority: '{"id":"urn:vac:new"}' },
    }
    const { service, agentTask, communityTask } = setup({ renewals: [renewal], held: [JOINED_ROOM] })
    await service.listOffers()
    await service.listOffers()

    expect(agentTask).toHaveBeenCalledWith(ROOMS_TASK.vaultQuery, {
      type: 'MembershipCredential',
      issuerDid: JOINED_ROOM,
    })
    expect(agentTask).toHaveBeenCalledWith(ROOMS_TASK.vaultReceive, {
      credential: { id: 'urn:vmc:new' },
      id: 'held-MembershipCredential',
    })
    expect(agentTask).toHaveBeenCalledWith(ROOMS_TASK.vaultReceive, {
      credential: { id: 'urn:vac:new' },
      id: 'held-AuthorityCredential',
    })
    expect(sent(agentTask, ROOMS_TASK.vaultReceive)).toHaveLength(2) // the second listing stored nothing again
    expect(sent(communityTask, ROOMS_TASK.offersAccept)).toHaveLength(0)
  })

  it('matches a renewal with vault/credentials/get/0.1 on an agent without 0.2, as VTAs up to 0.66 are', async () => {
    const renewal = {
      roomId: JOINED_ROOM,
      host: COMMUNITY.did,
      validUntil: '2027-01-01T00:00:00Z',
      renews: '2026-11-01T00:00:00Z',
      issuedAt: '2026-10-26T00:00:00Z',
      credentials: { membership: '{"id":"urn:vmc:new"}', authority: '{"id":"urn:vac:new"}' },
    }
    const { service, agentTask } = setup({
      renewals: [renewal],
      held: [JOINED_ROOM],
      served: [ROOMS_TASK.keysList02, ROOMS_TASK.vaultReceive, ROOMS_TASK.vaultQuery, ROOMS_TASK.vaultGet01],
    })
    await service.listOffers()
    expect(sent(agentTask, ROOMS_TASK.vaultGet01)).toHaveLength(2)
    expect(sent(agentTask, ROOMS_TASK.vaultGet02)).toHaveLength(0)
    expect(sent(agentTask, ROOMS_TASK.vaultReceive)).toHaveLength(2)
  })

  it('leaves renewals for an agent that cannot store them in place, and says so', async () => {
    const renewal = {
      roomId: JOINED_ROOM,
      host: COMMUNITY.did,
      validUntil: '2027-01-01T00:00:00Z',
      renews: '2026-11-01T00:00:00Z',
      issuedAt: '2026-10-26T00:00:00Z',
      credentials: { membership: '{}', authority: '{}' },
    }
    const { service, b, agentTask } = setup({
      renewals: [renewal],
      served: [ROOMS_TASK.keysList02, ROOMS_TASK.vaultReceive],
    })
    await service.listOffers()
    expect(sent(agentTask, ROOMS_TASK.vaultReceive)).toHaveLength(0)
    expect(b.warn).toHaveBeenCalledWith(expect.stringContaining('renewal(s) left uncollected'))
  })

  it('accepts an open room: stores the credentials, then accepts as the persona with no key package', async () => {
    const { service, calls, communityTask, agentTask } = setup({ offers: [offer(OPEN_ROOM, 'open', 'open')] })
    const preview = await service.previewOffer(offerIdOf(COMMUNITY.did, OPEN_ROOM))
    expect(preview.actingAs.did).toBe(COMMUNITY.personaDid)

    expect(await service.acceptOffer(preview.token)).toEqual({ roomId: OPEN_ROOM })
    expect(agentTask).toHaveBeenCalledWith(ROOMS_TASK.vaultReceive, {
      credential: JSON.parse(credentials(OPEN_ROOM).membership),
    })
    expect(agentTask).toHaveBeenCalledWith(ROOMS_TASK.vaultReceive, {
      credential: JSON.parse(credentials(OPEN_ROOM).authority),
    })
    expect(communityTask).toHaveBeenCalledWith(COMMUNITY.did, ROOMS_TASK.offersAccept, { roomId: OPEN_ROOM })
    expect(calls).not.toContain(ROOMS_TASK.keysKeyPackage)
    expect(calls).not.toContain(ROOMS_TASK.keysWelcome)
  })

  it('accepts a sealed room through the agent: key package, accept completed by the agent, Welcome, backfill', async () => {
    const { service, calls, communityTask, sendCompleted, agentTask } = setup({
      offers: [offer(SEALED_ROOM, 'attributed', 'open')],
    })
    const preview = await service.previewOffer(offerIdOf(COMMUNITY.did, SEALED_ROOM))
    await service.acceptOffer(preview.token)

    expect(agentTask).toHaveBeenCalledWith(ROOMS_TASK.keysKeyPackage, {
      roomId: SEALED_ROOM,
      invitation: credentials(SEALED_ROOM).invitation,
    })
    // Only the agent can vouch for its own KeyPackage, so it completes the accept; the phone sends it unchanged.
    expect(agentTask).toHaveBeenCalledWith(ROOMS_TASK.keysAct06, {
      document: expect.objectContaining({
        type: ROOMS_TASK.offersAccept,
        issuer: COMMUNITY.personaDid,
        recipient: COMMUNITY.did,
        payload: { roomId: SEALED_ROOM, keyPackage: 'kp-abc' },
      }),
    })
    const [accept] = delivered(sendCompleted, ROOMS_TASK.offersAccept)
    expect(accept).toMatchObject({ proof: { type: 'DataIntegrityProof' } })
    expect(sendCompleted).toHaveBeenCalledWith(COMMUNITY.did, COMMUNITY.did, accept)
    expect(sent(communityTask, ROOMS_TASK.offersAccept)).toHaveLength(0)
    expect(agentTask).toHaveBeenCalledWith(ROOMS_TASK.keysWelcome, {
      roomId: SEALED_ROOM,
      welcome: 'welcome-bytes',
      invitation: credentials(SEALED_ROOM).invitation,
    })
    expect(agentTask).toHaveBeenCalledWith(ROOMS_TASK.keysBackfill, { roomId: SEALED_ROOM, host: COMMUNITY.did })
    const after = calls.slice(calls.lastIndexOf(ROOMS_TASK.offersList04) + 1)
    expect(after).toEqual([
      ROOMS_TASK.vaultReceive,
      ROOMS_TASK.vaultReceive,
      ROOMS_TASK.keysKeyPackage,
      ROOMS_TASK.keysAct06,
      ROOMS_TASK.offersAccept,
      ROOMS_TASK.keysWelcome,
      ROOMS_TASK.keysBackfill,
    ])
  })

  it('sends an admissionPending accept again, identically, before giving up', async () => {
    let answers = 0
    const pending = setup({
      offers: [offer(SEALED_ROOM, 'attributed', 'open')],
      accept: (payload) => {
        if (++answers <= 3) throw taskRefusal('admissionPending')
        return { roomId: payload.roomId, state: 'admitted', epoch: 1, welcome: 'w' }
      },
    })
    await pending.service.acceptOffer((await pending.service.previewOffer(offerIdOf(COMMUNITY.did, SEALED_ROOM))).token)
    expect(pending.sleeps).toEqual([1000, 2000, 4000])
    const accepts = delivered(pending.sendCompleted, ROOMS_TASK.offersAccept)
    expect(accepts).toHaveLength(4)
    expect(new Set(accepts.map((d) => JSON.stringify(d.payload))).size).toBe(1) // the same KeyPackage every time
    expect(new Set(accepts.map((d) => d.id)).size).toBe(4) // a fresh document each time: ids are single-use

    const stuck = setup({
      offers: [offer(SEALED_ROOM, 'attributed', 'open')],
      accept: () => {
        throw taskRefusal('admissionPending')
      },
    })
    const err = await stuck.service
      .acceptOffer((await stuck.service.previewOffer(offerIdOf(COMMUNITY.did, SEALED_ROOM))).token)
      .catch((e) => e)
    expect(err).toBeInstanceOf(RoomsRefused)
    expect(err).toMatchObject({
      name: 'RoomsRefused',
      operation: 'acceptOffer',
      code: 'admissionPending',
      retryable: true,
    })
  })

  it('passes the community’s refusal on by its code', async () => {
    const { service } = setup({
      offers: [offer(OPEN_ROOM, 'open', 'open')],
      accept: () => {
        throw taskRefusal('offerExpired')
      },
    })
    const err = await service
      .acceptOffer((await service.previewOffer(offerIdOf(COMMUNITY.did, OPEN_ROOM))).token)
      .catch((e) => e)
    expect(err).toMatchObject({ name: 'RoomsRefused', code: 'offerExpired', retryable: false })
  })

  it('passes a transport failure on unchanged, not as a refusal', async () => {
    const { service } = setup({
      offers: [offer(OPEN_ROOM, 'open', 'open')],
      accept: () => {
        throw new Error('no answer')
      },
    })
    const err = await service
      .acceptOffer((await service.previewOffer(offerIdOf(COMMUNITY.did, OPEN_ROOM))).token)
      .catch((e) => e)
    expect(err).not.toBeInstanceOf(RoomsRefused)
    expect((err as Error).message).toBe('no answer')
  })

  it('treats a sealed room it already holds as joined when the community says alreadyAccepted', async () => {
    const s = setup({
      offers: [offer(SEALED_ROOM, 'attributed', 'open')],
      accept: () => {
        throw taskRefusal('alreadyAccepted')
      },
    })
    const preview = await s.service.previewOffer(offerIdOf(COMMUNITY.did, SEALED_ROOM))
    s.agentTask.mockImplementationOnce(async () => ({ id: 'x' })) // membership stored
    // From here the agent lists the room as held (another surface joined it).
    const held = { rooms: [{ roomId: SEALED_ROOM, epoch: 2, earliestReadableEpoch: 1, member: COMMUNITY.personaDid }] }
    const original = s.agentTask.getMockImplementation()!
    s.agentTask.mockImplementation(async (type, payload) =>
      type === ROOMS_TASK.keysList02 ? held : original(type, payload)
    )
    expect(await s.service.acceptOffer(preview.token)).toEqual({ roomId: SEALED_ROOM })
    expect(s.calls).not.toContain(ROOMS_TASK.keysWelcome)
  })

  it('finishes a join another surface handed the Welcome to first, and reports any other join failure', async () => {
    const ok = setup({
      offers: [offer(SEALED_ROOM, 'attributed', 'open')],
      welcome: () => {
        throw new FakeRefusal('taskFailed', { code: 'rooms/keys/welcome:alreadyJoined' })
      },
    })
    await expect(
      ok.service.acceptOffer((await ok.service.previewOffer(offerIdOf(COMMUNITY.did, SEALED_ROOM))).token)
    ).resolves.toEqual({ roomId: SEALED_ROOM })

    const bad = setup({
      offers: [offer(SEALED_ROOM, 'attributed', 'open')],
      welcome: () => {
        throw new Error('group state corrupt')
      },
    })
    const err = await bad.service
      .acceptOffer((await bad.service.previewOffer(offerIdOf(COMMUNITY.did, SEALED_ROOM))).token)
      .catch((e) => e)
    expect(err).toMatchObject({ name: 'RoomsRefused', code: 'joinFailed', retryable: true })
  })

  it('does not accept again what another surface already finished', async () => {
    const s = setup({ offers: [offer(OPEN_ROOM, 'open', 'open')] })
    const preview = await s.service.previewOffer(offerIdOf(COMMUNITY.did, OPEN_ROOM))
    s.communityTask.mockImplementation(async (_did: string, type: string) => {
      s.calls.push(type)
      return { items: [offer(OPEN_ROOM, 'open', 'accepted')] }
    })
    expect(await s.service.acceptOffer(preview.token)).toEqual({ roomId: OPEN_ROOM })
    expect(s.calls).not.toContain(ROOMS_TASK.offersAccept)
    expect(s.calls).not.toContain(ROOMS_TASK.vaultReceive)
  })

  it('refuses a preview token that is spent or too old, sending nothing', async () => {
    const s = setup({ offers: [offer(OPEN_ROOM, 'open', 'open')] })
    const first = await s.service.previewOffer(offerIdOf(COMMUNITY.did, OPEN_ROOM))
    await s.service.acceptOffer(first.token)
    await expect(s.service.acceptOffer(first.token)).rejects.toBeInstanceOf(RoomsPreviewExpired)

    const again = setup({ offers: [offer(OPEN_ROOM, 'open', 'open')] })
    const old = await again.service.previewOffer(offerIdOf(COMMUNITY.did, OPEN_ROOM))
    again.advance(PREVIEW_TOKEN_TTL_MS + 1)
    await expect(again.service.acceptOffer(old.token)).rejects.toBeInstanceOf(RoomsPreviewExpired)
    expect(again.calls).not.toContain(ROOMS_TASK.offersAccept)
  })

  it('says a sealed offer needs an agent update when the agent cannot join a group', async () => {
    const s = setup({
      offers: [offer(SEALED_ROOM, 'attributed', 'open'), offer(OPEN_ROOM, 'open', 'open')],
      served: [ROOMS_TASK.keysList02, ROOMS_TASK.vaultReceive],
    })
    const err = await s.service.previewOffer(offerIdOf(COMMUNITY.did, SEALED_ROOM)).catch((e) => e)
    expect(err).toBeInstanceOf(RoomsUnavailable)
    expect(err).toMatchObject({ reason: 'agentDoesNotServe' })
    await expect(s.service.previewOffer(offerIdOf(COMMUNITY.did, OPEN_ROOM))).resolves.toBeDefined()
  })

  it('says a sealed offer needs an agent update when the agent cannot complete the accept as the member', async () => {
    const s = setup({
      offers: [offer(SEALED_ROOM, 'attributed', 'open')],
      served: ALL_SERVED.filter((t) => t !== ROOMS_TASK.keysAct06),
    })
    const err = await s.service.previewOffer(offerIdOf(COMMUNITY.did, SEALED_ROOM)).catch((e) => e)
    expect(err).toMatchObject({ name: 'RoomsUnavailable', reason: 'agentDoesNotServe' })
    // Named at the newest version this client speaks.
    expect((err as Error).message).toContain(ROOMS_TASK.keysAct09)
  })

  it('needs the agent’s vault to accept at all', async () => {
    const s = setup({ served: [ROOMS_TASK.keysList02] })
    expect((await s.service.capabilities()).acceptOffer).toMatchObject({
      status: 'unavailable',
      reason: 'agentDoesNotServe',
    })
    expect((await s.service.capabilities()).listOffers).toMatchObject({ status: 'available' })
  })

  it('refuses an offer the community no longer lists', async () => {
    const s = setup({ offers: [] })
    await expect(s.service.previewOffer(offerIdOf(COMMUNITY.did, OPEN_ROOM))).rejects.toMatchObject({
      name: 'RoomsRefused',
      code: 'notFound',
    })
    await expect(s.service.previewOffer('not-an-offer')).rejects.toMatchObject({ code: 'notFound' })
  })

  it('hides an offer on this phone only', async () => {
    const s = setup({ offers: [offer(OPEN_ROOM, 'open', 'open')] })
    const offerId = offerIdOf(COMMUNITY.did, OPEN_ROOM)
    await s.service.hideOffer(offerId)
    expect(s.b.hideOffer).toHaveBeenCalledWith(offerId)
    expect(await s.service.listOffers()).toEqual([])
    expect(s.calls).not.toContain(ROOMS_TASK.offersAccept)
  })
})

// The agent's key list is one read shared by every caller while it is in flight (#725). An accept must never be
// answered from, or leave behind, a read that left before the room was held.
describe('the shared key-list read across an accept', () => {
  /** Holds every key-list answer until released; returns the release. */
  const gateKeyList = (s: ReturnType<typeof setup>) => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const answer = s.agentTask.getMockImplementation()!
    s.agentTask.mockImplementation(async (type: string, payload: Record<string, unknown>) => {
      if (type === ROOMS_TASK.keysList02) await gate
      return answer(type, payload)
    })
    return release
  }
  const keyListAsks = (s: ReturnType<typeof setup>) => sent(s.agentTask, ROOMS_TASK.keysList02).length
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('a read asked before an accept is not joined after it: the next listing asks again', async () => {
    const s = setup({ offers: [offer(OPEN_ROOM, 'open', 'open'), offer(SEALED_ROOM, 'attributed', 'accepted')] })
    const preview = await s.service.previewOffer(offerIdOf(COMMUNITY.did, OPEN_ROOM))
    const release = gateKeyList(s)
    const before = keyListAsks(s)

    const first = s.service.listOffers() // asks the key list for the accepted sealed offer, and waits
    await settle()
    expect(await s.service.acceptOffer(preview.token)).toEqual({ roomId: OPEN_ROOM })
    const second = s.service.listOffers()
    await settle()

    expect(keyListAsks(s) - before).toBe(2)
    release()
    await Promise.all([first, second])
  })

  it('the accept asks whether the room is held afresh, never from a read already in flight', async () => {
    const s = setup({ offers: [offer(SEALED_ROOM, 'attributed', 'accepted')] })
    const preview = await s.service.previewOffer(offerIdOf(COMMUNITY.did, SEALED_ROOM))
    const release = gateKeyList(s)
    const before = keyListAsks(s)
    // The read in flight is the rooms list's (an offers listing would hold back the offer being accepted).
    const answer = s.communityTask.getMockImplementation()!
    s.communityTask.mockImplementation(async (did: string, type: string, payload: Record<string, unknown>) =>
      type === ROOMS_TASK.membershipsList ? { items: [] } : answer(did, type, payload)
    )

    const listing = s.service.listMyRooms()
    await settle()
    const accepting = s.service.acceptOffer(preview.token)
    await settle()

    expect(keyListAsks(s) - before).toBe(2)
    release()
    expect(await accepting).toEqual({ roomId: SEALED_ROOM })
    await listing
  })
})
