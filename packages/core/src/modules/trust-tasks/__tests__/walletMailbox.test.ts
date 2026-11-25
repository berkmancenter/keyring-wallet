/**
 * walletMailbox.ts edges the real-agent rows (__tests__/modules/trust-tasks/walletMailbox.credo.test.ts) do not
 * reach: what the mailbox drops, a base64 attachment, how the outbound transport picks the forward's `next`, and two
 * opens for different mediators at once.
 */
import { DidCommMessageReceiver } from '@credo-ts/didcomm'
import { createHash } from 'crypto'

import * as transportModule from '../module/VtiMediatorTransport'
import {
  closeWalletMailbox,
  mailboxAccountKey,
  MEDIATOR_ACCOUNT_UPDATE,
  MEDIATOR_WAKE_REQUEST,
  MEDIATOR_WAKE_SET,
  openWalletMailbox,
  setMailboxWakeHandle,
  takeMailboxMessage,
  walletMailboxOf,
  WalletMailboxOutboundTransport,
} from '../module/walletMailbox'

// Signing needs a real KMS; here the proof is a marker carrying what was asked of the signer.
jest.mock('@bifold/trust-tasks', () => ({
  ...jest.requireActual('@bifold/trust-tasks'),
  signDocumentProof: jest.fn(
    async (_agent: unknown, document: Record<string, unknown>, did: string, options?: { proofPurpose?: string }) => ({
      ...document,
      proof: {
        type: 'DataIntegrityProof',
        verificationMethod: `${did}#key-1`,
        proofPurpose: options?.proofPurpose ?? 'assertionMethod',
        proofValue: 'z-test',
      },
    })
  ),
}))

const FORWARD = 'https://didcomm.org/routing/2.0/forward'
const MEDIATOR = 'did:peer:2.mediator'
const OTHER_MEDIATOR = 'did:peer:2.other-mediator'
const PEER_MAILBOX = 'did:peer:2.peer-mailbox'
const OTHER_MAILBOX = 'did:peer:2.other-mailbox'

const names = (uri: string) => ({ service: [{ serviceEndpoint: { uri, accept: ['didcomm/v2'] } }] })

/** DID documents as this phone would resolve them. */
const DOCS: Record<string, unknown> = {
  // A mailbox contact: contact → its mailbox → the mediator the mailbox signs in at.
  'did:peer:2.peer-contact': names(PEER_MAILBOX),
  [PEER_MAILBOX]: names(MEDIATOR),
  // A peer on another mediator, set up the same way.
  'did:peer:2.cross-contact': names(OTHER_MAILBOX),
  [OTHER_MAILBOX]: names(OTHER_MEDIATOR),
  // A VTA-shaped DID: it names the mediator directly, and a mediator's document names URLs, not a DID.
  'did:peer:2.direct': names(MEDIATOR),
  [MEDIATOR]: { service: [{ serviceEndpoint: { uri: 'https://mediator.example', accept: ['didcomm/v2'] } }] },
  [OTHER_MEDIATOR]: { service: [{ serviceEndpoint: 'https://other.example' }] },
  'did:peer:2.peer-plain': { service: [{ serviceEndpoint: 'https://peer.example' }] },
}
const CONNECTIONS: Record<string, string> = {
  'c-mailbox': 'did:peer:2.peer-contact',
  'c-cross': 'did:peer:2.cross-contact',
  'c-direct': 'did:peer:2.direct',
  'c-plain': 'did:peer:2.peer-plain',
}

