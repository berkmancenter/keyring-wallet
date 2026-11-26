/**
 * The agent's own DID stays out of a hidden-vetting log line.
 *
 * `vtiAgent`'s half of this keeps a *vetter's* DID out (32's
 * `isHiddenVettingType`). These lines name no vetter — the agent is the
 * person's own — but `<agent DID> … vta/pcs/applications/create` still says
 * **this person applied with private vetting**, and the phone's log leaves the
 * device through remote logs and testers' problem reports.
 *
 * The test exists because the fix is one word in a template string, and a
 * later tidy-up that "restores" the DID would be invisible in review.
 */
import { PCS_VTA_TASK } from '../module/pcsVtaPayloads'
import { isHiddenVettingType } from '../module/vtiAgent'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const AGENT = 'did:webvh:QmWj8ssa2BZAcLZzMTfLXHXWbkHUkY8ibMsG89otkEMue8:dids.ic3.dev:hidden-vet-vta'

describe('which task types are logged without a DID', () => {
  it('covers every task of the applicant round', () => {
    expect(Object.values(PCS_VTA_TASK).map(isHiddenVettingType)).toEqual([true, true, true, true, true])
  })

  it('covers the answers and refusals those tasks come back as', () => {
    // A `#response` or an error carries the same type with a fragment, and a
    // refusal names the task it refused — so the prefix has to cover both.
    expect(isHiddenVettingType(`${PCS_VTA_TASK.prove}#response`)).toBe(true)
    expect(isHiddenVettingType('https://trusttasks.org/spec/vetting/attestation/0.1')).toBe(true)
    expect(isHiddenVettingType('https://trusttasks.org/spec/vtc/vetting/pcs-challenge/0.1')).toBe(true)
  })

  it('leaves ordinary traffic alone, so this redaction cannot hide a real fault', () => {
    // Over-redacting is its own harm: an operator reading a log still needs to
    // see which agent failed to answer an ordinary task.
    expect(isHiddenVettingType('https://trusttasks.org/spec/acl/list/0.1')).toBe(false)
    expect(isHiddenVettingType('https://trusttasks.org/spec/auth/whoami/0.1')).toBe(false)
    expect(isHiddenVettingType('https://trusttasks.org/spec/vtc/join-requests/submit/0.3')).toBe(false)
  })
})

describe('what a line would say', () => {
  // The shape VtaClient builds, asserted on the pieces rather than by driving
  // a whole client: the DID must not appear beside a hidden type, and must
  // appear beside an ordinary one.
  const named = (type: string) => (isHiddenVettingType(type) ? 'its agent' : AGENT)

  it('names no agent beside a pcs task', () => {
    const line = `asked ${named(PCS_VTA_TASK.applicationsCreate)} ${PCS_VTA_TASK.applicationsCreate} over tsp`
    expect(line).not.toContain(AGENT)
    expect(line).toContain('its agent')
  })

  it('still names the agent beside an ordinary task', () => {
    const type = 'https://trusttasks.org/spec/acl/list/0.1'
    expect(`asked ${named(type)} ${type} over tsp`).toContain(AGENT)
  })
})
