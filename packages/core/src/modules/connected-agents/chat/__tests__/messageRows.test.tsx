/**
 * The agent chats as Messages rows (backlog 2, fb-C4; plan §3.14): one per agent the Contacts list shows, with the
 * chat's last message and its ISO time, and none with the flag off.
 */
import { renderHook, waitFor } from '@testing-library/react-native'
import type { Agent } from '@credo-ts/core'
import React from 'react'

import { memoryGenericRecords } from '../../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'
import { newEventId } from '../../../chat/eventId'
import { ChatEventRecord } from '../../../chat/records/ChatEventRecord'
import { setAgentConnectEnabled } from '../../agentConnectFlag'
import { AgentConnectionStore } from '../../store'
import { agentRecord, FIXTURE_NOW } from '../../testing/fixtures'
import { AGENT_MESSAGE_ROW_KIND, agentMessageRows, useAgentMessageRows } from '../messageRows'
import { type AgentChatEvents, AgentChatProvider, AgentChatService } from '../useAgentChat'

const HOUR = 60 * 60 * 1000
const NONE: ChatEventRecord[] = []

function memoryEvents(): AgentChatEvents {
  let byConnection = new Map<string, ChatEventRecord[]>()
  const listeners = new Set<() => void>()
  const put = async (record: ChatEventRecord) => {
    const kept = (byConnection.get(record.connectionId) ?? []).filter((e) => e.id !== record.id)
    byConnection = new Map(byConnection)
    byConnection.set(record.connectionId, [...kept, record])
    listeners.forEach((l) => l())
  }
  return {
    snapshot: (connectionId) => byConnection.get(connectionId) ?? NONE,
    all: () => byConnection,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    list: async (connectionId) => [...(byConnection.get(connectionId) ?? [])],
    save: put,
    update: put,
  }
}

const message = (connectionId: string, text: string | undefined, at: number, role: 'sent' | 'received' = 'received') =>
  new ChatEventRecord({
    connectionId,
    role,
    eventId: newEventId(),
    eventType: 'message',
    ...(text !== undefined
      ? { content: { format: 'text/plain', text } }
      : { attachments: [{ unsupported: 'not-saved' }] }),
    sentTime: new Date(at),
  })

const notes = agentRecord()
const travel = agentRecord({
  id: 'did:key:z6MkTravelAgent',
  name: 'Travel agent',
  grantType: 'persistent',
  expiresAt: undefined,
})
const old = agentRecord({
  id: 'did:key:z6MkOldHelper',
  name: 'Old helper',
  expiresAt: new Date(FIXTURE_NOW - HOUR).toISOString(),
})
const revoked = agentRecord({ id: 'did:key:z6MkRevoked', name: 'Revoked one', state: 'revoked' })

describe('agentMessageRows', () => {
  it('one row per agent the Contacts list shows, with its last message and an ISO lastAt', () => {
    const events = new Map([
      [
        'agent-chat:' + notes.id,
        [
          message('agent-chat:' + notes.id, 'first', FIXTURE_NOW - 2 * HOUR),
          message('agent-chat:' + notes.id, 'latest', FIXTURE_NOW - HOUR, 'sent'),
        ],
      ],
      ['agent-chat:' + old.id, [message('agent-chat:' + old.id, 'old', FIXTURE_NOW - 3 * HOUR)]],
    ])
    const rows = agentMessageRows([notes, travel, old, revoked], events, FIXTURE_NOW)
    expect(rows).toEqual([
      {
        agentId: notes.id,
        name: 'Notes helper',
        lastText: 'latest',
        lastAt: new Date(FIXTURE_NOW - HOUR).toISOString(),
      },
      { agentId: travel.id, name: 'Travel agent' },
    ])
  })

  it('a last message with no text gives its time and no text; unread events give rows with no last message', () => {
    const connectionId = 'agent-chat:' + notes.id
    expect(
      agentMessageRows([notes], new Map([[connectionId, [message(connectionId, undefined, FIXTURE_NOW)]]]), FIXTURE_NOW)
    ).toEqual([{ agentId: notes.id, name: 'Notes helper', lastAt: new Date(FIXTURE_NOW).toISOString() }])
    expect(agentMessageRows([notes], undefined, FIXTURE_NOW)).toEqual([{ agentId: notes.id, name: 'Notes helper' }])
  })

  it('names the row kind messagesListItems gives it', () => {
    expect(AGENT_MESSAGE_ROW_KIND).toBe('agent')
  })
})

describe('useAgentMessageRows', () => {
  async function mounted() {
    const agent = { genericRecords: memoryGenericRecords() } as unknown as Agent
    const store = new AgentConnectionStore(agent)
    await store.put(notes)
    const events = memoryEvents()
    await events.save(message('agent-chat:' + notes.id, 'hello', FIXTURE_NOW))
    const service = new AgentChatService({
      control: { sendEnvelope: jest.fn(), onChat: () => () => undefined, onReceipt: () => () => undefined } as never,
      store,
      events,
      now: () => FIXTURE_NOW,
    })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AgentChatProvider chat={service}>{children}</AgentChatProvider>
    )
    return { wrapper, events }
  }

  afterEach(() => setAgentConnectEnabled(false))

  it('with the flag on, the agents’ rows, and a new message moves its row', async () => {
    setAgentConnectEnabled(true)
    const { wrapper, events } = await mounted()
    const { result } = renderHook(() => useAgentMessageRows(), { wrapper })
    await waitFor(() =>
      expect(result.current).toEqual([expect.objectContaining({ agentId: notes.id, lastText: 'hello' })])
    )
    await events.save(message('agent-chat:' + notes.id, 'again', FIXTURE_NOW + 1000))
    await waitFor(() =>
      expect(result.current[0]).toMatchObject({ lastText: 'again', lastAt: new Date(FIXTURE_NOW + 1000).toISOString() })
    )
  })

  it('control: with the flag off it is empty, with the same provider and records', async () => {
    setAgentConnectEnabled(false)
    const { wrapper } = await mounted()
    const { result } = renderHook(() => useAgentMessageRows(), { wrapper })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(result.current).toEqual([])
  })

  it('with no provider mounted it is empty, and does not throw', () => {
    setAgentConnectEnabled(true)
    const { result } = renderHook(() => useAgentMessageRows())
    expect(result.current).toEqual([])
  })
})