function fakeAgent({ created = ['did:peer:2.mine'] }: { created?: string[] } = {}) {
  const receiveMessage = jest.fn(async () => undefined)
  const registerOutboundTransport = jest.fn()
  const kept = (mediatorDid: string) => ({ content: { did: `mailbox-of-${mediatorDid}` } })
  const agent = {
    config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
    dependencyManager: {
      resolve: (token: unknown) => {
        if (token === DidCommMessageReceiver) return { receiveMessage }
        throw new Error(`fake cannot resolve ${String(token)}`)
      },
    },
    dids: {
      getCreatedDids: jest.fn(async ({ did }: { did: string }) => (created.includes(did) ? [{ did }] : [])),
      resolveDidDocument: jest.fn(async (did: string) => DOCS[did] ?? { service: [] }),
    },
    // One kept mailbox DID per mediator, so an open never has to mint (minting needs a real KMS).
    genericRecords: {
      // Asked for one mediator's: that mailbox. Asked for all of them (what an open reads once): one per mediator.
      findAllByQuery: jest.fn(async (q: { mediatorDid?: string }) =>
        q.mediatorDid ? [kept(q.mediatorDid)] : [kept(MEDIATOR), kept(OTHER_MEDIATOR)]
      ),
      save: jest.fn(),
    },
    modules: {
      didcomm: {
        registerOutboundTransport,
        connections: {
          findById: jest.fn(async (id: string) => (CONNECTIONS[id] ? { id, theirDid: CONNECTIONS[id] } : null)),
        },
      },
    },
  }
  return { agent: agent as never, receiveMessage, registerOutboundTransport }
}

const ENVELOPE = 'https://trusttasks.org/binding/didcomm/0.1/envelope'
/**
 * The mediator's answers as v0.53.0 gives them (its bundles' responseSchema): account/update's realised view sits
 * under `account`; wake/set's `wakeCapable` is flat; wake/request answers `{}`.
 */
const answerTo = (document: Record<string, unknown>) => {
  const type = String(document.type)
  if (type === MEDIATOR_ACCOUNT_UPDATE)
    return {
      type: ENVELOPE,
      body: {
        type: `${type}#response`,
        payload: { account: { did: 'x', accountType: 'standard', acl: { sendForwarded: true } } },
      },
    }
  if (type === MEDIATOR_WAKE_SET)
    return { type: ENVELOPE, body: { type: `${type}#response`, payload: { wakeCapable: true } } }
  if (type === MEDIATOR_WAKE_REQUEST) return { type: ENVELOPE, body: { type: `${type}#response`, payload: {} } }
  return { type: ENVELOPE, body: {} }
}

const forward = (next: string, data: Record<string, unknown>) => ({
  id: 'f-1',
  type: FORWARD,
  body: { next },
  attachments: [{ id: 'a-1', data }],
})

const session = () => ({
  start: jest.fn(async () => undefined),
  stop: jest.fn(async () => undefined),
  forwardForMailbox: jest.fn(async () => ({ id: 'id-of-the-inner-bytes' })),
  ask: jest.fn(async (document: Record<string, unknown>) => answerTo(document) as never),
})

beforeEach(() => {
  jest
    .spyOn(transportModule, 'vtiClientIdentityFromDid')
    .mockImplementation(async (_agent, did) => ({ did, kid: `${did}#key-2` }) as never)
})
afterEach(() => jest.restoreAllMocks())

async function opened(agent: never) {
  const s = session()
  await openWalletMailbox(agent, MEDIATOR, {
    resolveMediator: async (_a, did) => ({ did, wsEndpoint: 'wss://m.example/ws' }) as never,
    makeSession: () => s,
  })
  return s
}

