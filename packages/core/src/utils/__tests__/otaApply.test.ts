import {
  hasOtaApplyBlockers,
  notifyReturnLocked,
  onReturnLocked,
  otaApplyBlockerReasons,
  registerOtaApplyBlocker,
  resetOtaReturnLockedListenersForTests,
} from '../otaApply'

describe('otaApply', () => {
  test('a blocker holds until released, and releasing twice is safe', () => {
    expect(hasOtaApplyBlockers()).toBe(false)
    const release = registerOtaApplyBlocker('sign-in')
    expect(hasOtaApplyBlockers()).toBe(true)
    expect(otaApplyBlockerReasons()).toEqual(['sign-in'])
    release()
    release()
    expect(hasOtaApplyBlockers()).toBe(false)
  })

  test('two blockers with the same reason are counted apart', () => {
    const first = registerOtaApplyBlocker('chat-draft')
    const second = registerOtaApplyBlocker('chat-draft')
    first()
    expect(hasOtaApplyBlockers()).toBe(true)
    second()
    expect(hasOtaApplyBlockers()).toBe(false)
  })

  test('a return-locked listener hears the time away until it unsubscribes', () => {
    const heard: number[] = []
    const off = onReturnLocked((awayMs) => heard.push(awayMs))
    notifyReturnLocked(31 * 60_000)
    off()
    notifyReturnLocked(5_000)
    expect(heard).toEqual([31 * 60_000])
  })

  test('an async listener that rejects is caught, not left unhandled', async () => {
    const off = onReturnLocked(async () => {
      throw new Error('async listener bug')
    })
    const unhandled = jest.fn()
    process.on('unhandledRejection', unhandled)
    notifyReturnLocked(1_000)
    await new Promise((resolve) => setTimeout(resolve, 0))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
    off()
  })

  test('resetting forgets every return-locked listener', () => {
    const heard: number[] = []
    onReturnLocked((awayMs) => heard.push(awayMs))
    resetOtaReturnLockedListenersForTests()
    notifyReturnLocked(1_000)
    expect(heard).toEqual([])
  })

  test('a failing listener neither throws nor stops the others', () => {
    const heard: number[] = []
    const offBad = onReturnLocked(() => {
      throw new Error('listener bug')
    })
    const offGood = onReturnLocked((awayMs) => heard.push(awayMs))
    expect(() => notifyReturnLocked(1_000)).not.toThrow()
    expect(heard).toEqual([1_000])
    offBad()
    offGood()
  })
})
