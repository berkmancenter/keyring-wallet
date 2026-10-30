import { AgentRoomsService, postKey, type RoomsBackend, type RoomsCommunity } from '../real/agentRoomsService'
import { KEYS_ACT_TYPES, ROOMS_TASK } from '../real/wire'
import { chatMessageBody } from '../roomPosts'
import {
  NOTE_BODY_MAX,
  PREVIEW_TOKEN_TTL_MS,
  RoomsConflict,
  RoomsPreviewExpired,
  RoomsRefused,
  RoomsUnavailable,
} from '../types'

const COMMUNITY: RoomsCommunity = { did: 'did:webvh:community:a', name: 'Garden club', personaDid: 'did:key:persona-a' }
const HOST = COMMUNITY.did
const OPEN_ROOM = 'did:webvh:room:open1'
const SEALED_ROOM = 'did:webvh:room:attributed1'
const READ_ONLY_ROOM = 'did:webvh:room:readonly1'
const PRIVATE_ROOM = 'did:webvh:room:private1'

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

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url')

const SERVED = [
  ROOMS_TASK.keysList02,
  ROOMS_TASK.keysBrowse,
  ROOMS_TASK.keysRead,
  ROOMS_TASK.keysAct06,
  ROOMS_TASK.keysSeal02,
]

interface Setup {
  served?: string[]
  /** The version `rooms/keys/read` answers with, by key; a key absent here is `notFound`. */
  versions?: Record<string, number>
  /** The host's answer to a delivered document. */
  host?: (document: Record<string, unknown>) => unknown
  /** Who the agent says it acted as. */
  principal?: string
  /** The newest version among the room's records, as `rooms/keys/browse` lists them; none when absent. */
  head?: number
  /** The agent's answer to `rooms/keys/seal/0.2`. */
  seal?: (payload: Record<string, unknown>) => unknown
}

