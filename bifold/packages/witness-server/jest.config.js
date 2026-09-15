/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/__tests__'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/src/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'json', 'node'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  coverageDirectory: 'coverage',
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
    // credo-ts 0.6 ships ESM-only (.mjs); transpile it to CJS for jest.
    // @openvtc/vti-tsp-js is ESM-only too, but as plain `.js` under a
    // `"type": "module"` package — hence `m?js`, and hence its presence in
    // the allowlist below. Without it `@bifold/trust-tasks` cannot be
    // imported from a test at all, which silently took locality.test.ts
    // out of service entirely (found 2026-09-12 while adding the iOS path).
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
    'node_modules/(?!(@credo-ts|@openvtc|@openwallet-foundation|@noble|@scure|@owf|@verifiables|ky|cbor-x|@stablelib|@digitalcredentials|base58-universal|base64url-universal|@openid4vc|dcql|valibot|uuid|query-string|decode-uri-component|split-on-first|filter-obj)/)',
  ],
}
