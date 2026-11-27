/**
 * Records and views for every state a screen draws, so render tests never touch a VTA (the seam agreed with the
 * UI/UX lane, 2026-11-26). Test-only: nothing in the app imports this folder.
 *
 * @module connected-agents/testing/fixtures
 */

import { viewOf, type MemoryNames } from '../status'
import type { AgentConnection, AgentStatus, AgentView } from '../types'

/** A fixed clock for the fixtures: 2026-11-26 12:00:00Z. */
export const FIXTURE_NOW = Date.UTC(2026, 10, 26, 12, 0, 0)

const HOUR = 60 * 60 * 1000

export const FIXTURE_MEMORIES: Record<string, string> = {
  'keyring-memory-educat1on': 'Education',
  'keyring-memory-hea1thcar': 'Healthcare',
  'keyring-memory-trave1abc': 'Travel',
}

export const fixtureNames: MemoryNames = (id) => FIXTURE_MEMORIES[id]

/** A connected temporary agent with two memories; override any member. */
export function agentRecord(overrides: Partial<AgentConnection> = {}): AgentConnection {
  const id = overrides.id ?? 'did:key:z6MkNotesHelperFixture'
  return {
    id,
    name: 'Notes helper',
    handle: 'notes-helper-k3qa',
    agentDid: id,
    deviceId: 'device-notes-helper',
    ownerPersonaDid: 'did:webvh:persona.example:ada',
    vtaDid: 'did:webvh:vta.example:owner',
    contexts: ['keyring-memory-educat1on', 'keyring-memory-hea1thcar'],
    memoryContexts: ['keyring-memory-educat1on', 'keyring-memory-hea1thcar'],
    pendingContexts: [],
    capabilities: ['memory-read', 'memory-write'],
    purposes: ['personalisation', 'taskExecution'],
    expiresAt: new Date(FIXTURE_NOW + 2.5 * HOUR).toISOString(),
    grantType: 'temporary',
    answersOthers: false,
    state: 'active',
    keyChanged: false,
    createdAt: new Date(FIXTURE_NOW - 1.5 * HOUR).toISOString(),
    ...overrides,
  }
}

/** One record per status, in §6's order, with the reachability that produces it. */
export const RECORD_FOR_STATUS: Record<AgentStatus, { record: AgentConnection; reachable?: boolean }> = {
  connected: {
    record: agentRecord({
      id: 'did:key:z6MkTravelAgent',
      name: 'Travel agent',
      grantType: 'persistent',
      expiresAt: undefined,
      persistentElectedAt: new Date(FIXTURE_NOW - HOUR).toISOString(),
    }),
  },
  connectedUntil: { record: agentRecord() },
  unreachable: { record: agentRecord({ id: 'did:key:z6MkInboxTriage', name: 'Inbox triage' }), reachable: false },
  expired: {
    record: agentRecord({
      id: 'did:key:z6MkOldHelper',
      name: 'Old helper',
      expiresAt: new Date(FIXTURE_NOW - HOUR).toISOString(),
    }),
  },
  notFinished: { record: agentRecord({ id: 'did:key:z6MkStudyBuddy', name: 'Study buddy', state: 'notFinished' }) },
  revokeNotConfirmed: {
    record: agentRecord({ id: 'did:key:z6MkNotConfirmed', name: 'Not confirmed', state: 'revoking' }),
  },
  revoked: { record: agentRecord({ id: 'did:key:z6MkOldLaptop', name: 'Old laptop', state: 'revoked' }) },
}

/** The view for each status, as the screens receive it. */
export function viewForStatus(status: AgentStatus): AgentView {
  const { record, reachable } = RECORD_FOR_STATUS[status]
  const view = viewOf(record, {
    now: FIXTURE_NOW,
    reach: reachable === undefined ? undefined : { reachable },
    names: fixtureNames,
    ownerName: 'Ada',
  })
  if (!view) throw new Error(`no view for ${status}`)
  return view
}

/** The other states a screen draws: memory drift, a memory not reached yet, a changed key. */
export const SPECIAL_VIEWS = {
  drift: () =>
    viewOf(agentRecord(), {
      now: FIXTURE_NOW,
      names: fixtureNames,
      ownerName: 'Ada',
      entryContexts: ['keyring-memory-educat1on', 'keyring-memory-trave1abc'],
    }) as AgentView,
  pending: () =>
    viewOf(agentRecord({ contexts: ['keyring-memory-educat1on'], pendingContexts: ['keyring-memory-hea1thcar'] }), {
      now: FIXTURE_NOW,
      names: fixtureNames,
      ownerName: 'Ada',
    }) as AgentView,
  keyChanged: () =>
    viewOf(agentRecord({ keyChanged: true }), { now: FIXTURE_NOW, names: fixtureNames, ownerName: 'Ada' }) as AgentView,
}
