/**
 * `readHcpAudit` against a fake VTA port: it sends `hcp/audit/read/0.1` `{ client, limit }` (and `cursor` after the
 * first page), follows `nextCursor`, stops at 500 events with `cut`, and keeps a refusal, an unreachable VTA and the
 * flags off apart. Every request sent and every answer given validates against the vendored schema.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import { HcpOffError } from '../../vtaPort'
import { HCP_AUDIT_MALFORMED, HCP_AUDIT_MAX_EVENTS, HCP_AUDIT_PAGE_LIMIT, HCP_AUDIT_READ, readHcpAudit } from '../audit'
import { auditEvent, CLIENT, fakeVta, readEvent, refusal } from './fixtures/fakeVta'
import { expectValid, readWhatItSawSchema, WHAT_IT_SAW_SUITE_DIR, whatItSawSchemas } from './fixtures/whatItSawSchemas'

const S = whatItSawSchemas()[HCP_AUDIT_READ]
const at = (i: number) => new Date(Date.parse('2026-11-27T10:00:00.000Z') + i * 1000).toISOString()

/** A page of `n` reads starting at index `from`, checked against the response schema. */
function page(from: number, n: number, nextCursor?: string) {
  const answer: Record<string, unknown> = {
    events: Array.from({ length: n }, (_, i) => readEvent(at(from + i), ['general_preferences'])),
  }
  if (nextCursor !== undefined) answer.nextCursor = nextCursor
  expectValid(S.response, answer)
  return answer
}

describe('the vendored audit/read schema', () => {
  it('is pinned at the commit track C vendored, under the type URI Keyring sends', () => {
    expect(readWhatItSawSchema('specs/hcp/audit/read/0.1/payload.schema.json').$id).toBe(HCP_AUDIT_READ)
    expect(readFileSync(join(WHAT_IT_SAW_SUITE_DIR, 'SUITE_COMMIT.sha'), 'utf8')).toBe(
      '4e2dd42fae13452fe30f0e077f359110bb2ad414\n'
    )
  })

  it('control: refuses an event with a required member removed, and a request with a member it does not know', () => {
    const event: Record<string, unknown> = auditEvent('grant.issued', at(0))
    delete event.grantId
    expect(S.response({ events: [event] })).toBe(false)
    expect(S.request({ client: CLIENT, limit: 100, grantId: 'x' })).toBe(false)
  })
})