describe('the mailbox takes a forward for a DID this phone created, and only that', () => {
  test('a forward for a contact DID this phone created: the message inside goes to Credo’s receiver', async () => {
    const { agent, receiveMessage } = fakeAgent()
    const inner = { protected: 'x', recipients: [] }
    await takeMailboxMessage(agent, forward('did:peer:2.mine', { json: inner }) as never)
    expect(receiveMessage).toHaveBeenCalledWith(inner)
  })

  test('a base64 attachment (url-safe or not) is decoded the same', async () => {
    const { agent, receiveMessage } = fakeAgent()
    const inner = { protected: 'y?>', recipients: [] }
    const b64 = btoa(JSON.stringify(inner))
    await takeMailboxMessage(
      agent,
      forward('did:peer:2.mine', { base64: b64.replace(/\+/g, '-').replace(/\//g, '_') }) as never
    )
    expect(receiveMessage).toHaveBeenCalledWith(inner)
  })

  test('CONTROL: a forward for a DID this phone did not create is dropped', async () => {
    const { agent, receiveMessage } = fakeAgent()
    await takeMailboxMessage(agent, forward('did:peer:2.someone-else', { json: { protected: 'x' } }) as never)
    expect(receiveMessage).not.toHaveBeenCalled()
  })

  test('a forward addressed to the mailbox DID itself is dropped, though this phone created that DID', async () => {
    const { agent, receiveMessage } = fakeAgent({ created: [`mailbox-of-${MEDIATOR}`] })
    await opened(agent)
    await takeMailboxMessage(agent, forward(`mailbox-of-${MEDIATOR}`, { json: { protected: 'x' } }) as never)
    expect(receiveMessage).not.toHaveBeenCalled()
    await closeWalletMailbox(agent)
  })

  test('a forward addressed to a mailbox DID this phone keeps for another mediator is dropped too (read once at open)', async () => {
    const { agent, receiveMessage } = fakeAgent({ created: [`mailbox-of-${OTHER_MEDIATOR}`] })
    await opened(agent)
    await takeMailboxMessage(agent, forward(`mailbox-of-${OTHER_MEDIATOR}`, { json: { protected: 'x' } }) as never)
    expect(receiveMessage).not.toHaveBeenCalled()
    await closeWalletMailbox(agent)
  })

  test('CONTROL: the kept mailboxes are read once at open, not per message', async () => {
    const { agent } = fakeAgent({ created: ['did:peer:2.mine'] })
    await opened(agent)
    const reads = (agent as unknown as { genericRecords: { findAllByQuery: jest.Mock } }).genericRecords.findAllByQuery
    const before = reads.mock.calls.length
    for (let i = 0; i < 3; i++)
      await takeMailboxMessage(agent, forward('did:peer:2.mine', { json: { protected: 'x' } }) as never)
    expect(reads.mock.calls).toHaveLength(before)
    await closeWalletMailbox(agent)
  })

  test('anything that is not a forward is dropped (nobody writes to a mailbox DID directly)', async () => {
    const { agent, receiveMessage } = fakeAgent()
    await takeMailboxMessage(agent, {
      id: 'm',
      type: 'https://didcomm.org/basicmessage/2.0/message',
      body: {},
    } as never)
    expect(receiveMessage).not.toHaveBeenCalled()
  })
})

describe('the forward’s next is a mailbox DID resolved from the peer’s own contact DID document', () => {
  test('Credo’s endpoint is the mediator (it followed contact → mailbox); next is the mailbox the contact names', async () => {
    const { agent, registerOutboundTransport } = fakeAgent()
    const s = await opened(agent)
    await new WalletMailboxOutboundTransport(agent).sendMessage({
      payload: { p: 1 } as never,
      endpoint: MEDIATOR,
      connectionId: 'c-mailbox',
    })
    expect(s.forwardForMailbox).toHaveBeenCalledWith(PEER_MAILBOX, { p: 1 })
    expect(registerOutboundTransport).toHaveBeenCalledTimes(1)
    await closeWalletMailbox(agent)
  })

  test('a peer on another mediator is addressed by its own mailbox DID, never by its mediator', async () => {
    const { agent } = fakeAgent()
    const s = await opened(agent)
    await new WalletMailboxOutboundTransport(agent).sendMessage({
      payload: { p: 2 } as never,
      endpoint: OTHER_MEDIATOR,
      connectionId: 'c-cross',
    })
    expect(s.forwardForMailbox).toHaveBeenCalledWith(OTHER_MAILBOX, { p: 2 })
    await closeWalletMailbox(agent)
  })

  test('CONTROL: a DID endpoint that is another mediator’s, for a peer whose documents lead to no mailbox: refused, nothing forwarded', async () => {
    const { agent } = fakeAgent()
    const s = await opened(agent)
    const transport = new WalletMailboxOutboundTransport(agent)
    await expect(
      transport.sendMessage({ payload: {} as never, endpoint: OTHER_MEDIATOR, connectionId: 'c-plain' })
    ).rejects.toThrow('no mailbox found')
    expect(s.forwardForMailbox).not.toHaveBeenCalled()
    await closeWalletMailbox(agent)
  })

  test('a contact DID that names the mediator directly (not a mailbox): refused', async () => {
    const { agent } = fakeAgent()
    const s = await opened(agent)
    const transport = new WalletMailboxOutboundTransport(agent)
    await expect(
      transport.sendMessage({ payload: {} as never, endpoint: MEDIATOR, connectionId: 'c-direct' })
    ).rejects.toThrow('no mailbox found')
    expect(s.forwardForMailbox).not.toHaveBeenCalled()
    await closeWalletMailbox(agent)
  })

  test('no connection to read the peer from: refused, whatever the endpoint', async () => {
    const { agent } = fakeAgent()
    const s = await opened(agent)
    const transport = new WalletMailboxOutboundTransport(agent)
    await expect(transport.sendMessage({ payload: {} as never, endpoint: PEER_MAILBOX })).rejects.toThrow(
      'no mailbox found'
    )
    expect(s.forwardForMailbox).not.toHaveBeenCalled()
    await closeWalletMailbox(agent)
  })

  test('no mailbox open: refused', async () => {
    const { agent } = fakeAgent()
    const transport = new WalletMailboxOutboundTransport(agent)
    await expect(transport.sendMessage({ payload: {} as never, endpoint: 'did:peer:2.x' })).rejects.toThrow(
      'no mailbox is open'
    )
  })
})

describe('opening', () => {
  test('two opens at once for different mediators: the second gets its own mailbox, and the first one’s session is stopped', async () => {
    const { agent } = fakeAgent()
    const sessions: Record<string, ReturnType<typeof session>> = {}
    const deps = {
      resolveMediator: async (_a: unknown, did: string) => ({ did, wsEndpoint: 'wss://m.example/ws' }) as never,
      makeSession: (_a: unknown, _identity: unknown, mediator: { did: string }) => (sessions[mediator.did] = session()),
    }
    const [a, b] = await Promise.all([
      openWalletMailbox(agent, MEDIATOR, deps),
      openWalletMailbox(agent, OTHER_MEDIATOR, deps),
    ])
    expect(a.mediatorDid).toBe(MEDIATOR)
    expect(b.mediatorDid).toBe(OTHER_MEDIATOR)
    expect(b.did).toBe(`mailbox-of-${OTHER_MEDIATOR}`)
    expect(walletMailboxOf(agent)?.mediatorDid).toBe(OTHER_MEDIATOR)
    expect(sessions[MEDIATOR].stop).toHaveBeenCalled()
    expect(sessions[OTHER_MEDIATOR].start).toHaveBeenCalled()
    await closeWalletMailbox(agent)
  })

  test('CONTROL: two opens at once for the same mediator share one open and one session', async () => {
    const { agent } = fakeAgent()
    const made = jest.fn(() => session())
    const deps = {
      resolveMediator: async (_a: unknown, did: string) => ({ did, wsEndpoint: 'wss://m.example/ws' }) as never,
      makeSession: made,
    }
    const [a, b] = await Promise.all([
      openWalletMailbox(agent, MEDIATOR, deps),
      openWalletMailbox(agent, MEDIATOR, deps),
    ])
    expect(a).toBe(b)
    expect(made).toHaveBeenCalledTimes(1)
    await closeWalletMailbox(agent)
  })
})

describe('the phone’s account at the mediator', () => {
  let warn: jest.SpyInstance
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => warn.mockRestore())
  const warned = () => warn.mock.calls.map((call) => String(call[0]))
  const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex')
  const MAILBOX = `mailbox-of-${MEDIATOR}`
  const deps = (s: ReturnType<typeof session>, extra: Record<string, unknown> = {}) => ({
    resolveMediator: async (_a: unknown, did: string) => ({ did, wsEndpoint: 'wss://m.example/ws' }) as never,
    makeSession: () => s,
    ...extra,
  })

  test('at open, the phone turns on its own forwarding right: a signed account/update naming its account key', async () => {
    const { agent } = fakeAgent()
    const s = await opened(agent)
    expect(s.ask).toHaveBeenCalledTimes(1)
    const [document] = s.ask.mock.calls[0] as [Record<string, unknown>]
    expect(document).toMatchObject({
      type: MEDIATOR_ACCOUNT_UPDATE,
      issuer: MAILBOX,
      recipient: MEDIATOR,
      payload: { did: sha256hex(MAILBOX), acl: { sendForwarded: true } },
      proof: { proofPurpose: 'authentication', verificationMethod: `${MAILBOX}#key-1` },
    })
    expect(typeof document.issuedAt).toBe('string')
    // The account key is the mediator's did_hash: sha256 of the DID, hex.
    expect(mailboxAccountKey(MAILBOX)).toBe(sha256hex(MAILBOX))
    expect(warned()).toEqual([])
    await closeWalletMailbox(agent)
  })

  test('asked at every open, never remembered on the phone: the right lives in the mediator’s account, which a restore can roll back', async () => {
    const { agent } = fakeAgent()
    const first = await opened(agent)
    await closeWalletMailbox(agent)
    const second = await opened(agent)
    expect(first.ask).toHaveBeenCalledTimes(1)
    expect(second.ask).toHaveBeenCalledTimes(1)
    await closeWalletMailbox(agent)
  })

  test('the mailbox does not count as open until the right is answered: nothing mints or sends through it meanwhile', async () => {
    const { agent } = fakeAgent()
    const s = session()
    // The ask itself is the signal: its resolver is assigned in the same callback that signals, so the assertion
    // holds while the ask is in flight, and if no ask were made this would hang rather than pass. Counting microtask
    // hops would encode the number of awaits on the path, which changes.
    let askCalled: () => void = () => undefined
    const asked = new Promise<void>((resolve) => (askCalled = resolve))
    let answer: (value: unknown) => void = () => undefined
    s.ask.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve
          askCalled()
        }) as never
    )
    const opening = openWalletMailbox(agent, MEDIATOR, deps(s))
    await asked
    expect(walletMailboxOf(agent)).toBeUndefined()
    answer(answerTo({ type: MEDIATOR_ACCOUNT_UPDATE }))
    await opening
    expect(walletMailboxOf(agent)?.did).toBe(MAILBOX)
    await closeWalletMailbox(agent)
  })

  test('the mediator refusing: the mailbox still opens (for receiving), and it is said', async () => {
    const { agent } = fakeAgent()
    const s = session()
    s.ask.mockRejectedValue(
      new Error(
        '[TrustTasks:VtiMediatorTransport] m.example refused: authorization.acl.not_self_manageable — this account may not change `sendForwarded`'
      )
    )
    await openWalletMailbox(agent, MEDIATOR, deps(s))
    expect(walletMailboxOf(agent)?.did).toBe(MAILBOX)
    // didPrefix keeps 24 characters: the mailbox DID is cut, the short mediator DID is whole.
    expect(warned()).toEqual([
      expect.stringMatching(
        /forwarding not set for mailbox-of-did:peer:2\.me… at did:peer:2\.mediator: .*not_self_manageable/
      ),
    ])
    await closeWalletMailbox(agent)
  })

  test('an answer that does not show the right on is said, and the mailbox still opens', async () => {
    const { agent } = fakeAgent()
    const s = session()
    s.ask.mockResolvedValue({
      type: ENVELOPE,
      body: {
        type: `${MEDIATOR_ACCOUNT_UPDATE}#response`,
        payload: { account: { did: 'x', accountType: 'standard', acl: { sendForwarded: false } } },
      },
    } as never)
    await openWalletMailbox(agent, MEDIATOR, deps(s))
    expect(walletMailboxOf(agent)?.did).toBe(MAILBOX)
    expect(warned()).toEqual([expect.stringMatching(/forwarding not confirmed on/)])
    await closeWalletMailbox(agent)
  })

  test('a non-conformant flat answer with the right on is still read as on: the fallback is defence, not a second blessed shape', () => {
    // v0.53.0's response allows no member but `account` (its bundle's responseSchema), so a flat `acl` can only come
    // from a non-conformant mediator. Tolerated, since the alternative is the false "not confirmed" line this
    // check exists to avoid; pinned here so a later cleanup does not read the fallback as decoration.
    return (async () => {
      const { agent } = fakeAgent()
      const s = session()
      s.ask.mockResolvedValueOnce({
        type: ENVELOPE,
        body: { type: `${MEDIATOR_ACCOUNT_UPDATE}#response`, payload: { acl: { sendForwarded: true } } },
      } as never)
      await openWalletMailbox(agent, MEDIATOR, deps(s))
      expect(walletMailboxOf(agent)?.did).toBe(MAILBOX)
      expect(warned()).toEqual([])
      const infos = (agent as unknown as { config: { logger: { info: jest.Mock } } }).config.logger.info.mock.calls.map(
        (c) => String(c[0])
      )
      expect(infos).toEqual(
        expect.arrayContaining([expect.stringMatching(/forwarding on for mailbox-of-did:peer:2\.me…/)])
      )
      await closeWalletMailbox(agent)
    })()
  })

  test('a wake handle given at open is left at the mediator with a signed wake/set, after the forwarding right', async () => {
    const { agent } = fakeAgent()
    const s = session()
    await openWalletMailbox(
      agent,
      MEDIATOR,
      deps(s, { wakeHandle: async () => ({ gateway: 'did:web:gateway.example', handle: 'wh_1' }) })
    )
    expect(s.ask).toHaveBeenCalledTimes(2)
    const [second] = s.ask.mock.calls[1] as [Record<string, unknown>]
    expect(second).toMatchObject({
      type: MEDIATOR_WAKE_SET,
      issuer: MAILBOX,
      payload: { wakeHandle: { gateway: 'did:web:gateway.example', handle: 'wh_1' } },
      proof: { proofPurpose: 'authentication' },
    })
    await closeWalletMailbox(agent)
  })

  test('CONTROL: no handle at open (none yet) leaves nothing; setMailboxWakeHandle later leaves it, and clears it with no handle', async () => {
    const { agent } = fakeAgent()
    const s = session()
    await openWalletMailbox(agent, MEDIATOR, deps(s, { wakeHandle: async () => undefined }))
    expect(s.ask).toHaveBeenCalledTimes(1) // the forwarding right only
    await expect(setMailboxWakeHandle(agent, { gateway: 'did:web:gateway.example', handle: 'wh_2' })).resolves.toBe(
      true
    )
    await expect(setMailboxWakeHandle(agent)).resolves.toBe(true)
    expect(s.ask).toHaveBeenCalledTimes(3)
    expect((s.ask.mock.calls[1] as [Record<string, unknown>])[0].payload).toEqual({
      wakeHandle: { gateway: 'did:web:gateway.example', handle: 'wh_2' },
    })
    expect((s.ask.mock.calls[2] as [Record<string, unknown>])[0].payload).toEqual({})
    await closeWalletMailbox(agent)
  })

  test('setMailboxWakeHandle with no mailbox open: nothing asked, false', async () => {
    const { agent } = fakeAgent()
    await expect(setMailboxWakeHandle(agent, { gateway: 'did:web:gateway.example', handle: 'wh_3' })).resolves.toBe(
      false
    )
  })
})

