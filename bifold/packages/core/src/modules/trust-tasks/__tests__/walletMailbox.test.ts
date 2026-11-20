/**
 * walletMailbox.ts edges the real-agent rows (__tests__/modules/trust-tasks/walletMailbox.credo.test.ts) do not
 * reach: what the mailbox drops, a base64 attachment, and how the outbound transport picks the forward's `next`.
 */
import { DidCommMessageReceiver } from '@credo-ts/didcomm'

import * as transportModule from '../module/VtiMediatorTransport'
import {
  closeWalletMailbox,
  openWalletMailbox,
  takeMailboxMessage,
  WalletMailboxOutboundTransport,
} from '../module/walletMailbox'

const FORWARD = 'https://didcomm.org/routing/2.0/forward'
const MEDIATOR = 'did:peer:2.mediator'
const MAILBOX = 'did:peer:2.mailbox'
const PEER_MAILBOX = 'did:peer:2.peer-mailbox'

function fakeAgent({ created = ['did:peer:2.mine'] }: { created?: string[] } = {}) {
  const receiveMessage = jest.fn(async () => undefined)
  const registerOutboundTransport = jest.fn()
  const docs: Record<string, unknown> = {
    'did:peer:2.peer-contact': { service: [{ serviceEndpoint: { uri: PEER_MAILBOX, accept: ['didcomm/v2'] } }] },
    'did:peer:2.peer-plain': { service: [{ serviceEndpoint: 'https://peer.example' }] },
  }
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
      resolveDidDocument: jest.fn(async (did: string) => docs[did] ?? { service: [] }),
    },
    modules: {
      didcomm: {
        registerOutboundTransport,
        connections: {
          findById: jest.fn(async (id: string) =>
            id === 'c-mailbox'
              ? { id, theirDid: 'did:peer:2.peer-contact' }
              : id === 'c-plain'
                ? { id, theirDid: 'did:peer:2.peer-plain' }
                : null
          ),
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

describe('the mailbox takes a forward for one of this phone’s DIDs, and only that', () => {
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

describe('the outbound transport forwards to the mailbox the peer’s contact DID names', () => {
  const session = () => ({
    start: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
    forward: jest.fn(async () => undefined),
  })

  async function opened() {
    const fake = fakeAgent()
    const s = session()
    jest.spyOn(transportModule, 'vtiClientIdentityFromDid').mockResolvedValue({
      did: MAILBOX,
      kid: `${MAILBOX}#key-2`,
    } as never)
    const agent = fake.agent as unknown as { genericRecords: unknown }
    agent.genericRecords = { findAllByQuery: jest.fn(async () => [{ content: { did: MAILBOX } }]), save: jest.fn() }
    await openWalletMailbox(fake.agent, MEDIATOR, {
      resolveMediator: async () => ({ did: MEDIATOR, wsEndpoint: 'wss://m.example/ws' }) as never,
      makeSession: () => s,
    })
    return { ...fake, s }
  }

  afterEach(() => jest.restoreAllMocks())

  test('Credo’s endpoint is the mediator (it followed contact → mailbox); next is the mailbox the contact names', async () => {
    const { agent, s, registerOutboundTransport } = await opened()
    const transport = new WalletMailboxOutboundTransport(agent)
    await transport.sendMessage({ payload: { p: 1 } as never, endpoint: MEDIATOR, connectionId: 'c-mailbox' })
    expect(s.forward).toHaveBeenCalledWith(PEER_MAILBOX, { p: 1 })
    expect(registerOutboundTransport).toHaveBeenCalledTimes(1)
    await closeWalletMailbox(agent)
  })

  test('a DID endpoint that is not the mediator, for a peer whose DID names none: next is that endpoint', async () => {
    const { agent, s } = await opened()
    const transport = new WalletMailboxOutboundTransport(agent)
    await transport.sendMessage({ payload: { p: 2 } as never, endpoint: 'did:peer:2.other', connectionId: 'c-plain' })
    expect(s.forward).toHaveBeenCalledWith('did:peer:2.other', { p: 2 })
    await closeWalletMailbox(agent)
  })

  test('CONTROL: only the mediator to go on, and no contact DID naming a mailbox: refused, nothing forwarded', async () => {
    const { agent, s } = await opened()
    const transport = new WalletMailboxOutboundTransport(agent)
    await expect(transport.sendMessage({ payload: {} as never, endpoint: MEDIATOR })).rejects.toThrow(
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