describe('readHcpAudit', () => {
  it('sends { client, limit } with no accessToken, valid against the schema, and reads one page', async () => {
    const vta = fakeVta(() => page(0, 3))
    const read = await readHcpAudit(vta.port, { client: CLIENT, limit: 100 })
    expect(vta.calls).toEqual([{ type: HCP_AUDIT_READ, payload: { client: CLIENT, limit: 100 } }])
    expectValid(S.request, vta.calls[0].payload)
    expect(read.events.map((e) => e.timestamp)).toEqual([at(0), at(1), at(2)])
    expect(read).toMatchObject({ cut: false })
    expect(read.failure).toBeUndefined()
  })

  it('asks for pages of 100 unless told otherwise, and starts from a given cursor', async () => {
    const vta = fakeVta(() => page(0, 1))
    await readHcpAudit(vta.port, { client: CLIENT, cursor: 'c0' })
    expect(vta.calls[0].payload).toEqual({ client: CLIENT, limit: HCP_AUDIT_PAGE_LIMIT, cursor: 'c0' })
    expectValid(S.request, vta.calls[0].payload)
  })

  it('follows nextCursor until it is absent', async () => {
    const vta = fakeVta((_, __, n) => (n === 1 ? page(0, 100, 'c1') : n === 2 ? page(100, 100, 'c2') : page(200, 5)))
    const read = await readHcpAudit(vta.port, { client: CLIENT })
    expect(vta.calls.map((c) => c.payload.cursor)).toEqual([undefined, 'c1', 'c2'])
    for (const c of vta.calls) expectValid(S.request, c.payload)
    expect(read.events).toHaveLength(205)
    expect(read.cut).toBe(false)
  })

  it('stops at 500 events and says the list is cut when the VTA offers more', async () => {
    const vta = fakeVta((_, __, n) => page((n - 1) * 100, 100, `c${n}`))
    const read = await readHcpAudit(vta.port, { client: CLIENT })
    expect(vta.calls).toHaveLength(5)
    expect(read.events).toHaveLength(HCP_AUDIT_MAX_EVENTS)
    expect(read.cut).toBe(true)
  })

  it('at exactly 500 with no nextCursor the list is whole', async () => {
    const vta = fakeVta((_, __, n) => page((n - 1) * 100, 100, n < 5 ? `c${n}` : undefined))
    const read = await readHcpAudit(vta.port, { client: CLIENT })
    expect(read.events).toHaveLength(500)
    expect(read.cut).toBe(false)
  })

  it('never asks past the maximum, and cuts a VTA that ignores the limit', async () => {
    const vta = fakeVta((_, __, n) => (n === 1 ? page(0, 450, 'c1') : page(450, 100, 'c2')))
    const read = await readHcpAudit(vta.port, { client: CLIENT, limit: 450 })
    expect(vta.calls[1].payload.limit).toBe(50)
    expect(read.events).toHaveLength(500)
    expect(read.events[499].timestamp).toBe(at(499))
    expect(read.cut).toBe(true)
  })

  it('stops on an empty page or a repeated cursor, so a VTA cannot hold it', async () => {
    const empty = fakeVta((_, __, n) => (n === 1 ? page(0, 2, 'c1') : page(2, 0, 'c2')))
    expect((await readHcpAudit(empty.port, { client: CLIENT })).events).toHaveLength(2)
    expect(empty.calls).toHaveLength(2)
    const repeat = fakeVta((_, __, n) => page(n, 1, 'same'))
    expect((await readHcpAudit(repeat.port, { client: CLIENT })).events).toHaveLength(2)
    expect(repeat.calls).toHaveLength(2)
  })

  it('leaves out a malformed event, not the page', async () => {
    const vta = fakeVta(() => ({ events: [{ eventType: 'context.read' }, readEvent(at(0), ['work_context'])] }))
    const read = await readHcpAudit(vta.port, { client: CLIENT })
    expect(read.events).toHaveLength(1)
    expect(read.events[0]).toMatchObject({ categories: ['work_context'], grantId: expect.any(String) })
  })

  it('an answer with no events list is a refusal of its own code, not unreachable', async () => {
    const vta = fakeVta(() => ({ entries: [] }))
    const read = await readHcpAudit(vta.port, { client: CLIENT })
    expect(read).toEqual({ events: [], cut: false, failure: { ok: false, refused: HCP_AUDIT_MALFORMED } })
  })

  it('keeps a refusal, an unreachable VTA and the flags off apart, with the pages read before them', async () => {
    const fails = (error: Error) => fakeVta((_, __, n) => (n === 1 ? page(0, 2, 'c1') : Promise.reject(error)))
    const refused = await readHcpAudit(fails(refusal()).port, { client: CLIENT })
    expect(refused.failure).toEqual({ ok: false, refused: 'permissionDenied' })
    expect(refused.events).toHaveLength(2)
    const unreachable = await readHcpAudit(fails(new Error('timeout')).port, { client: CLIENT })
    expect(unreachable.failure).toEqual({ ok: false, unreachable: true })
    const off = await readHcpAudit(fails(new HcpOffError()).port, { client: CLIENT })
    expect(off.failure).toEqual({ ok: false, off: true })
  })

  it('control: a page past the maximum is not read when the cap is honoured', async () => {
    const vta = fakeVta((_, __, n) => page((n - 1) * 100, 100, `c${n}`))
    await readHcpAudit(vta.port, { client: CLIENT })
    // With the cap removed this would be a sixth call.
    expect(vta.calls.find((c) => c.payload.cursor === 'c5')).toBeUndefined()
  })
})
