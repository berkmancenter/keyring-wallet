import { createPickWatcher } from '../../src/screens/importPickerWatch'

// IN-537: "Select Backup File" opened nothing and nothing said so. These pin when the
// Import screen is told the picker hasn't settled, and which call's outcome counts.

const SLOW = 6000

describe('createPickWatcher', () => {
  let onSlow: jest.Mock
  let noted: jest.Mock

  beforeEach(() => {
    jest.useFakeTimers()
    onSlow = jest.fn()
    noted = jest.fn()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  const slowStates = () => onSlow.mock.calls.map((c) => c[0])

  test('a call that never settles: slow after the wait, not before, and noted once', () => {
    const w = createPickWatcher(SLOW, onSlow, noted)
    w.start()
    expect(slowStates()).toEqual([false])

    jest.advanceTimersByTime(SLOW - 1)
    expect(slowStates()).toEqual([false])

    jest.advanceTimersByTime(1)
    expect(slowStates()).toEqual([false, true])
    expect(noted).toHaveBeenCalledTimes(1)
    expect(noted).toHaveBeenCalledWith(SLOW)

    jest.advanceTimersByTime(SLOW * 3)
    expect(noted).toHaveBeenCalledTimes(1)
  })

  test('a call that settles in time: never slow', () => {
    const w = createPickWatcher(SLOW, onSlow, noted)
    const call = w.start()
    jest.advanceTimersByTime(500)
    call.settle()
    jest.advanceTimersByTime(SLOW * 2)

    expect(slowStates()).not.toContain(true)
    expect(noted).not.toHaveBeenCalled()
  })

  test('a call that settles after the wait (picker left open, then closed): slow clears', () => {
    const w = createPickWatcher(SLOW, onSlow, noted)
    const call = w.start()
    jest.advanceTimersByTime(SLOW)
    expect(slowStates()).toEqual([false, true])

    call.settle()
    expect(slowStates()).toEqual([false, true, false])
  })

  test('a newer tap supersedes: the older call is not current, its settle does nothing, and the wait restarts', () => {
    const w = createPickWatcher(SLOW, onSlow, noted)
    const first = w.start()
    jest.advanceTimersByTime(SLOW)
    expect(slowStates()).toEqual([false, true])

    const second = w.start()
    expect(first.isCurrent()).toBe(false)
    expect(second.isCurrent()).toBe(true)
    expect(slowStates()).toEqual([false, true, false])

    // The older call's rejection arrives and settles: it must not clear the newer one's state.
    first.settle()
    expect(slowStates()).toEqual([false, true, false])

    jest.advanceTimersByTime(SLOW - 1)
    expect(slowStates()).toEqual([false, true, false])
    jest.advanceTimersByTime(1)
    expect(slowStates()).toEqual([false, true, false, true])
    expect(noted).toHaveBeenCalledTimes(2)
  })

  test("an older call's timer never fires for it once a newer call started before the wait", () => {
    const w = createPickWatcher(SLOW, onSlow, noted)
    w.start()
    jest.advanceTimersByTime(SLOW - 100)
    const second = w.start()
    jest.advanceTimersByTime(200)
    // 100 ms past the first call's wait: nothing, the second has its own full wait.
    expect(slowStates()).not.toContain(true)
    second.settle()
    jest.advanceTimersByTime(SLOW * 2)
    expect(slowStates()).not.toContain(true)
  })

  test('disposed (screen left): nothing fires and no call is current', () => {
    const w = createPickWatcher(SLOW, onSlow, noted)
    const call = w.start()
    w.dispose()
    jest.advanceTimersByTime(SLOW * 2)

    expect(slowStates()).toEqual([false])
    expect(noted).not.toHaveBeenCalled()
    expect(call.isCurrent()).toBe(false)
  })
})