describe('after a mailbox send, the recipient’s mediator is asked for a wake', () => {
  const MAILBOX = `mailbox-of-${MEDIATOR}`
  const deps = (s: ReturnType<typeof session>) => ({
    resolveMediator: async (_a: unknown, did: string) => ({ did, wsEndpoint: 'wss://m.example/ws' }) as never,
    makeSession: () => s,
  })
  const send = (agent: never, connectionId = 'c-mailbox') =>
    new WalletMailboxOutboundTransport(agent).sendMessage({
      payload: { p: 1 } as never,
      endpoint: MEDIATOR,
      connectionId,
    })

  test('the stored id the session returned is named in a signed wake/request for the recipient’s mailbox', async () => {
    const { agent } = fakeAgent()
    const s = await opened(agent)
    // The open asks for the forwarding right itself (every open, since #1169); only the send's asks are measured.
    s.ask.mockClear()
    await send(agent)
    expect(s.forwardForMailbox).toHaveBeenCalledWith(PEER_MAILBOX, { p: 1 })
    await new Promise((resolve) => setImmediate(resolve))
    expect(s.ask).toHaveBeenCalledTimes(1)
    const [document] = s.ask.mock.calls[0] as [Record<string, unknown>]
    expect(document).toMatchObject({
      type: MEDIATOR_WAKE_REQUEST,
      issuer: MAILBOX,
      recipient: MEDIATOR,
      payload: { addressee: PEER_MAILBOX, msgIds: ['id-of-the-inner-bytes'], urgency: 'interactive' },
      proof: { proofPurpose: 'authentication' },
    })
    await closeWalletMailbox(agent)
  })

  test('CONTROL: the wake is asked after the forward, once, and its refusal does not fail the send', async () => {
    const { agent } = fakeAgent()
    const s = session()
    await openWalletMailbox(agent, MEDIATOR, deps(s))
    s.ask.mockClear()
    const order: string[] = []
    s.forwardForMailbox.mockImplementation(async () => {
      order.push('forward')
      return { id: 'x' }
    })
    s.ask.mockImplementation(async () => {
      order.push('wake')
      throw new Error('[TrustTasks:VtiMediatorTransport] m.example refused: protocol.trust_task.unsupported')
    })
    await expect(send(agent)).resolves.toBeUndefined()
    // The wake is not awaited by the send: let it run before looking.
    await new Promise((resolve) => setImmediate(resolve))
    expect(order).toEqual(['forward', 'wake'])
    await closeWalletMailbox(agent)
  })

  test('CONTROL: a send refused before the forward (no mailbox for the peer) asks for nothing', async () => {
    const { agent } = fakeAgent()
    const s = await opened(agent)
    // The open asks for the forwarding right itself (every open, since #1169); only the send's asks are measured.
    s.ask.mockClear()
    await expect(send(agent, 'c-plain')).rejects.toThrow(/no mailbox found/)
    expect(s.forwardForMailbox).not.toHaveBeenCalled()
    expect(s.ask).not.toHaveBeenCalled()
    await closeWalletMailbox(agent)
  })
})

describe('an open whose session fails to start leaves no session running', () => {
  const deps = (s: ReturnType<typeof session>) => ({
    resolveMediator: async (_a: unknown, did: string) => ({ did, wsEndpoint: 'wss://m.example/ws' }) as never,
    makeSession: () => s,
  })

  test('the session is stopped and the open rejects: a keepOpen session nothing holds must not bring itself back', async () => {
    const { agent } = fakeAgent()
    const s = session()
    s.start.mockRejectedValueOnce(new Error('socket failed to open'))
    await expect(openWalletMailbox(agent, MEDIATOR, deps(s))).rejects.toThrow('socket failed to open')
    expect(s.stop).toHaveBeenCalledTimes(1)
    expect(walletMailboxOf(agent)).toBeUndefined()
  })

  test('CONTROL: an open that succeeds never stops its session', async () => {
    const { agent } = fakeAgent()
    const s = session()
    await openWalletMailbox(agent, MEDIATOR, deps(s))
    expect(s.stop).not.toHaveBeenCalled()
    expect(walletMailboxOf(agent)?.session).toBe(s)
    await closeWalletMailbox(agent)
  })
})
