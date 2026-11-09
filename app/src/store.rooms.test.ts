/**
 * Rooms are on for everyone from 276: on in a new install, on in an install that never chose (its saved preferences
 * are loaded over these, as container-imp does), and off only where the person turned them off in Developer settings.
 */
import { DispatchAction } from '@bifold/core'

import { initialState, reducer } from './store'

describe('rooms on by default', () => {
  it('a new install has rooms on', () => {
    expect(initialState.preferences.featureRooms).toBe(true)
  })

  it('an install that never chose gets rooms on; one that turned them off keeps them off', () => {
    // What an earlier install saved: its preferences as JSON, where a choice never made is simply absent.
    const savedBefore = JSON.parse(JSON.stringify({ ...initialState.preferences, featureRooms: undefined }))
    expect('featureRooms' in savedBefore).toBe(false)
    // Loaded as container-imp loads them: saved over initial.
    expect({ ...initialState.preferences, ...savedBefore }.featureRooms).toBe(true)
    expect({ ...initialState.preferences, ...savedBefore, featureRooms: false }.featureRooms).toBe(false)
  })

  it('the Developer switch turns them off and on again', () => {
    const off = reducer(initialState, { type: DispatchAction.FEATURE_ROOMS, payload: [false] })
    expect(off.preferences.featureRooms).toBe(false)
    const on = reducer(off, { type: DispatchAction.FEATURE_ROOMS, payload: [true] })
    expect(on.preferences.featureRooms).toBe(true)
  })
})
