/**
 * Learning a grant's id after approval (VTI hcp.md §5.1 pre-assigns none): the one `grant.issued` event for the client
 * inside the record's issue window, never a grant Keyring already holds, and no guess when two could be ours. Every
 * read sent and every answer given validates against the vendored `hcp/audit/read/0.1` schema.
 */
import {
  HCP_AUDIT_SKEW_MS,
  HCP_GRANT_ISSUE_WINDOW_MS,
  HCP_GRANT_ISSUED_EVENT,
  type HcpHeldApproval,
  learnHcpGrantId,
} from '../grantId'
import { HCP_AUDIT_READ } from '../whatItSaw/audit'
import { auditEvent, fakeVta, refusal } from '../whatItSaw/__tests__/fixtures/fakeVta'
import { whatItSawSchemas } from '../whatItSaw/__tests__/fixtures/whatItSawSchemas'
import { expectValid } from './fixtures/hcpSchemas'
import { CLIENT_VID, GRANT, OTHER_THREAD, THREAD } from './fixtures/hcpApproval'

const S = whatItSawSchemas()
const SINCE = Date.parse('2026-11-27T10:00:30.000Z')
const DECIDED = SINCE + 20 * 1000
const iso = (ms: number) => new Date(ms).toISOString()
const A = 'urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'urn:uuid:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const issued = (grantId: string, at: number, data?: Record<string, unknown>) =>
  auditEvent(HCP_GRANT_ISSUED_EVENT, iso(at), { grantId, ...(data ? { data } : {}) })
const RECORD: HcpHeldApproval = { threadId: THREAD, since: iso(SINCE), decidedBy: iso(DECIDED) }
const WINDOW_END = DECIDED + HCP_GRANT_ISSUE_WINDOW_MS + HCP_AUDIT_SKEW_MS

function vta(events: unknown[]) {
  return fakeVta((type, payload) => {
    expectValid(S[type].request, payload)
    const answer = { events }
    expectValid(S[HCP_AUDIT_READ].response, answer)
    return answer
  })
}

const learn = (events: unknown[], held: HcpHeldApproval[] = [], record = RECORD) => {
  const v = vta(events)
  return { v, result: learnHcpGrantId(v.port, { clientVid: CLIENT_VID, record, held }) }
}

describe('learnHcpGrantId', () => {
  it('reads grant.issued for the client from the start less the skew, and takes the one in the window', async () => {
    const { v, result } = learn([issued(GRANT, SINCE + 2000, { expiresAt: '2026-11-27T11:00:30Z' })])
    expect(await result).toEqual({
      ok: true,
      grantId: GRANT,
      issuedAt: iso(SINCE + 2000),
      expiresAt: '2026-11-27T11:00:30Z',
    })
    expect(v.calls).toHaveLength(1)
    expect(v.calls[0].type).toBe(HCP_AUDIT_READ)
    expect(v.calls[0].payload).toMatchObject({
      client: CLIENT_VID,
      eventType: HCP_GRANT_ISSUED_EVENT,
      from: iso(SINCE - HCP_AUDIT_SKEW_MS),
    })
  })

  it('two grants in the window are ambiguous: no guess (a second Management Client, or two approvals)', async () => {
    expect(await learn([issued(B, SINCE + 9000), issued(GRANT, SINCE + 2000)]).result).toEqual({
      ok: true,
      ambiguous: true,
    })
  })

  it('a grant after the window is not ours, and does not make it ambiguous', async () => {
    expect(await learn([issued(GRANT, SINCE + 2000), issued(A, WINDOW_END + 1)]).result).toMatchObject({
      grantId: GRANT,
    })
    expect(await learn([issued(A, WINDOW_END + 1)]).result).toEqual({ ok: true, notIssued: true })
  })

  it('never takes a grant Keyring already holds for the client', async () => {
    const held: HcpHeldApproval[] = [{ threadId: OTHER_THREAD, grantId: GRANT, since: iso(SINCE - 60 * 60 * 1000) }]
    expect(await learn([issued(GRANT, SINCE + 2000), issued(A, SINCE + 5000)], held).result).toMatchObject({
      grantId: A,
    })
  })

  it('takes a grant issued within the skew before the start, and not one before that', async () => {
    expect(
      await learn([issued(A, SINCE - HCP_AUDIT_SKEW_MS - 1), issued(GRANT, SINCE - HCP_AUDIT_SKEW_MS)]).result
    ).toMatchObject({ grantId: GRANT })
  })

  it('refuses to guess, reading nothing, while another unlearnt approval of the client overlaps the window', async () => {
    const other: HcpHeldApproval = { threadId: OTHER_THREAD, since: iso(SINCE + 5000), decidedBy: iso(SINCE + 9000) }
    const { v, result } = learn([issued(GRANT, SINCE + 2000)], [other])
    expect(await result).toEqual({ ok: true, ambiguous: true })
    expect(v.calls).toHaveLength(0)
  })

  it('control: an unlearnt approval whose window ends before this one starts, or a learnt one, is no conflict', async () => {
    const before: HcpHeldApproval = {
      threadId: OTHER_THREAD,
      since: iso(SINCE - 2 * HCP_GRANT_ISSUE_WINDOW_MS),
      decidedBy: iso(SINCE - 2 * HCP_GRANT_ISSUE_WINDOW_MS),
    }
    expect(await learn([issued(GRANT, SINCE + 2000)], [before]).result).toMatchObject({ grantId: GRANT })
    const learnt: HcpHeldApproval = { ...before, since: iso(SINCE), grantId: A }
    expect(await learn([issued(GRANT, SINCE + 2000)], [learnt]).result).toMatchObject({ grantId: GRANT })
    // A record of the same thread (the connection and its leftover approval in flight) is this one.
    expect(await learn([issued(GRANT, SINCE + 2000)], [{ ...RECORD }]).result).toMatchObject({ grantId: GRANT })
  })

  it('an event naming this thread in its data is taken whatever else is there; one naming another is not', async () => {
    expect(
      await learn([issued(B, SINCE + 1000), issued(GRANT, SINCE + 2000, { threadId: THREAD })]).result
    ).toMatchObject({ grantId: GRANT })
    expect(await learn([issued(B, SINCE + 1000, { threadId: OTHER_THREAD })]).result).toEqual({
      ok: true,
      notIssued: true,
    })
  })

  it('ignores events of another type, or with no grant', async () => {
    expect(
      await learn([auditEvent('context.read', iso(SINCE + 1000), { grantId: A }), issued(GRANT, SINCE + 2000)]).result
    ).toMatchObject({ grantId: GRANT })
  })

  it('with no such event, or an unreadable start, gives notIssued', async () => {
    expect(await learn([]).result).toEqual({ ok: true, notIssued: true })
    const { v, result } = learn([issued(GRANT, SINCE)], [], { ...RECORD, since: 'not a time' })
    expect(await result).toEqual({ ok: true, notIssued: true })
    expect(v.calls).toHaveLength(0)
  })

  it('a refused or failed read gives its failure, not notIssued', async () => {
    const refused = fakeVta(() => {
      throw refusal('permissionDenied')
    })
    expect(await learnHcpGrantId(refused.port, { clientVid: CLIENT_VID, record: RECORD })).toMatchObject({
      ok: false,
    })
    const down = fakeVta(() => {
      throw new Error('timeout')
    })
    expect(await learnHcpGrantId(down.port, { clientVid: CLIENT_VID, record: RECORD })).toMatchObject({ ok: false })
  })
})
