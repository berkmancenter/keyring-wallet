/**
 * One clock for a suite that runs documents through the real Trust Task pipeline.
 *
 * jestSetup pins `Date.now()` to 2024-01-01 but not `new Date()`, which the ceremony code stamps
 * `issuedAt` with. Since @openvtc/trust-tasks 0.27 the consumer refuses a document dated later than
 * now plus its skew (`KEYRING_CONSUME_CHECKS` in TrustTasksService), so a suite that stamps with one
 * clock and consumes with the other fails for a reason no phone can reach. Calling this at the top of
 * such a suite makes `Date.now()` read the same clock as `new Date()` for that suite.
 */
export function readOneClock(): void {
  beforeAll(() => {
    jest.spyOn(Date, 'now').mockImplementation(() => new Date().getTime())
  })
}
