// expo-sharing ships ESM that jest does not transform; the app only needs its
// two calls, which tests assert on through these.
export const isAvailableAsync = jest.fn(async () => true)
export const shareAsync = jest.fn(async () => undefined)
