const setGenericPassword = jest.fn(async () => true)
const getGenericPassword = jest.fn(async () => null)
const resetGenericPassword = jest.fn(async () => undefined)
const getSupportedBiometryType = jest.fn(async () => undefined)

const keychainMock = {
  setGenericPassword,
  getGenericPassword,
  resetGenericPassword,
  getSupportedBiometryType,
  ACCESSIBLE: {
    ALWAYS: 'ALWAYS',
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  },
  ACCESS_CONTROL: {
    BIOMETRY_ANY: 'BIOMETRY_ANY',
  },
  SECURITY_LEVEL: {
    ANY: 'ANY',
  },
  STORAGE_TYPE: {
    AES: 'AES',
    RSA: 'RSA',
  },
}

export default keychainMock
export { getSupportedBiometryType, setGenericPassword, getGenericPassword, resetGenericPassword }



