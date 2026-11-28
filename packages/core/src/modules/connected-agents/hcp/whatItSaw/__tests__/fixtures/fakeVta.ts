/**
 * A fake HCP port for the reads of "What my agent saw", and audit events and summary answers that validate against
 * the vendored schemas. Tests change one thing at a time from them.
 */
import type { HcpVtaPort } from '../../../vtaPort'

export const CLIENT = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
export const OTHER_CLIENT = 'did:key:z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp'
export const GRANT = 'urn:uuid:3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b'
export const OTHER_GRANT = 'urn:uuid:0f8c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f'
export const PERSONALISATION = 'https://registry.trustoverip.org/dtg/purpose/personalisation/1'
export const TASK_EXECUTION = 'https://registry.trustoverip.org/dtg/purpose/taskExecution/2'

let serial = 0
const urn = () => `urn:uuid:00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`

/** An audit event (HCP 8.2) of `eventType` at `timestamp`, under GRANT unless changed. */
export function auditEvent(eventType: string, timestamp: string, change: Record<string, unknown> = {}) {
  return {
    eventId: urn(),
    eventType,
    timestamp,
    participants: {
      initiator: { role: 'context-client', id: CLIENT },
      provider: { id: 'did:web:vta.example' },
    },
    entryId: null,
    relatedEntryId: null,
    purpose: null,
    purposeDescription: null,
    grantId: GRANT,
    ...change,
  }
}

/** A `context.read` of `categories` for `purpose`. */
export const readEvent = (timestamp: string, categories: string[], purpose: string | null = PERSONALISATION) =>
  auditEvent('context.read', timestamp, { categories, purpose, purposeDescription: 'tailor answers' })

/** A `disclosures/summary` answer with one entry for `client`. */
export function summaryAnswer(change: Record<string, unknown> = {}, client = CLIENT) {
  return {
    clients: [
      {
        client: { id: client, name: 'hcp-demo', operator: { id: 'did:web:example.org', name: 'Example' } },
        grants: [{ grantId: GRANT, status: 'active' }],
        categories: ['general_preferences', 'work_context'],
        purposes: [PERSONALISATION],
        entries: 2,
        retrievals: 3,
        firstAt: '2026-11-27T10:05:00.000Z',
        lastAt: '2026-11-27T10:20:00.000Z',
        usableUntil: '2026-11-27T10:30:00.000Z',
        notification: 'none',
        ...change,
      },
    ],
  }
}

export interface FakeVta {
  port: HcpVtaPort
  calls: { type: string; payload: Record<string, unknown> }[]
}

/** A port that records each task and answers with `answer`, which may throw. */
export function fakeVta(answer: (type: string, payload: Record<string, unknown>, n: number) => unknown): FakeVta {
  const calls: FakeVta['calls'] = []
  return {
    calls,
    port: {
      task: async (type, payload) => {
        calls.push({ type, payload })
        return answer(type, payload, calls.length)
      },
    },
  }
}

/** A refusal as the VTI client throws it. */
export function refusal(code = 'permissionDenied'): Error {
  const error = new Error('refused') as Error & { code: string }
  error.name = 'VtiRefusal'
  error.code = code
  return error
}
