/**
 * Agent connect: how each P0 screen state in e2e/lib/agent-connect-screens.json is drawn from props, for the
 * catalogue test (screenCatalogue.test.tsx). Test support, not a test: the manifest names each state, its canvas
 * frame and the words it shows; this file says which view and props draw it. The emulator walk of step 7.11 reaches
 * the same states through the app instead, by the manifest's markers and steps.
 */
import React from 'react'
import { Text } from 'react-native'

import AgentContactCard from '../../components/AgentContactCard'
import { PickerMemory } from '../../components/MemoryPicker'
import { ConnectEnd } from '../../failureCopy'
import AgentDetailsView, { AgentDetailsData } from '../../screens/AgentDetailsView'
import AgentListView, { AgentRowData } from '../../screens/AgentListView'
import ApproveView from '../../screens/ApproveView'
import ChangeMemoriesView from '../../screens/ChangeMemoriesView'
import ConnectAgentForm, { ConnectGuard } from '../../screens/ConnectAgentForm'
import ConnectedView, { ConnectingView } from '../../screens/ConnectedView'
import ConnectFailureView from '../../screens/ConnectFailureView'
import ConnectNumberView from '../../screens/ConnectNumberView'
import ConnectScanView from '../../screens/ConnectScanView'

const none = () => undefined
const never = () => new Promise<never>(() => undefined)

// Sample data, as the canvas draws it: made-up names only.
export const MEMORIES: PickerMemory[] = [
  { id: 'keyring-memory-aaaa', name: 'Education', containsOthers: false },
  { id: 'keyring-memory-bbbb', name: 'Healthcare', containsOthers: false },
  { id: 'keyring-memory-cccc', name: 'Housing', containsOthers: false },
  { id: 'keyring-memory-dddd', name: 'Work', containsOthers: true },
]
const EDU = { id: 'keyring-memory-aaaa', name: 'Education' }
const HEALTH = { id: 'keyring-memory-bbbb', name: 'Healthcare' }

const agentRow = (over: Partial<AgentRowData> = {}): AgentRowData => ({
  id: 'did:key:z6MkNotes',
  name: 'Notes helper',
  status: 'connectedUntil',
  until: '14:30',
  temporary: true,
  keyChanged: false,
  ...over,
})
const details = (over: Partial<AgentDetailsData> = {}): AgentDetailsData => ({
  ...agentRow(),
  ownerName: 'Ada',
  memories: [EDU, HEALTH],
  pending: [],
  ...over,
})
const COUNTS = {
  [EDU.id]: { count: 214, lastChange: '24 November', failed: false },
  [HEALTH.id]: { count: 1240, lastChange: '26 November', rose: 830, failed: false },
}

const form = (guard: ConnectGuard) => (
  <ConnectAgentForm guard={guard} memories={MEMORIES} onCreateMemory={never} onContinue={none} onClose={none} />
)
const end = (e: ConnectEnd) => <ConnectFailureView end={e} minutesLeft={3} typed="47" cells={2} onClose={none} />
const detailsView = (agent: AgentDetailsData) => (
  <AgentDetailsView
    agent={agent}
    counts={COUNTS}
    warnAbove={1000}
    onChangeMemories={none}
    onRestore={none}
    onRetryPending={none}
    onExtend={none}
    onRemove={none}
    onConnectAgain={none}
  />
)
const changeMemories = (
  <ChangeMemoriesView
    agentName="Notes helper"
    memories={MEMORIES}
    current={[EDU.id, HEALTH.id]}
    onCreateMemory={never}
    confirm={async () => false}
    onWiden={never}
    onNarrow={never}
  />
)

