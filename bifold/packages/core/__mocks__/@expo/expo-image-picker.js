// Manual mock for expo-image-picker (no native runtime in Jest). Tests that
// need a specific picker result override these with mockResolvedValueOnce.
export const requestMediaLibraryPermissionsAsync = jest.fn().mockResolvedValue({ granted: true }) // eslint-disable-line no-undef

export const launchImageLibraryAsync = jest.fn().mockResolvedValue({ canceled: true, assets: null }) // eslint-disable-line no-undef
