// Manual mock for expo-sharing (no native runtime in Jest): sharing is available and the sheet closes at once.
// Tests that need it unavailable, or failing, override these.
export const isAvailableAsync = jest.fn().mockResolvedValue(true) // eslint-disable-line no-undef
export const shareAsync = jest.fn().mockResolvedValue(undefined) // eslint-disable-line no-undef
