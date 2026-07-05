/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true }],
  },
  roots: ['<rootDir>/src', '<rootDir>/__tests__'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/**/*Inquirer.ts', // Exclude interactive CLI files
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testTimeout: 60000, // 60 seconds for integration tests
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.ts'],
  // Run tests serially to avoid race conditions with DIDComm agents
  // Integration tests involve real network connections and async message passing
  // that don't work reliably in parallel
  maxWorkers: 1,
  // Force exit after tests complete to handle lingering async operations
  forceExit: true,
  // Detect open handles that prevent Jest from exiting cleanly
  detectOpenHandles: true,
}
