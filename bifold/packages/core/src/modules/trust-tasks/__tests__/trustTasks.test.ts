/**
 * Trust Tasks module tests — the reference-rung checks (ref-06v1c / ref-06w4)
 * ported into bifold's suite, per the plan's Phase D gate acceptance
 * criterion. Same assertions, same published 0.9 pipeline; transport identity
 * stubbed exactly as the rungs stub it (the carriage itself is proven
 * separately by the rungs and, later, e2e).
 */
import type { AgentContext } from '@credo-ts/core'

import {
  TrustTaskMessage,
  TRUST_TASK_ATTACHMENT_ID,
  TRUST_TASK_ENVELOPE_TYPE,
  isTransportRepresentable,
  TrustTasksService,
  TrustTaskDocumentRepository,
  respondWith,
} from '../index'
import { TrustTaskDocumentRecord } from '../services/TrustTaskDocumentRecord'

// Generated spec modules from the published package (the Cypress 0.9 lock).
import * as propose from '@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload'
import * as session from '@openvtc/trust-tasks/witness/session/0.1/payload'
import * as submit from '@openvtc/trust-tasks/witness/session/submit/0.1/payload'

const NOW = () => '2026-08-18T12:00:00Z'
const DID = { alice: 'did:peer:4alice', bob: 'did:peer:4bob', wendy: 'did:peer:4wendy' }
const REL = { alice: 'did:peer:alice-rel', bob: 'did:peer:bob-rel' }

const STUB_PROOF = {
  type: 'DataIntegrityProof',
  cryptosuite: 'eddsa-jcs-2022',
  verificationMethod: 'did:example:stub#key-1',
  created: NOW(),
  proofPurpose: 'assertionMethod',
  proofValue: 'z3StubProofValueForPipelineShapeOnly',
}

// ---- in-memory storage backing a REAL repository ---------------------------

function makeService() {
  const records: TrustTaskDocumentRecord[] = []
  const storage = {
    save: async (_ctx: unknown, record: TrustTaskDocumentRecord) => {
      records.push(record)
    },
    update: async () => undefined,
    findByQuery: async (_ctx: unknown, _cls: unknown, query: Record<string, string>) =>
      records.filter((r) => Object.entries(query).every(([k, v]) => (r.getTags() as Record<string, unknown>)[k] === v)),
  }
  const eventEmitter = { emit: () => undefined } as never
  const repository = new TrustTaskDocumentRepository(storage as never, eventEmitter)
  const service = new TrustTasksService(repository)
  const agentContext = {} as AgentContext
  return { service, agentContext, records }
}

const proposeDoc = (extra: Record<string, unknown> = {}) => ({
  id: 'aaaa1111-1111-4111-8111-111111111111',
  type: propose.TYPE_URI,
  threadId: 'aaaa1111-1111-4111-8111-111111111111',
  issuer: DID.bob,
  recipient: DID.alice,
  issuedAt: NOW(),
  payload: { relationshipDid: REL.bob, witnessed: true },
  ...extra,
})

describe('TrustTaskMessage (binding 0.2 carriage)', () => {
  test('carries the document in the reserved attachment on the dedicated @type', () => {
    const doc = proposeDoc()
    const message = new TrustTaskMessage({ document: doc })
    expect(message.type).toBe(TRUST_TASK_ENVELOPE_TYPE)
    expect(message.appendedAttachments?.[0]?.id).toBe(TRUST_TASK_ATTACHMENT_ID)
    expect(message.document).toEqual(doc)
  })

  test('the omit rule: an unrepresentable threadId is omitted, never rewritten', () => {
    const doc = proposeDoc({ threadId: 'urn:uuid:4a0e2b77-88c1-4d55-9f2a-6c3d1e5b7a92' })
    const message = new TrustTaskMessage({ document: doc })
    // Inspect the decorator itself: Credo's threadId getter DEFAULTS to the
    // message @id when ~thread is absent (RFC 0008 — the very fact #212
    // documents as "omitting is not neutral"), so the getter can never be
    // undefined. The omit rule is about what goes on the wire.
    expect(message.thread?.threadId).toBeUndefined()
    // The in-band member is untouched — the document stays authoritative.
    expect((message.document as Record<string, unknown>).threadId).toBe('urn:uuid:4a0e2b77-88c1-4d55-9f2a-6c3d1e5b7a92')
  })

  test('representability boundaries match RFC 0008', () => {
    expect(isTransportRepresentable('short-7')).toBe(false)
    expect(isTransportRepresentable('eight--8')).toBe(true)
    expect(isTransportRepresentable('a'.repeat(64))).toBe(true)
    expect(isTransportRepresentable('a'.repeat(65))).toBe(false)
    expect(isTransportRepresentable('has:a:colon-in-it')).toBe(false)
  })
})

