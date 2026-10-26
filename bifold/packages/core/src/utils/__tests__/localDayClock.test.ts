/**
 * The 12- or 24-hour clock is the phone's own setting, read from the platform, never from the app's language: a
 * French screen on a 12-hour phone still says "4:01 PM".
 */
import { renderHook } from '@testing-library/react-native'

import { useUses24HourClock } from '../localDay'

const mockUses24HourClock = jest.fn()
jest.mock('react-native-localize', () => ({ uses24HourClock: () => mockUses24HourClock() }))

describe('the phone’s clock', () => {
  test.each([true, false])('the platform says %s, the hook says the same', (setting) => {
    mockUses24HourClock.mockReturnValue(setting)
    expect(renderHook(() => useUses24HourClock()).result.current).toBe(setting)
  })
})
