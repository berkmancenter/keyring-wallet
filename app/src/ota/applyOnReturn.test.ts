import { decideApplyOnReturn, OTA_APPLY_AFTER_BACKGROUND_MS } from './applyOnReturn'

const base = {
  awayMs: OTA_APPLY_AFTER_BACKGROUND_MS,
  stagedBundleId: '01a170d8-63a6-7376-9481-3128680b68f9',
  runningBundleId: '01a16998-e09d-7e22-8440-98fab0992afd',
  blockers: [] as string[],
  platform: 'android',
}

describe('decideApplyOnReturn', () => {
  it('applies after 30 min away with an update staged and nothing blocking', () => {
    expect(decideApplyOnReturn(base)).toEqual({ apply: true })
  })

  it('does not apply under 30 min away (a quick switch)', () => {
    expect(decideApplyOnReturn({ ...base, awayMs: OTA_APPLY_AFTER_BACKGROUND_MS - 1 })).toMatchObject({
      apply: false,
      reason: 'away for less than 30 min',
    })
    expect(decideApplyOnReturn({ ...base, awayMs: NaN }).apply).toBe(false)
  })

  it('does not apply with nothing staged, or with the staged update already running', () => {
    expect(decideApplyOnReturn({ ...base, stagedBundleId: undefined })).toMatchObject({ reason: 'no update staged' })
    expect(decideApplyOnReturn({ ...base, runningBundleId: base.stagedBundleId })).toMatchObject({
      reason: 'the staged update is already running',
    })
  })

  it('does not apply while anything blocks it, and names each blocker', () => {
    for (const blocker of ['sign-in', 'chat-draft', 'vta-task:vta/join/0.1']) {
      expect(decideApplyOnReturn({ ...base, blockers: [blocker] })).toEqual({
        apply: false,
        reason: `blocked: ${blocker}`,
      })
    }
    expect(decideApplyOnReturn({ ...base, blockers: ['sign-in', 'chat-draft'] })).toMatchObject({
      reason: 'blocked: sign-in, chat-draft',
    })
  })

  it('does not apply on iOS until a healthy in-process reload is proven', () => {
    expect(decideApplyOnReturn({ ...base, platform: 'ios' })).toMatchObject({
      reason: 'iOS applies on the next cold start',
    })
    expect(decideApplyOnReturn({ ...base, platform: 'ios', iosAllowed: true })).toEqual({ apply: true })
  })

  it('does not apply on any other platform', () => {
    expect(decideApplyOnReturn({ ...base, platform: 'web' }).apply).toBe(false)
  })
})
