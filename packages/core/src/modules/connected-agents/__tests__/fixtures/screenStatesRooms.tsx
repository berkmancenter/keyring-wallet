/**
 * Agent connect, step 7.13: room info's "Agents in this room" and the add flow (canvas frames 34 to 37), drawn from
 * props for the screen catalogue (screenCatalogue.test.tsx): e2e/lib/agent-connect-screens.rooms.json lists the
 * states. Test support, not a test. The props are built from the seam's own types (`RoomAgents`, `AddRoomOutcome`), so
 * a change to the shape fails to compile here before it can mislead a test. Made-up names only, as the canvas draws
 * them.
 */
import React from 'react'

import AgentPickerSheet from '../../../rooms/components/AgentPickerSheet'
import AgentRoomSection, {
  agentRoomSection,
  RoomAgentAddable,
  RoomAgentInRoom,
  RoomAgents,
} from '../../../rooms/components/AgentRoomSection'
import AgentRoomSheet, { AddRoomOutcome } from '../../../rooms/components/AgentRoomSheet'
import WhatItRemembersSheet from '../../screens/WhatItRemembersSheet'

const none = () => undefined

export const PERSONA = 'Ada at Example College'
export const NOTES_HELPER: RoomAgentInRoom = {
  agentId: 'agent-notes-helper',
  name: 'Notes helper',
  memoryNames: ['Education', 'Healthcare'],
}
/** An agent of the same persona not yet in any of its rooms: its add also grants the persona's context. */
export const INBOX_TRIAGE: RoomAgentAddable = {
  agentId: 'agent-inbox-triage',
  name: 'Inbox triage',
  memoryNames: [],
  widens: { context: 'Personal' },
}
/** An agent already in another room of the persona: its add only offers this room. */
export const STUDY_BUDDY: RoomAgentAddable = {
  agentId: 'agent-study-buddy',
  name: 'Study buddy',
  memoryNames: ['Education'],
  widens: null,
}

/** What `useRoomAgents` gives for an open room whose community said yes: one agent in, one addable. */
export const ROOM_AGENTS: RoomAgents = {
  offered: true,
  setting: 'yes',
  persona: PERSONA,
  tier: 'open',
  inRoom: [NOTES_HELPER],
  addable: [INBOX_TRIAGE],
}

/** The section as room info draws it from a hook result; nothing when the result says it is absent. */
export const section = (room: RoomAgents) => {
  const data = agentRoomSection(room)
  return data ? <AgentRoomSection {...data} onOpenAgent={none} onAdd={none} /> : <></>
}

const addSheet = (agent: RoomAgentAddable, outcome?: AddRoomOutcome) => (
  <AgentRoomSheet
    name={agent.name}
    persona={PERSONA}
    widensContext={agent.widens?.context}
    outcome={outcome}
    onAdd={none}
    onClose={none}
    onSeeDetails={none}
  />
)

const remembers = (agent: RoomAgentInRoom) => (
  <WhatItRemembersSheet
    name={agent.name}
    persona={PERSONA}
    memoryNames={agent.memoryNames}
    onDone={none}
    onConnectAnother={none}
  />
)

export const SCREEN_STATES: Record<string, () => React.ReactElement> = {
  'room-agents': () => section(ROOM_AGENTS),
  // Frame 34's two agents, as a room neither is in yet would list them.
  'agent-picker': () => (
    <AgentPickerSheet
      agents={[NOTES_HELPER, INBOX_TRIAGE].map(({ agentId, name }) => ({ agentId, name }))}
      onPick={none}
      onClose={none}
    />
  ),
  'add-to-room': () => addSheet(INBOX_TRIAGE),
  'add-to-room-no-widen': () => addSheet(STUDY_BUDDY),
  'add-to-room-not-addable': () => addSheet(STUDY_BUDDY, 'notAddable'),
  'add-to-room-refused': () => addSheet(STUDY_BUDDY, 'refused'),
  'what-it-remembers': () => remembers(NOTES_HELPER),
  'what-it-remembers-none': () =>
    remembers({ agentId: INBOX_TRIAGE.agentId, name: INBOX_TRIAGE.name, memoryNames: [] }),
  'room-agents-setting-not-stated': () => section({ ...ROOM_AGENTS, setting: 'notStated' }),
}
