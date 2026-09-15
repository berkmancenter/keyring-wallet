/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true }],
    // credo-ts 0.6 ships ESM-only (.mjs); transpile it to CJS for jest
    '^.+\\.m?js$': ['babel-jest', { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }],
  },
  moduleNameMapper: {
    // credo 0.7's mdoc code imports @verifiables/request-converter, whose exports map has
    // only `import`/`types` conditions; jest (CJS) cannot resolve it without a mapping.
    '^@verifiables/request-converter$': require('fs').existsSync(
      __dirname + '/node_modules/@verifiables/request-converter'
    )
      ? '<rootDir>/node_modules/@verifiables/request-converter/dist/index.js'
      : '<rootDir>/../../node_modules/@verifiables/request-converter/dist/index.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@credo-ts|@openwallet-foundation|@noble|@scure|@owf|@verifiables|ky|cbor-x|@stablelib|@digitalcredentials|base58-universal|base64url-universal|@openid4vc|dcql|valibot|uuid|query-string|decode-uri-component|split-on-first|filter-obj)/)',
  ],
  // NOTE: integration suites MUST run one jest process per test file (see
  // scripts/run-integration.mjs / `yarn test:integration`). askar-nodejs's
  // FFI struct registry is process-global while jest re-executes the module
  // per test file — the second file dies at import with "Duplicate type name
  // 'ByteBuffer'". Sandboxing prevents any in-process singleton workaround
  // (fresh globalThis AND process per file), so per-file processes are the
  // supported mode; the default `test` script therefore runs unit tests only.
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
