/* eslint-disable no-undef */
import 'reflect-metadata'
import 'react-native-gesture-handler/jestSetup'
import mockRNLocalize from 'react-native-localize/mock'
import mockRNDeviceInfo from 'react-native-device-info/jest/react-native-device-info-mock'
import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock'
import mockRNCNetInfo from '@react-native-community/netinfo/jest/netinfo-mock.js'
import React from 'react'
global.React = React

mockRNDeviceInfo.getVersion = jest.fn(() => '1')
mockRNDeviceInfo.getBuildNumber = jest.fn(() => '1')

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext)
jest.mock('@react-native-community/netinfo', () => mockRNCNetInfo)
jest.mock('react-native-device-info', () => mockRNDeviceInfo)
// moved in RN 0.76: Libraries/Animated/NativeAnimatedHelper → src/private/animated/
jest.mock('react-native/src/private/animated/NativeAnimatedHelper')
jest.mock('react-native/Libraries/EventEmitter/NativeEventEmitter')
jest.mock('react-native-localize', () => mockRNLocalize)
jest.mock('react-native-vision-camera', () => {
  return require('./__mocks__/custom/react-native-camera')
})
jest.mock('react-native-permissions', () => require('react-native-permissions/mock'))
jest.mock('react-native-splash-screen', () => ({}))
jest.mock('@bifold/react-native-attestation', () => ({}))
jest.mock('@hyperledger/anoncreds-react-native', () => ({}))
jest.mock('@openwallet-foundation/askar-react-native', () => ({}))
jest.mock('@hyperledger/indy-vdr-react-native', () => ({}))

// React 18+/19: enable proper act() behavior in tests
globalThis.IS_REACT_ACT_ENVIRONMENT = true

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'))

// Mirror bifold's jestSetup: keep RefreshOrchestrator from spinning timers/logs
jest.mock('../bifold/packages/core/src/modules/openid/refresh/refreshOrchestrator', () => ({
  RefreshOrchestrator: jest.fn().mockImplementation(() => ({
    configure: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    runOnce: jest.fn(),
  })),
}))

jest.mock('react-native-keyboard-controller', () => {
  const { ScrollView, View } = jest.requireActual('react-native')
  return {
    KeyboardProvider: ({ children }) => children,
    KeyboardAwareScrollView: ScrollView,
    KeyboardAvoidingView: View,
  }
})

// Mock Keyboard to fix KeyboardAvoidingView cleanup issues in tests
// React Native 0.81+ exports Keyboard as .default
const mockKeyboard = {
  addListener: jest.fn(() => ({ remove: jest.fn() })),
  removeListener: jest.fn(),
  dismiss: jest.fn(),
  scheduleLayoutAnimation: jest.fn(),
  isVisible: jest.fn(() => false),
  metrics: jest.fn(() => null),
}
jest.mock('react-native/Libraries/Components/Keyboard/Keyboard', () => ({
  default: mockKeyboard,
  ...mockKeyboard,
}))

// Mock BackHandler to return subscription with remove() method
// This covers the new subscription-based API used in React Native 0.81+
const mockBackHandler = {
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  removeEventListener: jest.fn(),
  exitApp: jest.fn(),
}
jest.mock('react-native/Libraries/Utilities/BackHandler', () => ({
  default: mockBackHandler,
  ...mockBackHandler,
}))
