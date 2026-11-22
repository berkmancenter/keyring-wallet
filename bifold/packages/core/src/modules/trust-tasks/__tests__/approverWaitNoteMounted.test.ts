/**
 * Every screen where an owner act can wait for an approver shows who it waits on (trusted-approver T3; the lab run,
 * 11-10: a rule change held for Jordan, and "Ask me before…" said nothing). The note guards itself with the
 * trusted-approvers switch; this checks it is mounted on each such screen, so a screen cannot drop it unseen.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const SCREENS = join(__dirname, '..', 'screens')
// Each owner act that goes through the agent's policy gate and can be held for consent, and the screen it waits on.
const WAITS_ON = {
  'VtiJoin.tsx': 'joining a community (the persona mint)',
  'MyAgent.tsx': 'My agent, where every held task shows',
  'VtaAskMe.tsx': 'changing an "Ask me before…" rule (policy/upsert)',
  'VtaTrustedApprovers.tsx': 'changing who approves (policy/upsert)',
  'VtaDevices.tsx': 'adding or removing a device (acl/grant, acl/revoke)',
  'VtaCreateAgent.tsx': 'adding a device while setting up (acl/grant)',
}

describe('the wait note', () => {
  it.each(Object.entries(WAITS_ON))('is on %s (%s)', (file) => {
    const text = readFileSync(join(SCREENS, file), 'utf8')
    expect(text).toMatch(/<ApproverWaitNote\s*\/>/)
    expect(text).toMatch(/import ApproverWaitNote from '\.\/ApproverWaitNote'/)
  })

  it('the list above is not empty and names files that exist (control for the scan)', () => {
    expect(Object.keys(WAITS_ON).length).toBeGreaterThanOrEqual(6)
    for (const file of Object.keys(WAITS_ON)) expect(() => readFileSync(join(SCREENS, file), 'utf8')).not.toThrow()
  })
})
