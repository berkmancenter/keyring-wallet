/**
 * The live-pickup switch: off unless the build turns it on (LIVE_MESSAGE_PICKUP
 * in app/.env), and a Developer toggle that is saved, so it outlives a restart.
 */
const loadStore = (env: Record<string, string>) => {
  let store: (typeof import('./store') & { PersistentStorage: any }) | undefined
  jest.isolateModules(() => {
    jest.doMock('react-native-config', () => ({ __esModule: true, default: env }))
    // The same module instance the store saves through.
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- isolateModules needs require to load fresh copies
    store = { ...require('./store'), PersistentStorage: require('@bifold/core').PersistentStorage }
  })
  return store as typeof import('./store') & { PersistentStorage: any }
}

describe('live pickup switch', () => {
  afterEach(() => jest.dontMock('react-native-config'))

  it('is off by default', () => {
    expect(loadStore({}).initialState.developer.enableLivePickup).toBe(false)
  }, 30_000)

  it('the build can turn it on with no code change', () => {
    expect(loadStore({ LIVE_MESSAGE_PICKUP: 'true' }).initialState.developer.enableLivePickup).toBe(true)
    expect(loadStore({ LIVE_MESSAGE_PICKUP: 'false' }).initialState.developer.enableLivePickup).toBe(false)
  }, 30_000)

  it('the Developer toggle sets it and saves it', () => {
    const { reducer, initialState, BCDispatchAction, BCLocalStorageKeys, PersistentStorage } = loadStore({})
    const save = jest.spyOn(PersistentStorage, 'storeValueForKey').mockImplementation(async () => undefined)

    const on = reducer(initialState, { type: BCDispatchAction.TOGGLE_LIVE_PICKUP, payload: [true] })
    expect(on.developer.enableLivePickup).toBe(true)
    expect(save).toHaveBeenCalledWith(BCLocalStorageKeys.EnableLivePickup, true)

    const off = reducer(on, { type: BCDispatchAction.TOGGLE_LIVE_PICKUP, payload: [false] })
    expect(off.developer.enableLivePickup).toBe(false)
    save.mockRestore()
  }, 30_000)
})
