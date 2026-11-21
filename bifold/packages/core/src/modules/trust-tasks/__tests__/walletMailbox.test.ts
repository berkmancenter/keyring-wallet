/**
 * walletMailbox.ts edges the real-agent rows (__tests__/modules/trust-tasks/walletMailbox.credo.test.ts) do not
 * reach: what the mailbox drops, a base64 attachment, how the outbound transport picks the forward's `next`, and two
 * opens for different mediators at once.
 */
import { DidCommMessageReceiver } from '@credo-ts/didcomm'

import * as transportModule from '../module/VtiMediatorTransport'
import {
  closeWalletMailbox,
  openWalletMailbox,
  takeMailboxMessage,
  walletMailboxOf,
  WalletMailboxOutboundTransport,
} from '../module/walletMailbox'

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
        q.mediatorDid
          ? [{ content: { did: `mailbox-of-${q.mediatorDid}` } }]
          : [{ content: { did: `mailbox-of-${MEDIATOR}` } }, { content: { did: `mailbox-of-${OTHER_MEDIATOR}` } }]
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

const forward = (next: string, data: Record<string, unknown>) => ({
  id: 'f-1',
  type: FORWARD,
  body: { next },
  attachments: [{ id: 'a-1', data }],
})

const session = () => ({
  start: jest.fn(async () => undefined),
  stop: jest.fn(async () => undefined),
  forward: jest.fn(async () => undefined),
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
    expect(s.forward).toHaveBeenCalledWith(PEER_MAILBOX, { p: 1 })
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
    expect(s.forward).toHaveBeenCalledWith(OTHER_MAILBOX, { p: 2 })
    await closeWalletMailbox(agent)
  })

  test('CONTROL: a DID endpoint that is another mediator’s, for a peer whose documents lead to no mailbox: refused, nothing forwarded', async () => {
    const { agent } = fakeAgent()
    const s = await opened(agent)
    const transport = new WalletMailboxOutboundTransport(agent)
    await expect(
      transport.sendMessage({ payload: {} as never, endpoint: OTHER_MEDIATOR, connectionId: 'c-plain' })
    ).rejects.toThrow('no mailbox found')
    expect(s.forward).not.toHaveBeenCalled()
    await closeWalletMailbox(agent)
  })

  test('a contact DID that names the mediator directly (not a mailbox): refused', async () => {
    const { agent } = fakeAgent()
    const s = await opened(agent)
    const transport = new WalletMailboxOutboundTransport(agent)
    await expect(
      transport.sendMessage({ payload: {} as never, endpoint: MEDIATOR, connectionId: 'c-direct' })
    ).rejects.toThrow('no mailbox found')
    expect(s.forward).not.toHaveBeenCalled()
    await closeWalletMailbox(agent)
  })

  test('no connection to read the peer from: refused, whatever the endpoint', async () => {
    const { agent } = fakeAgent()
    const s = await opened(agent)
    const transport = new WalletMailboxOutboundTransport(agent)
    await expect(transport.sendMessage({ payload: {} as never, endpoint: PEER_MAILBOX })).rejects.toThrow(
      'no mailbox found'
    )
    expect(s.forward).not.toHaveBeenCalled()
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