describe('TrustTasksService — the §7.2 pipeline on the published 0.9 lock', () => {
  test('a request without proof is rejected before the handler where proof is REQUIRED', async () => {
    const { service, agentContext } = makeService()
    const handler = jest.fn()
    const outcome = await service.consume(agentContext, {
      spec: submit.SPEC,
      document: {
        id: 'dddd4444-4444-4444-8444-444444444401',
        type: submit.TYPE_URI,
        threadId: 'bbbb2222-2222-4222-8222-222222222222',
        issuer: DID.bob,
        recipient: DID.wendy,
        issuedAt: NOW(),
        payload: { vp: {} },
      },
      myDid: DID.wendy,
      senderDid: DID.bob,
      handler,
    })
    expect(outcome.kind).toBe('rejected')
    expect((outcome as { error: { payload: { code: string } } }).error.payload.code).toBe('proofRequired')
    expect(handler).not.toHaveBeenCalled()
  })

  test('a nonsense payload is rejected with malformedRequest (schema validation is real, #230→#237)', async () => {
    const { service, agentContext } = makeService()
    const outcome = await service.consume(agentContext, {
      spec: propose.SPEC,
      document: proposeDoc({ payload: { wrongMember: true } }),
      myDid: DID.alice,
      senderDid: DID.bob,
      handler: (d) => d,
    })
    expect(outcome.kind).toBe('rejected')
    expect((outcome as { error: { payload: { code: string } } }).error.payload.code).toBe('malformedRequest')
  })

  test('the happy path: propose is handled, witnessed answered on the response, both retained', async () => {
    const { service, agentContext, records } = makeService()
    const outcome = await service.consume(agentContext, {
      spec: propose.SPEC,
      document: proposeDoc(),
      myDid: DID.alice,
      senderDid: DID.bob,
      handler: (doc) =>
        respondWith(doc as never, 'aaaa1111-0000-4000-8000-00000000000a', {
          accept: true,
          relationshipDid: REL.alice,
          witnessed: true,
        }, NOW),
    })
    expect(outcome.kind).toBe('handled')
    const response = (outcome as { response: { payload: { witnessed: boolean } } }).response
    expect(response.payload.witnessed).toBe(true)
    expect(records.map((r) => r.role).sort()).toEqual(['request', 'response'])
  })

  test('in-band issuer contradicting the transport sender → identityMismatch, handler never runs', async () => {
    const { service, agentContext } = makeService()
    const handler = jest.fn()
    const outcome = await service.consume(agentContext, {
      spec: propose.SPEC,
      document: proposeDoc({ issuer: 'did:example:carol', proof: STUB_PROOF }),
      myDid: DID.alice,
      senderDid: DID.bob,
      handler,
    })
    expect(outcome.kind).toBe('rejected')
    expect((outcome as { error: { payload: { code: string } } }).error.payload.code).toBe('identityMismatch')
    expect(handler).not.toHaveBeenCalled()
  })

  test('bilateral sessions: an unproofed session request is accepted (request proof OPTIONAL)', async () => {
    const { service, agentContext } = makeService()
    const outcome = await service.consume(agentContext, {
      spec: session.SPEC,
      document: {
        id: 'bbbb2222-2222-4222-8222-222222222222',
        type: session.TYPE_URI,
        threadId: 'bbbb2222-2222-4222-8222-222222222222',
        parentThreadId: 'aaaa1111-1111-4111-8111-111111111111',
        issuer: DID.bob,
        recipient: DID.wendy,
        issuedAt: NOW(),
        payload: { parties: [REL.alice, REL.bob] },
      },
      myDid: DID.wendy,
      senderDid: DID.bob,
      handler: (doc) => respondWith(doc as never, 'cccc2222-2222-4222-8222-222222222222', { challenge: 'nonce-bob-m1', domain: 'wendy.example' }, NOW),
    })
    expect(outcome.kind).toBe('handled')
  })

  test('the outcome-evidence pair is retrievable per exchange (initiating + terminal)', async () => {
    const { service, agentContext } = makeService()
    await service.consume(agentContext, {
      spec: propose.SPEC,
      document: proposeDoc(),
      myDid: DID.alice,
      senderDid: DID.bob,
      handler: (doc) => respondWith(doc as never, 'aaaa1111-0000-4000-8000-00000000000a', { accept: true, relationshipDid: REL.alice }, NOW),
    })
    const pair = await service.getOutcomeEvidencePair(agentContext, 'aaaa1111-1111-4111-8111-111111111111')
    expect(pair.initiating).toBeDefined()
    expect(pair.terminal).toBeDefined()
    expect(String(pair.terminal?.document.type)).toContain('#response')
  })
})
