/**
 * Unit coverage for `placeTaskDigestMultibase` — the same placement rule as
 * `placeTaskContext` (see its own test file), for the same spec reason:
 * dtgwg-cred-spec's Base Structure lists `taskDigestMultibase` as a
 * top-level member, sibling of `credentialSubject`, wherever `taskContext`
 * is REQUIRED.
 */

import { placeTaskDigestMultibase } from '../../src/trustTasks/WitnessTaskSessions'

describe('placeTaskDigestMultibase', () => {
  it('vsc shape: places taskDigestMultibase at the top level, sibling of credentialSubject', () => {
    const vwcJson: Record<string, unknown> = {}
    const subject: Record<string, unknown> = {}

    placeTaskDigestMultibase(vwcJson, subject, 'zQmDigest123', 'vsc')

    expect(vwcJson.taskDigestMultibase).toBe('zQmDigest123')
    expect(subject.taskDigestMultibase).toBeUndefined()
  })

  it('wd02 shape: keeps taskDigestMultibase nested inside credentialSubject, unchanged from before this migration', () => {
    const vwcJson: Record<string, unknown> = {}
    const subject: Record<string, unknown> = {}

    placeTaskDigestMultibase(vwcJson, subject, 'zQmDigest123', 'wd02')

    expect(subject.taskDigestMultibase).toBe('zQmDigest123')
    expect(vwcJson.taskDigestMultibase).toBeUndefined()
  })

  it('defaults to wd02 placement when credentialShape is undefined', () => {
    const vwcJson: Record<string, unknown> = {}
    const subject: Record<string, unknown> = {}

    placeTaskDigestMultibase(vwcJson, subject, 'zQmDigest123', undefined)

    expect(subject.taskDigestMultibase).toBe('zQmDigest123')
    expect(vwcJson.taskDigestMultibase).toBeUndefined()
  })
})