function setup(o: Setup = {}) {
  // Shared with the test, so a host answer can move a note on as another member would.
  const versions: Record<string, number> = o.versions ?? {}
  const agentTask = jest.fn(async (type: string, payload: Record<string, unknown>): Promise<unknown> => {
    switch (type) {
      case ROOMS_TASK.keysList02:
        return { rooms: [] }
      case ROOMS_TASK.keysBrowse:
        return { records: o.head ? [{ key: 'note/older', version: o.head }] : [] }
      case ROOMS_TASK.keysSeal02:
        if (o.seal) return o.seal(payload)
        return { sealed: { ciphertext: `sealed:${String(payload.plaintext)}`, nonce: 'nonce', epoch: 2 } }
      case ROOMS_TASK.keysRead: {
        const version = versions[String(payload.key)]
        if (version === undefined) throw new FakeRefusal('taskFailed', { code: 'rooms/keys/read:notFound' })
        return {
          key: payload.key,
          version,
          status: 'active',
          plaintext: b64url(JSON.stringify({ title: 'Agenda', body: 'Bring seeds' })),
        }
      }
      case ROOMS_TASK.keysAct09:
      case ROOMS_TASK.keysAct08:
      case ROOMS_TASK.keysAct06:
      case ROOMS_TASK.keysAct05: {
        // The agent completes the request as the member: the presentation and the proof added, nothing else.
        const document = payload.document as Record<string, unknown>
        const principal = o.principal ?? COMMUNITY.personaDid
        return {
          principal,
          document: {
            ...document,
            issuer: principal,
            payload: { ...(document.payload as Record<string, unknown>), presentation: { type: 'presentation' } },
            proof: { type: 'DataIntegrityProof' },
          },
        }
      }
      default:
        throw new Error(`unexpected agent task ${type}`)
    }
  })
  const communityTask = jest.fn(async (_did: string, type: string): Promise<unknown> => {
    if (type !== ROOMS_TASK.membershipsList) throw new Error(`unexpected community task ${type}`)
    return {
      items: [
        {
          roomId: OPEN_ROOM,
          host: HOST,
          label: 'Seed swap',
          visibility: 'open',
          actions: ['read', 'write', 'curate'],
          state: 'admitted',
        },
        { roomId: SEALED_ROOM, host: HOST, visibility: 'attributed', actions: ['read', 'write'], state: 'admitted' },
        { roomId: READ_ONLY_ROOM, host: HOST, visibility: 'open', actions: ['read'], state: 'admitted' },
        { roomId: PRIVATE_ROOM, host: HOST, visibility: 'private', actions: ['read', 'write'], state: 'admitted' },
      ],
    }
  })
  const sendCompleted = jest.fn(
    async (_did: string, _recipient: string, document: Record<string, unknown>): Promise<unknown> => {
      if (o.host) return o.host(document)
      const payload = document.payload as Record<string, unknown>
      if (document.type === ROOMS_TASK.recordsCurate)
        return { key: payload.key, version: 9, status: payload.status ?? 'active', pinned: payload.pinned }
      return { key: payload.key, version: (versions[String(payload.key)] ?? 0) + 1, epoch: 1 }
    }
  )
  let clock = 1_000_000
  let ids = 0
  const b: RoomsBackend = {
    agentLinked: () => true,
    agentServedTypes: async () => o.served ?? SERVED,
    agentTask,
    communities: async () => [COMMUNITY],
    communityTask,
    sendCompleted,
    newId: () => `id-${++ids}`,
    leaveCommunity: jest.fn(async () => undefined),
    decodeBase64Url: (s) => Buffer.from(s, 'base64url').toString('utf8'),
    encodeBase64Url: (text) => b64url(text),
    hiddenOffers: async () => [],
    hideOffer: jest.fn(async () => undefined),
    warn: jest.fn(),
  }
  const service = new AgentRoomsService(b, undefined, { now: () => clock })
  return {
    service,
    agentTask,
    sendCompleted,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

interface ActedDocument {
  type: string
  payload: Record<string, unknown>
}
/** The documents the service asked the agent to complete, in order. */
const acted = (agentTask: jest.Mock): ActedDocument[] =>
  agentTask.mock.calls
    .filter((c) => (KEYS_ACT_TYPES as readonly string[]).includes(c[0]))
    .map((c) => (c[1] as { document: ActedDocument }).document)

describe('AgentRoomsService writes', () => {
  it('previews a note without sending anything, naming who it is written as and who can read it', async () => {
    const { service, agentTask, sendCompleted } = setup()
    const preview = await service.prepareWrite(OPEN_ROOM, { title: 'Agenda', body: 'Bring <b>seeds</b>' })

    expect(preview).toMatchObject({
      roomId: OPEN_ROOM,
      tier: 'open',
      actingAs: { did: COMMUNITY.personaDid },
      visibleTo: 'membersAndHost',
      authorShown: true,
    })
    expect(String(preview.roomName)).toBe('Seed swap')
    expect(String(preview.body)).toBe('Bring <b>seeds</b>') // inert: kept as text
    expect(acted(agentTask)).toHaveLength(0)
    expect(sendCompleted).not.toHaveBeenCalled()
  })

  it('writes a new note: completed as the member by the agent, sent to the host unchanged, create-only', async () => {
    const { service, agentTask, sendCompleted } = setup()
    const preview = await service.prepareWrite(OPEN_ROOM, { title: 'Agenda', body: 'Bring seeds' })
    expect(await service.confirmWrite(preview.token)).toEqual({ key: 'note/id-1', version: 1 })

    expect(agentTask).toHaveBeenCalledWith(ROOMS_TASK.keysAct06, {
      document: {
        id: 'urn:uuid:id-2',
        type: ROOMS_TASK.recordsPut,
        issuer: COMMUNITY.personaDid,
        recipient: HOST,
        issuedAt: new Date(1_000_000).toISOString(),
        payload: {
          roomId: OPEN_ROOM,
          key: 'note/id-1',
          expectedVersion: 0,
          cleartext: { title: 'Agenda', body: 'Bring seeds' },
        },
      },
    })
    const [, , delivered] = sendCompleted.mock.calls[0]
    expect(sendCompleted).toHaveBeenCalledWith(COMMUNITY.did, HOST, delivered)
    expect(delivered).toMatchObject({
      issuer: COMMUNITY.personaDid,
      proof: { type: 'DataIntegrityProof' },
      payload: { presentation: { type: 'presentation' } },
    })
  })

  it('leaves out an empty title', async () => {
    const { service, agentTask } = setup()
    await service.confirmWrite((await service.prepareWrite(OPEN_ROOM, { title: '  ', body: 'Just a body' })).token)
    expect(acted(agentTask)[0].payload.cleartext).toEqual({ body: 'Just a body' })
  })

  it('replaces a note only at the version the preview read', async () => {
    const { service, agentTask } = setup({ versions: { 'note/abc': 3 } })
    const preview = await service.prepareWrite(OPEN_ROOM, { title: 'Agenda', body: 'v4', replaceKey: 'note/abc' })
    expect(await service.confirmWrite(preview.token)).toEqual({ key: 'note/abc', version: 4 })
    expect(acted(agentTask)[0].payload).toMatchObject({ key: 'note/abc', expectedVersion: 3 })
  })

  it('reports a note that changed since the preview as a conflict, with its current version', async () => {
    const versions = { 'note/abc': 3 }
    const s = setup({
      versions,
      host: () => {
        versions['note/abc'] = 5 // another member wrote it meanwhile
        throw new FakeRefusal('taskFailed', { reason: 'conflict' })
      },
    })
    const preview = await s.service.prepareWrite(OPEN_ROOM, { title: '', body: 'mine', replaceKey: 'note/abc' })
    const err = await s.service.confirmWrite(preview.token).catch((e) => e)
    expect(err).toBeInstanceOf(RoomsConflict)
    expect(err).toMatchObject({ key: 'note/abc', currentVersion: 5 })
  })

  it('passes any other refusal from the host on by its code', async () => {
    const s = setup({
      host: () => {
        throw new FakeRefusal('taskFailed', { code: 'rooms/records/put:recordTooLarge' })
      },
    })
    const preview = await s.service.prepareWrite(OPEN_ROOM, { title: '', body: 'big' })
    const err = await s.service.confirmWrite(preview.token).catch((e) => e)
    expect(err).toBeInstanceOf(RoomsRefused)
    expect(err).toMatchObject({ operation: 'write', code: 'recordTooLarge', retryable: false })
  })

  it('passes the agent’s refusal on and delivers nothing', async () => {
    const s = setup()
    const preview = await s.service.prepareWrite(OPEN_ROOM, { title: '', body: 'hello' })
    s.agentTask.mockImplementationOnce(async () => {
      throw new FakeRefusal('taskFailed', { code: 'rooms/keys/act:actionNotHeld' })
    })
    const err = await s.service.confirmWrite(preview.token).catch((e) => e)
    expect(err).toMatchObject({ name: 'RoomsRefused', operation: 'write', code: 'actionNotHeld' })
    expect(s.sendCompleted).not.toHaveBeenCalled()
  })

  it('sends nothing the agent completed as anyone but the member', async () => {
    const s = setup({ principal: 'did:key:someone-else' })
    const preview = await s.service.prepareWrite(OPEN_ROOM, { title: '', body: 'hello' })
    await expect(s.service.confirmWrite(preview.token)).rejects.toThrow(/did not complete/)
    expect(s.sendCompleted).not.toHaveBeenCalled()
  })

  it('refuses a preview token that is spent or too old, sending nothing', async () => {
    const s = setup()
    const first = await s.service.prepareWrite(OPEN_ROOM, { title: '', body: 'one' })
    await s.service.confirmWrite(first.token)
    await expect(s.service.confirmWrite(first.token)).rejects.toBeInstanceOf(RoomsPreviewExpired)

    const old = await s.service.prepareWrite(OPEN_ROOM, { title: '', body: 'two' })
    s.advance(PREVIEW_TOKEN_TTL_MS + 1)
    await expect(s.service.confirmWrite(old.token)).rejects.toBeInstanceOf(RoomsPreviewExpired)
    expect(s.sendCompleted).toHaveBeenCalledTimes(1)
  })

  it('holds a note to the wallet’s caps before anything is sent', async () => {
    const s = setup()
    await expect(s.service.prepareWrite(OPEN_ROOM, { title: '', body: '   ' })).rejects.toMatchObject({ code: 'empty' })
    await expect(
      s.service.prepareWrite(OPEN_ROOM, { title: '', body: 'x'.repeat(NOTE_BODY_MAX + 1) })
    ).rejects.toMatchObject({ code: 'tooLong' })
    await expect(
      s.service.prepareWrite(OPEN_ROOM, { title: '', body: 'x'.repeat(NOTE_BODY_MAX) })
    ).resolves.toBeDefined()
    expect(s.sendCompleted).not.toHaveBeenCalled()
  })

  it('refuses to replace a note the host does not have', async () => {
    const s = setup()
    await expect(
      s.service.prepareWrite(OPEN_ROOM, { title: '', body: 'x', replaceKey: 'note/gone' })
    ).rejects.toMatchObject({ name: 'RoomsRefused', code: 'notFound' })
  })

  it('does not write to a private room yet, nor where the member may only read', async () => {
    const s = setup()
    const sealed = await s.service.prepareWrite(PRIVATE_ROOM, { title: '', body: 'x' }).catch((e) => e)
    expect(sealed).toBeInstanceOf(RoomsUnavailable)
    expect(sealed).toMatchObject({ reason: 'tierNotYet' })
    await expect(s.service.prepareWrite(READ_ONLY_ROOM, { title: '', body: 'x' })).rejects.toMatchObject({
      reason: 'noRight',
    })
  })

  it('needs an agent that completes requests as the member', async () => {
    const s = setup({ served: SERVED.filter((t) => t !== ROOMS_TASK.keysAct06) })
    expect((await s.service.capabilities()).write).toMatchObject({ status: 'unavailable', reason: 'agentDoesNotServe' })
    await expect(s.service.prepareWrite(OPEN_ROOM, { title: '', body: 'x' })).rejects.toMatchObject({
      reason: 'agentDoesNotServe',
    })
  })

  it('completes at act 0.5 for an agent without 0.6', async () => {
    const s = setup({ served: [...SERVED.filter((t) => t !== ROOMS_TASK.keysAct06), ROOMS_TASK.keysAct05] })
    s.agentTask.mockImplementation(async (type: string, payload: Record<string, unknown>) => {
      if (type === ROOMS_TASK.keysList02) return { rooms: [] }
      if (type !== ROOMS_TASK.keysAct05) throw new Error(`unexpected agent task ${type}`)
      const document = payload.document as Record<string, unknown>
      return { principal: COMMUNITY.personaDid, document: { ...document, proof: { type: 'DataIntegrityProof' } } }
    })
    const preview = await s.service.prepareWrite(OPEN_ROOM, { title: '', body: 'x' })
    await expect(s.service.confirmWrite(preview.token)).resolves.toEqual({ key: 'note/id-1', version: 1 })
  })
})

describe('rooms/keys/act, at the version the agent serves', () => {
  const WITHOUT_ACT = SERVED.filter((t) => t !== ROOMS_TASK.keysAct06)
  const V = (v: string) => `https://trusttasks.org/spec/rooms/keys/act/${v}`

  /**
   * An agent answering as `rooms/keys/act` does at 0.5, 0.6, 0.8 and 0.9 alike (trust-tasks-tf specs/rooms/keys/act,
   * one request and response schema at each): the document back with `issuer` set to the member, the presentation
   * inserted, the member's proof, and when the presentation lapses. Any other agent task is refused as unserved.
   */
  function agentServing(s: ReturnType<typeof setup>, act: string) {
    s.agentTask.mockImplementation(async (type: string, payload: Record<string, unknown>) => {
      if (type === ROOMS_TASK.keysList02) return { rooms: [] }
      if (type !== act) throw new FakeRefusal('unsupportedType')
      const document = payload.document as Record<string, unknown>
      return {
        principal: COMMUNITY.personaDid,
        document: {
          ...document,
          issuer: COMMUNITY.personaDid,
          payload: {
            ...(document.payload as Record<string, unknown>),
            presentation: { type: 'VerifiablePresentation' },
          },
          proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', proofPurpose: 'authentication' },
        },
        expiresAt: '2026-11-01T00:00:00Z',
      }
    })
  }

  it.each([
    ['VTA 0.68 and the 10-30 nightly: 0.8 only', [V('0.8')], V('0.8'), ROOMS_TASK.recordsPut03],
    ['upstream main: 0.8 and 0.9', [V('0.8'), V('0.9')], V('0.9'), ROOMS_TASK.recordsPut03],
    ['released 0.67: 0.1, 0.5 and 0.8', [V('0.1'), V('0.5'), V('0.8')], V('0.8'), ROOMS_TASK.recordsPut03],
    ['the lab pin: 0.5 and 0.6', [V('0.5'), V('0.6')], V('0.6'), ROOMS_TASK.recordsPut],
    ['an older agent: 0.5 only', [V('0.5')], V('0.5'), ROOMS_TASK.recordsPut],
  ])('%s: posts and curates at the newest version it serves', async (_label, act, asked, put) => {
    const s = setup({ served: [...WITHOUT_ACT, ...act] })
    agentServing(s, asked)
    expect((await s.service.capabilities()).write).toMatchObject({ status: 'available' })
    const preview = await s.service.prepareWrite(OPEN_ROOM, { title: '', body: 'x' })
    await expect(s.service.confirmWrite(preview.token)).resolves.toEqual({ key: 'note/id-1', version: 1 })
    await s.service.curate(OPEN_ROOM, 'note/abc', 'pin')
    const asks = s.agentTask.mock.calls.filter((c) => c[0] !== ROOMS_TASK.keysList02)
    expect(asks.map((c) => c[0])).toEqual([asked, asked])
    // The request is the same at every version: the unsigned document, no presentation and no proof.
    const sent = asks[0][1] as { document: Record<string, unknown> }
    expect(Object.keys(sent)).toEqual(['document'])
    // Put at the version that act completes: 0.3 from act 0.8, which hosts from VTA 0.68 serve; 0.1 before it.
    expect(sent.document).toMatchObject({ type: put, issuer: COMMUNITY.personaDid, recipient: HOST })
    expect((asks[1][1] as { document: Record<string, unknown> }).document.type).toBe(ROOMS_TASK.recordsCurate)
    expect(sent.document).not.toHaveProperty('proof')
    expect(sent.document.payload).not.toHaveProperty('presentation')
    // What the host gets is the agent's completed document, unchanged.
    expect(s.sendCompleted.mock.calls[0][2]).toMatchObject({
      issuer: COMMUNITY.personaDid,
      proof: { proofPurpose: 'authentication' },
      payload: { presentation: { type: 'VerifiablePresentation' } },
    })
  })

  /** A host serving `rooms/records/put` only at `versions`, as VTC 0.12 (0.1), 0.15 (both) and 0.16 (0.3) do. */
  const hostServing = (versions: () => string[]) => (document: Record<string, unknown>) => {
    if (!versions().includes(String(document.type))) throw new FakeRefusal('unsupportedVersion')
    const payload = document.payload as Record<string, unknown>
    return { key: payload.key, version: 1, epoch: 1 }
  }
  const putsSent = (s: ReturnType<typeof setup>) =>
    s.sendCompleted.mock.calls.map((c) => (c[2] as { type: string }).type)
  const post = async (s: ReturnType<typeof setup>) =>
    s.service.confirmWrite((await s.service.prepareWrite(OPEN_ROOM, { title: '', body: 'x' })).token)

  it('a host that serves only put 0.1 (VTC 0.12) is sent 0.1 after refusing 0.3, and 0.1 straight away after', async () => {
    const s = setup({ served: [...WITHOUT_ACT, V('0.8')], host: hostServing(() => [ROOMS_TASK.recordsPut]) })
    await expect(post(s)).resolves.toMatchObject({ version: 1 })
    await expect(post(s)).resolves.toMatchObject({ version: 1 })
    expect(putsSent(s)).toEqual([ROOMS_TASK.recordsPut03, ROOMS_TASK.recordsPut, ROOMS_TASK.recordsPut])
    // Each document sent is its own: the one sent again after a refusal is completed anew.
    expect(new Set(s.sendCompleted.mock.calls.map((c) => (c[2] as { id: string }).id)).size).toBe(3)
  })

  it('a host that moves on to put 0.3 only (VTC 0.16) is sent 0.3 once 0.1 is refused', async () => {
    let versions: string[] = [ROOMS_TASK.recordsPut]
    const s = setup({ served: [...WITHOUT_ACT, V('0.8')], host: hostServing(() => versions) })
    await post(s)
    versions = [ROOMS_TASK.recordsPut03]
    await expect(post(s)).resolves.toMatchObject({ version: 1 })
    expect(putsSent(s)).toEqual([
      ROOMS_TASK.recordsPut03,
      ROOMS_TASK.recordsPut,
      ROOMS_TASK.recordsPut,
      ROOMS_TASK.recordsPut03,
    ])
  })

  it('control: any other refusal of put 0.3 is not sent again at 0.1', async () => {
    const s = setup({
      served: [...WITHOUT_ACT, V('0.8')],
      host: () => {
        throw new FakeRefusal('taskFailed', { code: 'rooms/records/put:forbidden' })
      },
    })
    await expect(post(s)).rejects.toMatchObject({ code: 'forbidden' })
    expect(putsSent(s)).toEqual([ROOMS_TASK.recordsPut03])
  })

  it('control: an agent before act 0.8 is never asked put 0.3, even by a host that refuses 0.1', async () => {
    const s = setup({ served: [...WITHOUT_ACT, V('0.6')], host: hostServing(() => [ROOMS_TASK.recordsPut03]) })
    await expect(post(s)).rejects.toThrow()
    expect(putsSent(s)).toEqual([ROOMS_TASK.recordsPut])
  })

  it('control: an agent serving only versions Keyring does not speak (0.1, 0.7) cannot post, and nothing is sent', async () => {
    const s = setup({ served: [...WITHOUT_ACT, V('0.1'), V('0.7')] })
    agentServing(s, V('0.7'))
    expect((await s.service.capabilities()).write).toMatchObject({ status: 'unavailable', reason: 'agentDoesNotServe' })
    expect((await s.service.capabilities()).curate).toMatchObject({
      status: 'unavailable',
      reason: 'agentDoesNotServe',
    })
    await expect(s.service.prepareWrite(OPEN_ROOM, { title: '', body: 'x' })).rejects.toMatchObject({
      reason: 'agentDoesNotServe',
    })
    expect(s.sendCompleted).not.toHaveBeenCalled()
  })
})

describe('AgentRoomsService curation', () => {
  it('pins, unpins and retracts through the agent', async () => {
    const { service, agentTask } = setup()
    await service.curate(OPEN_ROOM, 'note/abc', 'pin')
    await service.curate(OPEN_ROOM, 'note/abc', 'unpin')
    await service.curate(OPEN_ROOM, 'note/abc', 'retract')
    expect(acted(agentTask).map((d) => [d.type, d.payload])).toEqual([
      [ROOMS_TASK.recordsCurate, { roomId: OPEN_ROOM, key: 'note/abc', pinned: true }],
      [ROOMS_TASK.recordsCurate, { roomId: OPEN_ROOM, key: 'note/abc', pinned: false }],
      [ROOMS_TASK.recordsCurate, { roomId: OPEN_ROOM, key: 'note/abc', status: 'retracted' }],
    ])
  })

  it('passes the host’s refusal on by its code', async () => {
    const s = setup({
      host: () => {
        throw new FakeRefusal('taskFailed', { code: 'rooms/records/curate:alreadyRetracted' })
      },
    })
    await expect(s.service.curate(OPEN_ROOM, 'note/abc', 'retract')).rejects.toMatchObject({
      name: 'RoomsRefused',
      operation: 'curate',
      code: 'alreadyRetracted',
    })
  })

  it('needs the curate right', async () => {
    const s = setup()
    await expect(s.service.curate(READ_ONLY_ROOM, 'note/abc', 'pin')).rejects.toMatchObject({ reason: 'noRight' })
    expect(s.sendCompleted).not.toHaveBeenCalled()
  })
})

describe('writing, by room tier', () => {
  it('writes in open and attributed rooms, and says writing is not available yet in a private one', async () => {
    const { service } = setup()
    expect((await service.roomCapabilities(OPEN_ROOM)).write).toMatchObject({ status: 'available', reason: 'ok' })
    expect((await service.roomCapabilities(SEALED_ROOM)).write).toMatchObject({ status: 'available', reason: 'ok' })
    expect((await service.roomCapabilities(PRIVATE_ROOM)).write).toMatchObject({
      status: 'comingSoon',
      reason: 'tierNotYet',
    })
    // Reading a sealed room is unchanged.
    expect((await service.roomCapabilities(SEALED_ROOM)).listNotes.status).toBe('available')
  })

  it('needs an agent that signs and seals as the member to write in an attributed room, not in an open one', async () => {
    const { service } = setup({ served: SERVED.filter((t) => t !== ROOMS_TASK.keysSeal02) })
    expect((await service.roomCapabilities(SEALED_ROOM)).write).toMatchObject({
      status: 'unavailable',
      reason: 'agentDoesNotServe',
    })
    expect((await service.roomCapabilities(OPEN_ROOM)).write).toMatchObject({ status: 'available' })
  })

  it('names a missing right before the tier: a read-only member is told they may not post', async () => {
    const { service } = setup()
    expect((await service.roomCapabilities(READ_ONLY_ROOM)).write).toMatchObject({ reason: 'noRight' })
  })
})

describe('a post sent again', () => {
  it('takes its key from its idempotency key: the same on every retry, its own per post, opaque', async () => {
    expect(postKey('post-1')).toBe(postKey('post-1'))
    expect(postKey('post-1')).not.toBe(postKey('post-2'))
    expect(postKey('post-1')).toMatch(/^note\/[0-9a-f]{32}$/)
    expect(postKey('post-1')).not.toContain('post-1')

    const { service, agentTask } = setup()
    const preview = await service.prepareWrite(OPEN_ROOM, { title: '', body: 'hi', idempotencyKey: 'post-1' })
    expect(await service.confirmWrite(preview.token)).toEqual({ key: postKey('post-1'), version: 1 })
    expect(acted(agentTask)[0].payload).toMatchObject({ key: postKey('post-1'), expectedVersion: 0 })
  })

  // The host stores what it is sent; the first answer never reaches the phone.
  const lossyHost = () => {
    const versions: Record<string, number> = {}
    let answers = 0
    const host = (document: Record<string, unknown>) => {
      const { key, expectedVersion } = document.payload as { key: string; expectedVersion: number }
      if ((versions[key] ?? 0) !== expectedVersion) throw new FakeRefusal('taskFailed', { reason: 'conflict' })
      versions[key] = (versions[key] ?? 0) + 1
      if (answers++ === 0) throw new Error('the community did not answer within 30 s')
      return { key, version: versions[key], epoch: 1 }
    }
    return { versions, host }
  }

  it('after a lost answer, meets the post already there and resolves to it: one record, not two', async () => {
    const { versions, host } = lossyHost()
    const { service } = setup({ versions, host })
    const draft = { title: '', body: 'hello', idempotencyKey: 'post-1' }

    await expect(service.confirmWrite((await service.prepareWrite(OPEN_ROOM, draft)).token)).rejects.toThrow(
      'did not answer'
    )
    expect(await service.confirmWrite((await service.prepareWrite(OPEN_ROOM, draft)).token)).toEqual({
      key: postKey('post-1'),
      version: 1,
    })
    expect(Object.keys(versions)).toEqual([postKey('post-1')])
  })

  it('without an idempotency key, the same retry posts twice (the control for the one above)', async () => {
    const { versions, host } = lossyHost()
    const { service } = setup({ versions, host })
    const draft = { title: '', body: 'hello' }

    await expect(service.confirmWrite((await service.prepareWrite(OPEN_ROOM, draft)).token)).rejects.toThrow()
    await service.confirmWrite((await service.prepareWrite(OPEN_ROOM, draft)).token)
    expect(Object.keys(versions)).toHaveLength(2)
  })

  it('refuses a post carrying a file, sending nothing: files are not built', async () => {
    const { service, agentTask, sendCompleted } = setup()
    const err = await service
      .prepareWrite(OPEN_ROOM, {
        title: '',
        body: 'see attached',
        attachment: { name: 'a.pdf', mimeType: 'application/pdf', size: 3, uri: 'file:///a.pdf' },
      })
      .catch((e) => e)
    expect(err).toBeInstanceOf(RoomsUnavailable)
    expect(err).toMatchObject({ reason: 'clientNotBuilt' })
    expect(acted(agentTask)).toEqual([])
    expect(sendCompleted).not.toHaveBeenCalled()
  })
})

describe('a long post', () => {
  const NOW = new Date(1_000_000)
  // As the composer sends it: the words inside a keyring.chat/1 message, whose JSON escapes each quote and line break.
  const post = (text: string) => ({ title: '', body: chatMessageBody(text, '01HZZZZZZZZZZZZZZZZZZZZZZZ', NOW) })

  it('is held to the composer’s limit on its words, not on the message around them', async () => {
    const { service } = setup()
    const text = '"\n'.repeat(Math.floor(NOTE_BODY_MAX / 2)) // NOTE_BODY_MAX characters, nearly twice that escaped
    expect(post(text).body.length).toBeGreaterThan(NOTE_BODY_MAX)
    await expect(service.prepareWrite(OPEN_ROOM, post(text))).resolves.toMatchObject({ roomId: OPEN_ROOM })
  })

  it('and still refused past it', async () => {
    const { service } = setup()
    await expect(service.prepareWrite(OPEN_ROOM, post('x'.repeat(NOTE_BODY_MAX + 1)))).rejects.toMatchObject({
      code: 'tooLong',
    })
  })
})

describe('writing to an attributed room', () => {
  /** A host assigning versions from one room-wide counter, starting after `head`; `takenBy` writes land first. */
  const countingHost = (head: number, takenBy: number[] = []) => {
    let next = head
    let attempt = 0
    return (document: Record<string, unknown>) => {
      next += 1 + (takenBy[attempt++] ?? 0)
      return { key: (document.payload as { key: string }).key, version: next, epoch: 2 }
    }
  }
  const sealCalls = (agentTask: jest.Mock) =>
    agentTask.mock.calls.filter((c) => c[0] === ROOMS_TASK.keysSeal02).map((c) => c[1] as Record<string, unknown>)
  const bodyOf = (seal: Record<string, unknown>) =>
    JSON.parse(Buffer.from(String(seal.plaintext), 'base64url').toString('utf8')) as Record<string, unknown>

  it('previews a note readable by the members only', async () => {
    const { service } = setup()
    const preview = await service.prepareWrite(SEALED_ROOM, { title: '', body: 'x' })
    expect(preview).toMatchObject({ tier: 'attributed', visibleTo: 'members', actingAs: { did: COMMUNITY.personaDid } })
  })

  it('has the agent sign the body as the member and seal it for the next version, then puts only the sealed form', async () => {
    const { service, agentTask } = setup({ head: 7, host: countingHost(7) })
    const preview = await service.prepareWrite(SEALED_ROOM, { title: 'Agenda', body: 'Bring seeds' })
    expect(await service.confirmWrite(preview.token)).toEqual({ key: 'note/id-1', version: 8 })

    const [seal] = sealCalls(agentTask)
    expect(seal).toMatchObject({ roomId: SEALED_ROOM, key: 'note/id-1', version: 8, signAsPrincipal: true })
    // Unsigned, naming the member as its author, at the location it is sealed for: the agent adds the proof.
    expect(bodyOf(seal)).toEqual({
      roomId: SEALED_ROOM,
      key: 'note/id-1',
      version: 8,
      author: COMMUNITY.personaDid,
      title: 'Agenda',
      body: 'Bring seeds',
    })
    const [put] = acted(agentTask)
    expect(put.type).toBe(ROOMS_TASK.recordsPut)
    expect(put.payload).toEqual({
      roomId: SEALED_ROOM,
      key: 'note/id-1',
      expectedVersion: 0,
      sealed: { ciphertext: `sealed:${String(seal.plaintext)}`, nonce: 'nonce', epoch: 2 },
    })
    // The host never sees the words.
    expect(JSON.stringify(put.payload)).not.toContain('Bring seeds')
  })

  it('in an empty room, seals for version 1 and leaves out an empty title', async () => {
    const { service, agentTask } = setup({ host: countingHost(0) })
    await service.confirmWrite((await service.prepareWrite(SEALED_ROOM, { title: ' ', body: 'hi' })).token)
    const [seal] = sealCalls(agentTask)
    expect(seal.version).toBe(1)
    expect(bodyOf(seal)).not.toHaveProperty('title')
  })

  it('when another write took the version, seals again for the next and writes over exactly what landed', async () => {
    // One write lands between the read of the head and this one's put.
    const { service, agentTask } = setup({ head: 7, host: countingHost(7, [1]) })
    const preview = await service.prepareWrite(SEALED_ROOM, { title: '', body: 'hi' })
    expect(await service.confirmWrite(preview.token)).toEqual({ key: 'note/id-1', version: 10 })

    expect(sealCalls(agentTask).map((s) => [s.version, bodyOf(s).version])).toEqual([
      [8, 8],
      [10, 10],
    ])
    expect(acted(agentTask).map((d) => d.payload.expectedVersion)).toEqual([0, 9])
  })

  it('stops when the room keeps moving, saying the note does not open, and is retryable', async () => {
    const { service, agentTask } = setup({ head: 1, host: countingHost(1, [1, 1, 1, 1]) })
    const preview = await service.prepareWrite(SEALED_ROOM, { title: '', body: 'hi' })
    const err = await service.confirmWrite(preview.token).catch((e) => e)
    expect(err).toBeInstanceOf(RoomsRefused)
    expect(err).toMatchObject({ operation: 'write', code: 'roomKeptMoving', retryable: true })
    expect(sealCalls(agentTask)).toHaveLength(4)
  })

  it('passes the agent’s refusal to seal on by its code, sending nothing to the host', async () => {
    const { service, sendCompleted } = setup({
      seal: () => {
        throw new FakeRefusal('taskFailed', { code: 'rooms/keys/seal:authorNotPrincipal' })
      },
    })
    const preview = await service.prepareWrite(SEALED_ROOM, { title: '', body: 'hi' })
    await expect(service.confirmWrite(preview.token)).rejects.toMatchObject({
      name: 'RoomsRefused',
      operation: 'write',
      code: 'authorNotPrincipal',
    })
    expect(sendCompleted).not.toHaveBeenCalled()
  })

  it('refuses an answer from the agent that is not a sealed record', async () => {
    const { service, sendCompleted } = setup({ seal: () => ({ sealed: { ciphertext: 'c' } }) })
    const preview = await service.prepareWrite(SEALED_ROOM, { title: '', body: 'hi' })
    await expect(service.confirmWrite(preview.token)).rejects.toThrow('answered the seal')
    expect(sendCompleted).not.toHaveBeenCalled()
  })

  it('after a lost answer, a post sent again meets itself already there and resolves to it', async () => {
    const versions: Record<string, number> = {}
    let answered = false
    const host = (document: Record<string, unknown>) => {
      const { key, expectedVersion } = document.payload as { key: string; expectedVersion: number }
      if ((versions[key] ?? 0) !== expectedVersion) throw new FakeRefusal('taskFailed', { reason: 'conflict' })
      versions[key] = 1
      if (!answered) {
        answered = true
        throw new Error('the community did not answer within 30 s')
      }
      return { key, version: 1, epoch: 2 }
    }
    const { service } = setup({ versions, host })
    const draft = { title: '', body: 'hello', idempotencyKey: 'post-1' }
    await expect(service.confirmWrite((await service.prepareWrite(SEALED_ROOM, draft)).token)).rejects.toThrow(
      'did not answer'
    )
    expect(await service.confirmWrite((await service.prepareWrite(SEALED_ROOM, draft)).token)).toEqual({
      key: postKey('post-1'),
      version: 1,
    })
  })
})