/** One element per manifest state id. A state with steps is drawn first, then the steps are taken. */
export const SCREEN_STATES: Record<string, () => React.ReactElement> = {
  'connect-name': () => form('ok'),
  'connect-new-memory': () => form('ok'),
  'connect-checking': () => form('checking'),
  'connect-not-administrator': () => form('notAdministrator'),
  'connect-vta-too-old': () => form('vtaTooOld'),
  'connect-unreachable': () => form('unreachable'),
  scan: () => <ConnectScanView camera={<Text>camera</Text>} onLink={none} />,
  'scan-paste': () => <ConnectScanView camera={<Text>camera</Text>} onLink={none} />,
  number: () => <ConnectNumberView onSubmit={none} onCancel={none} />,
  'end-wrong-number': () => end('wrong-number'),
  'end-expired': () => end('expired'),
  'end-spent': () => end('spent'),
  'end-foreign-vta': () => end('foreign-vta'),
  'end-not-a-pairing-code': () => end('not-a-pairing-code'),
  'end-grant-refused': () => end('grant-refused'),
  'end-unsupported': () => end('unsupported'),
  'end-rotation-lost-limits': () => end('rotation-lost-limits'),
  'end-handle-collision': () => end('handle-collision'),
  'end-invalid-choice': () => end('invalid-choice'),
  'end-mediator-closed': () => end('mediator-closed'),
  'end-terminal-refused': () => end('terminal-refused'),
  'end-locked': () => end('locked'),
  approve: () => (
    <ApproveView
      name="Notes helper"
      memoryNames={['Education', 'Healthcare']}
      purposes={['personalisation', 'taskExecution']}
      until="14:30"
      confirm={async () => false}
      onApproved={none}
    />
  ),
  'approve-no-memory': () => (
    <ApproveView
      name="Notes helper"
      memoryNames={[]}
      purposes={['personalisation', 'taskExecution']}
      until="14:30"
      confirm={async () => false}
      onApproved={none}
    />
  ),
  'approve-signals': () => (
    <ApproveView
      name="Notes helper"
      memoryNames={['Education']}
      purposes={['personalisation', 'taskExecution']}
      until="14:30"
      requester="A coding assistant on a laptop"
      sameNetwork={false}
      confirm={async () => false}
      onApproved={none}
    />
  ),
  connecting: () => <ConnectingView name="Notes helper" />,
  connected: () => <ConnectedView name="Notes helper" until="14:30" onSeeDetails={none} />,
  list: () => (
    <AgentListView
      agents={[
        agentRow(),
        agentRow({ id: 'b', name: 'Travel agent', status: 'expired', until: undefined }),
        agentRow({ id: 'c', name: 'Inbox triage', status: 'unreachable', until: undefined, temporary: false }),
      ]}
      onOpen={none}
      onConnect={none}
      onExtend={none}
      onRemove={none}
      onConnectAgain={none}
    />
  ),
  'list-states': () => (
    <AgentListView
      agents={[
        agentRow({ id: 'a', status: 'revokeNotConfirmed', until: undefined, temporary: false }),
        agentRow({
          id: 'b',
          name: 'Travel agent',
          status: 'connected',
          until: undefined,
          temporary: false,
          keyChanged: true,
        }),
        agentRow({ id: 'c', name: 'Inbox triage' }),
        agentRow({ id: 'd', name: 'Study buddy', status: 'notFinished', until: undefined }),
        agentRow({ id: 'e', name: 'Old laptop', status: 'revoked', until: undefined, temporary: false }),
      ]}
      onOpen={none}
      onConnect={none}
      onExtend={none}
      onRemove={none}
      onConnectAgain={none}
    />
  ),
  details: () => detailsView(details()),
  'details-drift': () =>
    detailsView(details({ drift: { extra: [{ id: 'keyring-memory-x', name: 'Finance' }], missing: [] } })),
  'details-key-changed': () =>
    detailsView(details({ status: 'connected', until: undefined, temporary: false, keyChanged: true })),
  'details-expired': () => detailsView(details({ status: 'expired', until: undefined })),
  'change-memories-widen': () => changeMemories,
  'change-memories-narrow': () => changeMemories,
  'contacts-row': () => <AgentContactCard name="Notes helper" onPress={none} />,
}
