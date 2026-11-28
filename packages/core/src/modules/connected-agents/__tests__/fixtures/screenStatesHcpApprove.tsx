/**
 * The HCP approve flow's states (backlog Section C, U1), drawn from props for the screen catalogue
 * (screenCatalogue.test.tsx), one per entry of e2e/lib/agent-connect-screens.hcp-approve.json. Test support, not a test.
 *
 * `cancelled` has no drawing: the view draws nothing for it (the caller has closed), so there is no marker to find.
 */
import React from 'react'

import type { HcpApproveFailure, HcpApproveState } from '../../hcp/approveFlow'
import HcpConnectFlowView from '../../hcp/screens/HcpConnectFlowView'
import type { HcpApprovalView } from '../../hcp/types'

import { HCP_WORD_SOURCE } from './hcpWordSource'
import type { WordSource } from './wordSource'

const none = () => undefined
const yes = async () => true

// Sample data, as frame 50 draws it: made-up names only. The rows are the VTA's, data rather than words.
export const HCP_APPROVAL_VIEW: HcpApprovalView = {
  title: { key: 'ApproveTitle', params: { name: 'Notes helper' } },
  rows: [
    'Run by Example Labs.',
    'It can read general preferences to personalise its answers for you and do the tasks you ask of it.',
    'It can keep what it reads for up to 15 minutes after reading it.',
    'For 4 hours, until 14:30.',
    'Approving gives access. It is not signing in.',
  ],
  warning: { key: 'ApproveOwnTerminal' },
  approve: { key: 'Approve' },
  clientVid: 'did:key:z6MkNotes',
  grantId: 'urn:uuid:3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b',
  threadId: 'urn:uuid:7c2a9e41-5b3d-4f6a-8e1c-0a9b8d7c6e51',
  expiresInSeconds: 4 * 60 * 60,
}

const flow = (state: HcpApproveState) => (
  <HcpConnectFlowView
    state={state}
    name="Notes helper"
    until="14:30"
    confirm={yes}
    onApprove={none}
    onSubmitNumber={none}
    onCancel={none}
    onClose={none}
    onSeeDetails={none}
  />
)
const failed = (message: HcpApproveFailure) => flow({ state: 'failed', error: 'sample', message })

export const SCREEN_STATES: Record<string, () => React.ReactElement> = {
  'hcp-approve-idle': () => flow({ state: 'idle' }),
  'hcp-approve-waiting': () => flow({ state: 'waiting' }),
  'hcp-approve-number': () => flow({ state: 'numberEntry' }),
  'hcp-approve-approve': () => flow({ state: 'approve', view: HCP_APPROVAL_VIEW }),
  'hcp-approve-approving': () => flow({ state: 'approving', view: HCP_APPROVAL_VIEW }),
  'hcp-approve-approved': () => flow({ state: 'approved', view: HCP_APPROVAL_VIEW }),
  'hcp-approve-expired': () => flow({ state: 'expired', message: { key: 'CodeExpired' } }),
  'hcp-approve-wrong-number': () => flow({ state: 'wrongNumber', message: { key: 'WrongNumber' } }),
  'hcp-approve-locked': () => flow({ state: 'locked', minutes: 3, message: { key: 'Locked', params: { n: '3' } } }),
  'hcp-approve-failed-not-approved': () => failed({ key: 'ApproveNotApproved' }),
  'hcp-approve-failed-not-recorded': () => failed({ key: 'ApproveNotRecorded', params: { name: 'Notes helper' } }),
  'hcp-approve-failed-declined': () => failed({ key: 'ApproveDeclined' }),
  'hcp-approve-failed-answered-elsewhere': () => failed({ key: 'ApproveAnsweredElsewhere' }),
}

export const WORD_SOURCES: WordSource[] = [HCP_WORD_SOURCE]
