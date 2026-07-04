// =============================================================================
// React Native Entry Point
// Polyfills are loaded before the app to ensure compatibility
// =============================================================================

/* eslint-disable @typescript-eslint/no-var-requires */

// =============================================================================
// CRITICAL: Set up globalThis and crypto BEFORE any modules load
// =============================================================================

// Ensure globalThis exists (ES2020 standard, should exist in Hermes)
if (typeof globalThis === 'undefined') {
  global.globalThis = global
}

// Ensure window exists for browser-like code
if (typeof global.window === 'undefined') {
  global.window = global
}

// Ensure self exists for web workers / browser code
if (typeof global.self === 'undefined') {
  global.self = global
}

// =============================================================================
// Step 1: Set up crypto.getRandomValues using react-native-get-random-values
// This MUST come before any other crypto setup
// =============================================================================
require('react-native-get-random-values')

// =============================================================================
// Step 2: Set up crypto.subtle.digest using js-sha256 (pure JS, synchronous)
// This provides SHA-256 hashing for JSON-LD signatures
// =============================================================================
const jsSha256 = require('js-sha256')

// Create a synchronous SHA-256 digest implementation
const sha256Digest = async (algorithm, data) => {
  const algoName = typeof algorithm === 'string' ? algorithm : algorithm.name
  const normalizedAlgo = algoName.toLowerCase().replace(/-/g, '')

  if (normalizedAlgo !== 'sha256') {
    throw new Error(`Unsupported algorithm: ${algoName}. Only SHA-256 is supported in React Native.`)
  }

  // Convert data to Uint8Array if needed
  let bytes
  if (typeof data === 'string') {
    bytes = new TextEncoder().encode(data)
  } else if (data instanceof Uint8Array) {
    bytes = data
  } else if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data)
  } else {
    bytes = new Uint8Array(data)
  }

  // Use js-sha256 to compute the hash
  const hexHash = jsSha256.sha256(bytes)

  // Convert hex string to ArrayBuffer
  const buffer = new ArrayBuffer(32)
  const view = new Uint8Array(buffer)
  for (let i = 0; i < 32; i++) {
    view[i] = parseInt(hexHash.substr(i * 2, 2), 16)
  }

  return buffer
}

// Ensure crypto object exists (react-native-get-random-values may have created it)
if (!global.crypto) {
  global.crypto = {}
}

// Add subtle API with our SHA-256 implementation
if (!global.crypto.subtle) {
  global.crypto.subtle = {}
}
global.crypto.subtle.digest = sha256Digest

// Mirror to all global locations that libraries might check
globalThis.crypto = global.crypto
if (typeof global.self !== 'undefined') {
  global.self.crypto = global.crypto
}
if (typeof global.window !== 'undefined') {
  global.window.crypto = global.crypto
}

// Crypto polyfill ready (SHA-256 via js-sha256, getRandomValues via react-native-get-random-values)

// =============================================================================
// Continue with remaining polyfills
// =============================================================================
require('fast-text-encoding') // TextEncoder/TextDecoder
require('react-native-gesture-handler')
require('@formatjs/intl-getcanonicallocales/polyfill')
require('@formatjs/intl-locale/polyfill')
require('@formatjs/intl-pluralrules/polyfill')
require('@formatjs/intl-pluralrules/locale-data/en')
require('@formatjs/intl-displaynames/polyfill')
require('@formatjs/intl-displaynames/locale-data/en')
require('@formatjs/intl-listformat/polyfill')
require('@formatjs/intl-listformat/locale-data/en')
require('@formatjs/intl-numberformat/polyfill')
require('@formatjs/intl-numberformat/locale-data/en')
require('@formatjs/intl-relativetimeformat/polyfill')
require('@formatjs/intl-relativetimeformat/locale-data/en')
require('@formatjs/intl-datetimeformat/polyfill')
require('@formatjs/intl-datetimeformat/locale-data/en')
require('@formatjs/intl-datetimeformat/add-all-tz')
require('reflect-metadata')

// Buffer polyfill
const { Buffer } = require('buffer')
if (!global.Buffer) {
  global.Buffer = Buffer
}

// btoa/atob polyfill
const { decode, encode } = require('base-64')
if (!global.btoa) {
  global.btoa = encode
}
if (!global.atob) {
  global.atob = decode
}

// Dev-only: silence the LogBox toast for known-noisy warnings (indy ledger DID
// cache warm-up times out on test networks; the toast overlays the UI and breaks
// E2E taps). Errors still land in the metro console.
const { AppRegistry, LogBox } = require('react-native')
if (global.__DEV__) {
  LogBox.ignoreLogs([/IndyVdrError/, /Possible unhandled promise rejection/])
}
const App = require('./App').default
const { name: appName } = require('./app.json')

AppRegistry.registerComponent(appName, () => App)
