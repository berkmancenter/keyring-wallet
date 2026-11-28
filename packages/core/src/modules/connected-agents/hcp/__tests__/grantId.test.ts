/**
 * Learning a grant's id after approval (VTI hcp.md §5.1 pre-assigns none): the earliest `grant.issued` event for the
 * client from the approval's start (less the clock skew), never a grant Keyring already holds. Every read sent and
 * every answer given validates against the vendored `hcp/audit/read/0.1` schema.
 */
import { HCP_AUDIT_SKEW_MS, HCP_GRANT_ISSUED_EVENT, learnHcpGrantId } from '../grantId'
import { HCP_AUDIT_READ } from '../whatItSaw/audit'
import { auditEvent, fakeVta, refusal } from '../whatItSaw/__tests__/fixtures/fakeVta'
import { whatItSawSchemas } from '../whatItSaw/__tests__/fixtures/whatItSawSchemas'
import { expectValid } from './fixtures/hcpSchemas'
import { CLIENT_VID, GRANT } from './fixtures/hcpApproval'

const S = whatItSawSchemas()
const SINCE = Date.parse('2026-11-27T10:00:30.000Z')
const iso = (ms: number) => new Date(ms).toISOString()
const A = 'urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'urn:uuid:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const issued = (grantId: string, at: number) => auditEvent(HCP_GRANT_ISSUED_EVENT, iso(at), { grantId })

function vta(events: unknown[]) {
  return fakeVta((type, payload) => {
    expectValid(S[type].request, payload)
    const answer = { events }
    expectValid(S[HCP_AUDIT_READ].response, answer)
    return answer
  })
}

describe('learnHcpGrantId', () => {
  it('reads grant.issued for the client from the start less the skew, and takes the earliest', async () => {
    const v = vta([issued(B, SINCE + 9000), issued(GRANT, SINCE + 2000), issued(A, SINCE + 5000)])
    expect(await learnHcpGrantId(v.port, { clientVid: CLIENT_VID, since: iso(SINCE) })).toEqual({
      ok: true,
      grantId: GRANT,
    })
    expect(v.calls).toHaveLength(1)
    expect(v.calls[0].type).toBe(HCP_AUDIT_READ)
    expect(v.calls[0].payload).toMatchObject({
      client: CLIENT_VID,
      eventType: HCP_GRANT_ISSUED_EVENT,
      from: iso(SINCE - HCP_AUDIT_SKEW_MS),
    })
  })

  it('never takes a grant Keyring already holds', async () => {
    const v = vta([issued(GRANT, SINCE + 2000), issued(A, SINCE + 5000)])
    expect(await learnHcpGrantId(v.port, { clientVid: CLIENT_VID, since: iso(SINCE), exclude: [GRANT] })).toEqual({
      ok: true,
      grantId: A,
    })
  })

  it('takes a grant issued within the skew before the start, and not one before that', async () => {
    const v = vta([issued(A, SINCE - HCP_AUDIT_SKEW_MS - 1), issued(GRANT, SINCE - HCP_AUDIT_SKEW_MS)])
    expect(await learnHcpGrantId(v.port, { clientVid: CLIENT_VID, since: iso(SINCE) })).toEqual({
      ok: true,
      grantId: GRANT,
    })
  })

  it('ignores events of another type, or with no grant', async () => {
    const v = vta([auditEvent('context.read', iso(SINCE + 1000), { grantId: A }), issued(GRANT, SINCE + 2000)])
    expect(await learnHcpGrantId(v.port, { clientVid: CLIENT_VID, since: iso(SINCE) })).toEqual({
      ok: true,
      grantId: GRANT,
    })
  })

  it('with no such event, or an unreadable start, gives notIssued', async () => {
    expect(await learnHcpGrantId(vta([]).port, { clientVid: CLIENT_VID, since: iso(SINCE) })).toEqual({
      ok: true,
      notIssued: true,
    })
    const v = vta([issued(GRANT, SINCE)])
    expect(await learnHcpGrantId(v.port, { clientVid: CLIENT_VID, since: 'not a time' })).toEqual({
      ok: true,
      notIssued: true,
    })
    expect(v.calls).toHaveLength(0)
  })

  it('a refused or failed read gives its failure, not notIssued', async () => {
    const refused = fakeVta(() => {
      throw refusal('permissionDenied')
    })
    expect(await learnHcpGrantId(refused.port, { clientVid: CLIENT_VID, since: iso(SINCE) })).toMatchObject({
      ok: false,
    })
    const down = fakeVta(() => {
      throw new Error('timeout')
    })
    expect(await learnHcpGrantId(down.port, { clientVid: CLIENT_VID, since: iso(SINCE) })).toMatchObject({ ok: false })
  })
})
