/**
 * What an app built on this package needs from rooms: whether its own Developer screen may offer the rooms switch.
 * Keyring renders its own Developer screen, not this package's, so the answer has to come from the package's entry.
 */
import { roomsSwitchAvailable } from '../../../index'
import { roomsSwitchAvailable as fromModule } from '../useRoomsService'

test("the package entry gives an app the rooms switch's availability", () => {
  expect(roomsSwitchAvailable).toBe(fromModule)
  expect(typeof roomsSwitchAvailable()).toBe('boolean')
})
