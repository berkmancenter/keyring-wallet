/**
 * The rooms service a screen uses, or none. With the `featureRooms` preference off there is none, and no
 * rooms screen, entry or call exists anywhere. With it on: the service the app registered on
 * `TOKENS.UTIL_ROOMS_SERVICE` (the real one, once an agent can serve rooms), else the sample service when
 * this build carries it, else none.
 *
 * This file is the one place that imports the sample. A store build swaps `sample/sampleRooms` for a stub
 * at bundle time (the wallet's metro config, switched by `ROOMS_SAMPLE`), where `createSampleRoomsService`
 * is undefined: `sampleRoomsBundled` is then false, and so is everything that depends on it.
 *
 * @module rooms/useRoomsService
 */
import { useMemo } from 'react'

import { TOKENS, useContainer } from '../../container-api'
import { useStore } from '../../contexts/store'

import { createSampleRoomsService } from './sample/sampleRooms'
import type { RoomsService } from './types'

/** Whether this build carries the sample rooms (false in a store build, where the module is a stub). */
export const sampleRoomsBundled: boolean = typeof createSampleRoomsService === 'function'

let sample: RoomsService | undefined

/** One sample service per app run, so what a person does with the samples holds while they look around. */
function sampleService(): RoomsService | undefined {
  if (!sampleRoomsBundled) return undefined
  sample ??= createSampleRoomsService()
  return sample
}

/** Forget the sample service's state (tests). */
export function resetSampleRoomsService(): void {
  sample = undefined
}

/** Whether Developer settings may offer the rooms switch: a development build, or one carrying the samples. */
export function roomsSwitchAvailable(): boolean {
  return __DEV__ || sampleRoomsBundled
}

export function useRoomsService(): RoomsService | undefined {
  const [store] = useStore()
  const container = useContainer()
  const enabled = !!store.preferences.featureRooms
  return useMemo(() => {
    if (!enabled) return undefined
    try {
      const registered = container.resolve(TOKENS.UTIL_ROOMS_SERVICE)
      if (registered) return registered
    } catch {
      // Not registered: no real rooms service in this app yet.
    }
    return sampleService()
  }, [enabled, container])
}
