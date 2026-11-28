/**
 * Agent connect, step 7.9: how each state of the agent chat in e2e/lib/agent-connect-screens.chat.json is drawn from
 * props, for the catalogue test (screenCatalogue.test.tsx). Test support, not a test: the manifest names each state,
 * its canvas frame and the words it shows; this file says which view and props draw it.
 */
import React from 'react'

import AgentChatView, { type AgentChatViewMessage } from '../../screens/AgentChatView'

const none = () => undefined
const formatTime = (iso: string) => iso.slice(11, 16)

// Sample data, as the canvas draws it: made-up names only.
const CHAT: AgentChatViewMessage[] = [
  { id: 'm1', mine: true, text: "Summarise my notes from Tuesday's lecture.", at: '2026-11-27T10:38:00.000Z' },
  {
    id: 'm2',
    mine: false,
    text: "Here is a summary of Tuesday's lecture notes: three themes, and two open questions for Thursday.",
    at: '2026-11-27T10:38:30.000Z',
  },
  { id: 'm3', mine: true, text: 'Thanks. Keep it for the study group.', at: '2026-11-27T10:40:00.000Z' },
  { id: 'm4', mine: false, text: 'Saved to Education.', at: '2026-11-27T10:40:20.000Z' },
]
// Frame 28: sent while the agent's session was not running, with no reply.
const UNANSWERED: AgentChatViewMessage[] = [
  { id: 'w1', mine: true, text: 'Are you there?', at: '2026-11-27T18:02:00.000Z' },
  { id: 'w2', mine: true, text: "Summarise today's seminar when you are back.", at: '2026-11-27T18:02:30.000Z' },
  { id: 'w3', mine: true, text: 'And add the reading list to Education.', at: '2026-11-27T18:03:00.000Z' },
]

const chat = (props: Partial<React.ComponentProps<typeof AgentChatView>>) => (
  <AgentChatView
    name="Notes helper"
    ownerName="Ada"
    messages={CHAT}
    state="connected"
    stopped={false}
    onSend={none}
    formatTime={formatTime}
    onBack={none}
    {...props}
  />
)

export const SCREEN_STATES: Record<string, () => React.ReactElement> = {
  'agent-chat': () => chat({}),
  'agent-chat-waiting': () => chat({ messages: UNANSWERED, state: 'notConnected', stopped: true }),
  'agent-chat-version-mismatch': () => chat({ state: 'versionMismatch' }),
}
