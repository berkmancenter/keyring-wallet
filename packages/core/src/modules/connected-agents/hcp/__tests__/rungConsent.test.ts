/**
 * The rung's consent request, read by Keyring (backlog Section B, part 2): the `task-consent/request/0.1` payload the
 * reference rung builds for an HCP grant (`tsp-reference/ref-25-agent-pairing/hcp/consent.mjs`, recorded in
 * `fixtures/hcp-consent-request.json`) validates against VTI's own schema at `97fda9813`, arrives through
 * `keepManagerMessage` as every consent request does (which keeps the document's `parentThreadId`, the thread VTI
 * hcp.md §5.1 matches on). The rung still records the five effect kinds from before §5.1, which Keyring no longer reads;
 * the same envelope with the §5.1 effects (`fixtures/hcpApproval.ts`) validates and is found for the link of the
 * match-number vectors' first case. The rung's `hcp/hcp.test.mjs` holds the other direction.
 */
import Ajv from 'ajv/dist/2020'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

import { VTA_TASK } from '../../../trust-tasks/module/VtaClient'
import { keepManagerMessage, type VtiApproval } from '../../../trust-tasks/module/vtaAgent'
import { findHcpApproval, readHcpEffects } from '../approvals'
import { readHcpConnectLink } from '../connectLink'
import { HCP_GRANTS_REQUEST, type HcpConnectLink } from '../types'
import { hcpEffects } from './fixtures/hcpApproval'
import vectors from './vectors/match-number.json'

const RUNG_FIXTURE = join(
  __dirname,
  '../../../../../../../tsp-reference/ref-25-agent-pairing/fixtures/hcp-consent-request.json'
)
const VTI_BUNDLE = join(__dirname, 'fixtures/vti-task-consent-97fda9813/0.1.bundle.json')

type Payload = Record<string, unknown>

function rungPayload(): Payload {
  expect(existsSync(RUNG_FIXTURE)).toBe(true)
  const fixture = JSON.parse(readFileSync(RUNG_FIXTURE, 'utf8')) as { version: number; payload: Payload }
  expect(fixture.version).toBe(1)
  return fixture.payload
}

/**
 * VTI's `task-consent/request/0.1` schema (the bundle's `schema` member), compiled. Keyring has no `ajv-formats`, so
 * the two formats the schema names are checked here: an RFC 3339 `date-time` and an absolute `uri`.
 */
function consentRequestSchema() {
  const bundle = JSON.parse(readFileSync(VTI_BUNDLE, 'utf8')) as { typeUri: string; schema: Record<string, unknown> }
  expect(bundle.typeUri).toBe(VTA_TASK.consentRequest)
  const ajv = new Ajv({ strict: false, allErrors: true, logger: false })
  ajv.addFormat('date-time', {
    type: 'string',
    validate: (v: string) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i.test(v) && Number.isFinite(Date.parse(v)),
  })
  ajv.addFormat('uri', { type: 'string', validate: (v: string) => /^[a-z][a-z0-9+.-]*:[^\s]+$/i.test(v) })
  return ajv.compile(bundle.schema)
}

/** The payload as `vtaAgent` lists it: the DIDComm message body it arrives in, through `keepManagerMessage`. */
function received(payload: Payload, now: number, parentThreadId?: unknown): VtiApproval {
  const message = {
    id: 'msg-1',
    type: VTA_TASK.consentRequest,
    body: { id: 'consent-1', type: VTA_TASK.consentRequest, payload, parentThreadId },
  }
  const kept = keepManagerMessage(message as never, now)
  if (!kept || !('approval' in kept)) throw new Error('keepManagerMessage did not keep the consent request')
  return kept.approval
}

/** The rung's envelope with the VTI hcp.md §5.1 effects in place of its five. */
const v0Payload = (): Payload => ({ ...rungPayload(), effects: hcpEffects() })

const first = vectors.cases[0]
const link = readHcpConnectLink(
  `https://link.trustoverip.org/t#_from=${first.clientVid}&_id=${first.threadId.slice('urn:uuid:'.length)}&_type=/vti/flow/hcp-connect/0.1`
) as HcpConnectLink

describe("the rung's HCP consent request", () => {
  const validate = consentRequestSchema()

  it('validates against VTI’s task-consent/request/0.1 schema', () => {
    const payload = rungPayload()
    const ok = validate(payload)
    if (!ok) throw new Error(JSON.stringify(validate.errors, null, 1))
    expect(payload.taskType).toBe(HCP_GRANTS_REQUEST)
  })

  it('control: without a member the schema requires, it does not validate', () => {
    const { excludeRequester: _gone, ...payload } = rungPayload()
    expect(validate(payload)).toBe(false)
    expect(validate({ ...rungPayload(), expiresAt: 'in five minutes' })).toBe(false)
  })

  it('the rung’s recorded five kinds are the contract before §5.1: they are not read', () => {
    const approval = received(rungPayload(), Date.parse('2026-11-27T10:00:01.000Z'), first.threadId)
    expect((rungPayload().effects as { kind: string }[]).map((e) => e.kind)).toContain('hcpGrantClient')
    expect(readHcpEffects(approval)).toBeUndefined()
  })

  it('with the §5.1 effects, the envelope validates and reads, the summaries verbatim', () => {
    const payload = v0Payload()
    const ok = validate(payload)
    if (!ok) throw new Error(JSON.stringify(validate.errors, null, 1))
    const effects = readHcpEffects(received(payload, Date.parse('2026-11-27T10:00:01.000Z'), first.threadId))
    expect(effects?.client.clientId).toBe(first.clientVid)
    expect(effects?.rows).toEqual(hcpEffects().map((e) => e.summary))
  })

  it('keepManagerMessage keeps the document’s parentThreadId on the approval, and only a string one', () => {
    const now = Date.parse('2026-11-27T10:00:01.000Z')
    expect(received(v0Payload(), now, first.threadId).parentThreadId).toBe(first.threadId)
    expect(received(v0Payload(), now, 7)).not.toHaveProperty('parentThreadId')
    expect(received(v0Payload(), now)).not.toHaveProperty('parentThreadId')
  })

  it('is found for the link of the match-number vectors’ first case while it is pending', () => {
    expect(link).toBeDefined()
    const now = Date.parse('2026-11-27T10:04:59.000Z')
    const approval = received(v0Payload(), Date.parse('2026-11-27T10:00:01.000Z'), first.threadId)
    expect(findHcpApproval([approval], link, new Date(now))).toBe(approval)
    // control: without the parentThreadId it names no thread, so it is not found.
    expect(findHcpApproval([received(v0Payload(), now)], link, new Date(now))).toBeUndefined()
  })

  it('control: with its expiresAt in the past, it is not found', () => {
    const now = new Date('2026-11-27T10:00:01.000Z')
    const stale = received({ ...v0Payload(), expiresAt: '2026-11-27T10:00:00.000Z' }, now.getTime(), first.threadId)
    expect(findHcpApproval([stale], link, now)).toBeUndefined()
    const fresh = received(v0Payload(), now.getTime(), first.threadId)
    expect(findHcpApproval([fresh], link, now)).toBe(fresh)
  })
})
