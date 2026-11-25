import { isProblemReport, PROBLEM_REPORT, problemReportWords } from '../module/problemReportWords'

const LONG_DID = 'did:webvh:QmLongScidValue1234567890abcdef:host.example:someone'

describe('problemReportWords', () => {
  it('reads the code, the words and the thread', () => {
    expect(
      problemReportWords({ thid: 'urn:uuid:t1', body: { code: 'e.p.msg.bad-request', comment: ' not  this\ntype ' } })
    ).toBe('e.p.msg.bad-request — not this type (thread urn:uuid:t1)')
  })

  it('falls back to the parent thread, then says there is none', () => {
    expect(problemReportWords({ pthid: 'urn:uuid:parent', body: { code: 'e.p.x' } })).toBe(
      'e.p.x (thread urn:uuid:parent)'
    )
    expect(problemReportWords({ body: {} })).toBe('no code (no thread)')
    expect(problemReportWords({})).toBe('no code (no thread)')
  })

  it('cuts every DID in the words to its prefix', () => {
    // This comment has no placeholder, so filling args would change nothing:
    // the args line is proved by the placeholder row below, not here.
    const line = problemReportWords({
      body: { code: 'e.p.msg.unknown', comment: `from ${LONG_DID}, to ${LONG_DID}.`, args: ['secret-arg'] },
    })
    expect(line).toBe('e.p.msg.unknown — from did:webvh:QmLongScidValu…, to did:webvh:QmLongScidValu…. (no thread)')
    expect(line).not.toContain(LONG_DID)
    expect(line).not.toContain('secret-arg')
  })

  it("leaves a comment's placeholders unfilled: the values in args are never read", () => {
    const line = problemReportWords({
      body: { code: 'e.p.msg.unknown-recipient', comment: 'No route to {1} for {2}', args: [LONG_DID, 'key-1'] },
    })
    expect(line).toBe('e.p.msg.unknown-recipient — No route to {1} for {2} (no thread)')
  })

  it('says a DID as "a DID" when even a prefix would say too much', () => {
    expect(problemReportWords({ body: { code: 'e.p.x', comment: `vetter ${LONG_DID}` } }, { hideDids: true })).toBe(
      'e.p.x — vetter a DID (no thread)'
    )
  })

  it('keeps a long comment to one short line', () => {
    const line = problemReportWords({ body: { code: 'e.p.x', comment: 'y'.repeat(500) } })
    expect(line.length).toBeLessThan(260)
  })

  it('knows a problem-report by its type', () => {
    expect(isProblemReport({ type: PROBLEM_REPORT })).toBe(true)
    expect(isProblemReport({ type: 'https://didcomm.org/report-problem/1.0/problem-report' })).toBe(false)
    expect(isProblemReport({})).toBe(false)
  })
})
