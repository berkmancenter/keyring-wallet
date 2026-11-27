/**
 * The C10 seam: each of `entries/get`, `withdraw` and `revise` without a token sends nothing and answers
 * `needsToken`; with a token the payload carries it as `accessToken` and validates against the vendored schema; a
 * task that needs no token goes as before; and the port's outcomes pass through.
 */
import { HcpOffError, type HcpVtaPort } from '../../vtaPort'
import {
  HCP_ENTRIES_GET,
  HCP_ENTRIES_REVISE,
  HCP_ENTRIES_WITHDRAW,
  HCP_TOKEN_REQUIRED_TASKS,
  hcpManagementCall,
} from '../management'
import { entriesSchemas, expectValid } from './fixtures/entriesSchemas'

const S = entriesSchemas()
const ENTRY = 'urn:uuid:7c1e2a4b-9d3f-4e5a-8b6c-0d1e2f3a4b5c'
const TOKEN = 'opaque-hcp-access-token'

/** A payload of each task, as a Management Client names an entry, without `accessToken`. */
const PAYLOADS: [string, Record<string, unknown>][] = [
  [HCP_ENTRIES_GET, { entryId: ENTRY, purpose: 'https://purpose.example/assist' }],
  [HCP_ENTRIES_WITHDRAW, { entryId: ENTRY, reason: 'Deleted by the person' }],
  [
    HCP_ENTRIES_REVISE,
    {
      entryId: ENTRY,
      expectedVersion: 1,
      content: { profile: 'https://hcp.example/spec/profiles/general-context/2.0', value: 'Prefers tea' },
      reason: 'Edited by the person',
    },
  ],
]

const refusal = (code?: string) => Object.assign(new Error('refused'), { name: 'VtiRefusal', code })

function fakePort(answer: () => unknown = () => ({ status: 'deleted', respondedAt: '2026-11-27T12:00:00Z' })) {
  const sent: { type: string; payload: Record<string, unknown> }[] = []
  const port: HcpVtaPort = {
    task: jest.fn(async (type: string, payload: Record<string, unknown>) => {
      sent.push({ type, payload })
      return answer()
    }),
  }
  return { port, sent }
}

describe('hcpManagementCall', () => {
  it('the three token tasks are entries/get, withdraw and revise at the suite pin', () => {
    expect(HCP_TOKEN_REQUIRED_TASKS).toEqual([
      'https://trusttasks.org/spec/hcp/entries/get/0.1',
      'https://trusttasks.org/spec/hcp/entries/withdraw/0.1',
      'https://trusttasks.org/spec/hcp/entries/revise/0.1',
    ])
  })

  it.each(PAYLOADS)('%s without a token sends nothing and answers needsToken', async (type, payload) => {
    const { port, sent } = fakePort()
    await expect(hcpManagementCall(port, type, payload, { none: true })).resolves.toEqual({
      ok: false,
      needsToken: true,
    })
    expect(sent).toEqual([])
    expect(port.task).not.toHaveBeenCalled()
  })

  it.each(PAYLOADS)('%s with a token sends it as accessToken, valid for the schema', async (type, payload) => {
    const { port, sent } = fakePort()
    const outcome = await hcpManagementCall(port, type, payload, { token: TOKEN })
    expect(outcome.ok).toBe(true)
    expect(sent).toEqual([{ type, payload: { ...payload, accessToken: TOKEN } }])
    expectValid(S[type].request, sent[0].payload)
  })

  it('withdraw with a token: the answer comes back as the value, and the fake answer is valid for the schema', async () => {
    const answer = { entryId: ENTRY, status: 'deleted', respondedAt: '2026-11-27T12:00:00Z' }
    expectValid(S[HCP_ENTRIES_WITHDRAW].response, answer)
    const { port } = fakePort(() => answer)
    await expect(hcpManagementCall(port, HCP_ENTRIES_WITHDRAW, PAYLOADS[1][1], { token: TOKEN })).resolves.toEqual({
      ok: true,
      value: answer,
    })
  })

  it('a token is the only source of accessToken: one already in the payload is dropped or replaced', async () => {
    const { port, sent } = fakePort()
    const other = 'https://trusttasks.org/spec/hcp/disclosures/summary/0.1'
    await hcpManagementCall(port, other, { accessToken: 'stale' }, { none: true })
    await hcpManagementCall(port, HCP_ENTRIES_WITHDRAW, { ...PAYLOADS[1][1], accessToken: 'stale' }, { token: TOKEN })
    await expect(
      hcpManagementCall(port, HCP_ENTRIES_WITHDRAW, { ...PAYLOADS[1][1], accessToken: 'stale' }, { none: true })
    ).resolves.toEqual({ ok: false, needsToken: true })
    expect(sent.map((s) => s.payload.accessToken)).toEqual([undefined, TOKEN])
    expect(sent[0].payload).not.toHaveProperty('accessToken')
  })

  it('a task outside the three goes without a token, as every Management Client task does today', async () => {
    const { port, sent } = fakePort(() => ({}))
    const other = 'https://trusttasks.org/spec/hcp/grants/revoke/0.1'
    await expect(hcpManagementCall(port, other, { grantId: ENTRY }, { none: true })).resolves.toEqual({
      ok: true,
      value: {},
    })
    expect(sent).toEqual([{ type: other, payload: { grantId: ENTRY } }])
  })

  it.each([
    ['a refusal', () => Promise.reject(refusal('hcp:forbidden')), { ok: false, refused: 'hcp:forbidden' }],
    ['an unreachable VTA', () => Promise.reject(new Error('timeout')), { ok: false, unreachable: true }],
    ['the HCP flags off', () => Promise.reject(new HcpOffError()), { ok: false, off: true }],
  ])('with a token, %s comes back as callHcp gives it', async (_, task, expected) => {
    const port: HcpVtaPort = { task: jest.fn(task) }
    await expect(hcpManagementCall(port, HCP_ENTRIES_GET, PAYLOADS[0][1], { token: TOKEN })).resolves.toEqual(expected)
  })

  // control: the schema check bites: each task's payload without accessToken fails its schema, which is why the
  // seam never sends one of them without a token.
  it.each(PAYLOADS)('control: %s without accessToken is refused by its schema', (type, payload) => {
    expect(S[type].request(payload)).toBe(false)
    expect(S[type].request({ ...payload, accessToken: '' })).toBe(false)
    expect(S[type].request({ ...payload, accessToken: TOKEN })).toBe(true)
  })
})
