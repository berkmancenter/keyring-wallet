/**
 * Unit coverage for `placeTaskContext` (docs/plans/vsc-migration-plan.md
 * §6 V4, D4) — extracted from `WitnessTaskSessions.ts` specifically so this
 * one piece of new V4 logic has direct test coverage. `WitnessTaskSessions`
 * as a whole has no unit tests (it needs a live Credo agent to exercise
 * meaningfully); this is the coverage available at that boundary.
 */

import { placeTaskContext } from '../../src/trustTasks/WitnessTaskSessions'

describe('placeTaskContext', () => {
  it('vsc shape: places taskContext at the top level, sibling of credentialSubject', () => {
    const vwcJson: Record<string, unknown> = {}
    const subject: Record<string, unknown> = {}

    placeTaskContext(vwcJson, subject, 'session-123', 'vsc')

    expect(vwcJson.taskContext).toBe('session-123')
    expect(subject.taskContext).toBeUndefined()
  })

  it('wd02 shape: keeps taskContext nested inside credentialSubject, unchanged from before this migration', () => {
    const vwcJson: Record<string, unknown> = {}
    const subject: Record<string, unknown> = {}

    placeTaskContext(vwcJson, subject, 'session-123', 'wd02')

    expect(subject.taskContext).toBe('session-123')
    expect(vwcJson.taskContext).toBeUndefined()
  })

  it('defaults to wd02 placement when credentialShape is undefined', () => {
    const vwcJson: Record<string, unknown> = {}
    const subject: Record<string, unknown> = {}

    placeTaskContext(vwcJson, subject, 'session-123', undefined)

    expect(subject.taskContext).toBe('session-123')
    expect(vwcJson.taskContext).toBeUndefined()
  })
})
