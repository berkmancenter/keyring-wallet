// Global test setup
import '@jest/globals'
import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env file in vrc_reference root
config({ path: resolve(__dirname, '..', '.env') })

// Set test log level to info to track progress
process.env.CREDO_LOG_LEVEL = process.env.CREDO_LOG_LEVEL || 'info'

// Timeout for integration tests
jest.setTimeout(60000)

// Suppress console.log and console.info during tests for cleaner output
// Keep console.error and console.warn for debugging test failures
// TEMPORARILY DISABLED for debugging witnessedFlow test
// global.console.log = jest.fn()
// global.console.info = jest.fn()

// Handle unhandled promise rejections to prevent Node.js crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
  // Don't throw, just log - this prevents Node.js assertion crashes
})

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
  // Don't throw, just log - this prevents Node.js assertion crashes
})

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks()
})
