/**
 * The HCP agent list, its notice lines and the HCP Revoke sheet (backlog Section C, U2), drawn from props for the
 * screen catalogue (screenCatalogue.test.tsx), one per entry of e2e/lib/agent-connect-screens.hcp-list.json. Test
 * support, not a test.
 */
import React from 'react'

import type { HcpRevokeResult } from '../../hcp/revoke'
import HcpAgentListView from '../../hcp/screens/HcpAgentListView'
import HcpRevokeSheet from '../../hcp/screens/HcpRevokeSheet'
import type { HcpConnection } from '../../hcp/types'

import { HCP_WORD_SOURCE } from './hcpWordSource'
import type { WordSource } from './wordSource'

const none = () => undefined

/** The time the sample statuses are read at. */
export const HCP_LIST_NOW = new Date('2026-11-27T13:00:00.000Z')
/** The fixtures' time format: the hour and minute of the instant, in UTC. */
export const formatSampleTime = (iso: string) => iso.slice(11, 16)

// Sample data, as frames 52 and 55 draw it: made-up names only.
export const HCP_CONNECTED: HcpConnection = {
  id: 'did:key:z6MkNotes',
  name: 'Notes helper',
  grantId: 'urn:uuid:3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b',
  threadId: 'urn:uuid:7c2a9e41-5b3d-4f6a-8e1c-0a9b8d7c6e51',
  approvedAt: '2026-11-27T10:30:00.000Z',
  expiresAt: '2026-11-27T14:30:00.000Z',
}

export const HCP_EXPIRED: HcpConnection = {
  id: 'did:key:z6MkTravel',
  name: 'Travel agent',
  grantId: 'urn:uuid:0b6f3e2d-1c4a-4e5f-9a8b-7c6d5e4f3a2b',
  threadId: 'urn:uuid:5e4d3c2b-1a09-4f8e-8d7c-6b5a49382716',
  approvedAt: '2026-11-27T06:00:00.000Z',
  expiresAt: '2026-11-27T10:00:00.000Z',
}

const REVOKED_AT = '2026-11-27T14:01:00.000Z'

/** The connected sample, revoked, with each of the three notices of frame 55. */
export const HCP_REVOKED: Record<'telling' | 'told' | 'notTold', HcpConnection> = {
  telling: { ...HCP_CONNECTED, revokedAt: REVOKED_AT, notice: { state: 'telling' } },
  told: { ...HCP_CONNECTED, revokedAt: REVOKED_AT, notice: { state: 'told', at: '2026-11-27T14:02:00.000Z' } },
  notTold: {
    ...HCP_CONNECTED,
    revokedAt: REVOKED_AT,
    notice: { state: 'notTold', usableUntil: '2026-11-27T14:17:00.000Z' },
  },
}

const list = (connections: HcpConnection[]) => (
  <HcpAgentListView
    connections={connections}
    now={HCP_LIST_NOW}
    formatTime={formatSampleTime}
    onOpen={none}
    onRevoke={none}
    onConnect={none}
  />
)

const sheet = (result: HcpRevokeResult) => (
  <HcpRevokeSheet name="Notes helper" onRevoke={async () => result} onKeep={none} onDone={none} />
)

export const SCREEN_STATES: Record<string, () => React.ReactElement> = {
  'hcp-list': () => list([HCP_CONNECTED, HCP_EXPIRED]),
  'hcp-list-revoked-telling': () => list([HCP_REVOKED.telling]),
  'hcp-list-revoked-told': () => list([HCP_REVOKED.told]),
  'hcp-list-revoked-not-told': () => list([HCP_REVOKED.notTold]),
  'hcp-revoke': () => sheet({ ok: true, connection: HCP_REVOKED.telling }),
  'hcp-revoke-unreachable': () =>
    sheet({ ok: false, unreachable: true, message: { key: 'RevokeUnreachable', params: { name: 'Notes helper' } } }),
}

export const WORD_SOURCES: WordSource[] = [HCP_WORD_SOURCE]
