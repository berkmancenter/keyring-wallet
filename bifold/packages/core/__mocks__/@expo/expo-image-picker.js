// Manual mock for expo-image-picker (no native runtime in Jest). Tests that
// need a specific picker result override these with mockResolvedValueOnce.
export const requestMediaLibraryPermissionsAsync = jest.fn().mockResolvedValue({ granted: true }) // eslint-disable-line no-undef

// Already granted, which is every case but the first launch: the picker then
// opens without presenting a permission sheet, and without the wait that a
// sheet's dismissal needs (see `pickRCardPhoto`). A test that wants the
// first-launch path overrides this with `{ granted: false }`.
export const getMediaLibraryPermissionsAsync = jest.fn().mockResolvedValue({ granted: true }) // eslint-disable-line no-undef

export const launchImageLibraryAsync = jest.fn().mockResolvedValue({ canceled: true, assets: null }) // eslint-disable-line no-undef
