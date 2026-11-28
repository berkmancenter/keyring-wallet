/**
 * "Answers other people" and the P1 lines in the details and the list (step 7.14; canvas frames 12 to 16), drawn from
 * props for the screen catalogue: e2e/lib/agent-connect-screens.answers.json lists them. Views only: the props are
 * shaped as the seam gives `useAnswersOthers` and the record's `handle`, `persona` and `actNames` (backlog 3 Section B),
 * and nothing here is reachable from the app. Made-up names only, as the canvas draws them.
 */
import React from 'react'

import AnswersOthersRow, { AnswersOthersRowProps } from '../../components/AnswersOthersRow'
import AgentDetailsView, { AgentDetailsData } from '../../screens/AgentDetailsView'
import AgentListView, { AgentRowData } from '../../screens/AgentListView'
import AnswersOthersConfirmSheet from '../../screens/AnswersOthersConfirmSheet'

const none = () => undefined
const never = () => new Promise<never>(() => undefined)

const EDU = { id: 'keyring-memory-aaaa', name: 'Education' }
const HEALTH = { id: 'keyring-memory-bbbb', name: 'Healthcare' }

export const answersRow = (over: Partial<AnswersOthersRowProps> = {}): AnswersOthersRowProps => ({
  name: 'Notes helper',
  value: false,
  offered: true,
  pending: false,
  notSaved: false,
  onTurnOn: none,
  onTurnOff: none,
  ...over,
})

export const listRow = (over: Partial<AgentRowData> = {}): AgentRowData => ({
  id: 'did:key:z6MkNotes',
  name: 'Notes helper',
  status: 'connectedUntil',
  until: '14:30',
  temporary: true,
  keyChanged: false,
  ...over,
})

export const detailsAgent = (over: Partial<AgentDetailsData> = {}): AgentDetailsData => ({
  ...listRow(),
  ownerName: 'Ada',
  memories: [EDU, HEALTH],
  pending: [],
  ...over,
})

const COUNTS = {
  [EDU.id]: { count: 214, lastChange: '24 November', failed: false },
  [HEALTH.id]: { count: 1240, lastChange: '26 November', rose: 830, failed: false },
}

/** The details as frame 16 draws them: added to a room as "Ada", the access names as the frame lists them. */
export const detailsRooms = () => (
  <AgentDetailsView
    agent={detailsAgent()}
    counts={COUNTS}
    warnAbove={1000}
    onChangeMemories={none}
    onRestore={none}
    onRetryPending={none}
    onExtend={none}
    onRemove={none}
    onConnectAgain={none}
    handle="notes-helper-7f3k"
    persona="Ada"
    actNames={['Education', 'Healthcare']}
    answersOthers={answersRow()}
  />
)

export const SCREEN_STATES: Record<string, () => React.ReactElement> = {
  'answers-off': () => <AnswersOthersRow {...answersRow()} />,
  'answers-on-confirm': () => <AnswersOthersConfirmSheet name="Notes helper" onTurnOn={never} onKeepOff={none} />,
  'agent-details-rooms': detailsRooms,
  'agent-list-answers': () => (
    <AgentListView
      agents={[
        listRow({ answersOthers: false }),
        listRow({ id: 'b', name: 'Travel agent', status: 'expired', until: undefined, answersOthers: false }),
        listRow({
          id: 'c',
          name: 'Inbox triage',
          status: 'unreachable',
          until: undefined,
          temporary: false,
          answersOthers: true,
        }),
      ]}
      onOpen={none}
      onConnect={none}
      onExtend={none}
      onRemove={none}
      onConnectAgain={none}
    />
  ),
  'answers-not-offered': () => <AnswersOthersRow {...answersRow({ offered: false })} />,
  'answers-pending': () => <AnswersOthersRow {...answersRow({ value: true, pending: true })} />,
}
