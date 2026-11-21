/**
 * Where a pass lifts from when it opens in place: its place in the stack, less how far the Wallet had scrolled,
 * measured to where it lands under "All cards".
 */
import { PASS_STRIP } from '../components/CommunityPass'
import { OPEN_PASS_TOP, STACK_TOP, liftFrom } from '../components/passGeometry'

describe('the lift of a pass opened in place', () => {
  test('the pass at the back sits above where it lands, so it moves down to it', () => {
    expect(liftFrom(0, 0)).toBe(STACK_TOP - OPEN_PASS_TOP)
    expect(liftFrom(0, 0)).toBeLessThan(0)
  })

  test('each pass in front of it sits a strip lower, so it lifts a strip further', () => {
    expect(liftFrom(3, 0) - liftFrom(2, 0)).toBe(PASS_STRIP)
    expect(liftFrom(3, 0)).toBe(STACK_TOP + 3 * PASS_STRIP - OPEN_PASS_TOP)
  })

  test('scrolled down the Wallet, the pass is that much higher on screen', () => {
    expect(liftFrom(5, 120)).toBe(liftFrom(5, 0) - 120)
  })
})
