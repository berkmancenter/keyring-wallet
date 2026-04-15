/* eslint-disable no-undef */
// eslint-disable-next-line import/no-extraneous-dependencies
import 'reflect-metadata'
import 'react-native-gesture-handler/jestSetup'
import mockRNCNetInfo from '@react-native-community/netinfo/jest/netinfo-mock.js'
import mockRNLocalize from 'react-native-localize/mock'
import mockRNDeviceInfo from 'react-native-device-info/jest/react-native-device-info-mock'
import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock'

mockRNDeviceInfo.getVersion = jest.fn(() => '1')
mockRNDeviceInfo.getBuildNumber = jest.fn(() => '1')

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext)
jest.mock('react-native-device-info', () => mockRNDeviceInfo)
jest.mock('@react-native-community/netinfo', () => mockRNCNetInfo)
jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper')
jest.mock('react-native/Libraries/EventEmitter/NativeEventEmitter')
jest.mock('react-native-localize', () => mockRNLocalize)
jest.mock('react-native-fs', () => ({}))
jest.mock('@hyperledger/anoncreds-react-native', () => ({}))
jest.mock('@hyperledger/aries-askar-react-native', () => ({}))
jest.mock('@hyperledger/indy-vdr-react-native', () => ({}))
jest.mock('react-native-permissions', () => require('react-native-permissions/mock'))
jest.mock('react-native-vision-camera', () => {
  return require('./__mocks__/custom/react-native-camera')
})

// Mock @bifold/react-native-attestation native module
jest.mock('@bifold/react-native-attestation', () => ({
  isHardwareAttestationAvailable: jest.fn().mockResolvedValue(false),
  hasHardwareSigningKey: jest.fn().mockResolvedValue(false),
  createHardwareSigningKey: jest.fn().mockResolvedValue({
    publicKey: 'mock-public-key-base64',
    keyStorage: 'TEE',
  }),
  signWithHardwareKey: jest.fn().mockResolvedValue({
    signature: 'mock-signature-base64',
    publicKey: 'mock-public-key-base64',
    keyStorage: 'TEE',
    algorithm: 'ECDSA-SHA256',
    platform: 'android',
  }),
  getHardwareKeyAttestation: jest.fn().mockResolvedValue({
    success: true,
    certificateChain: [],
    format: 'android-key-attestation-v3',
  }),
  deleteHardwareSigningKey: jest.fn().mockResolvedValue(true),
}))

