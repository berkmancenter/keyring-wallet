/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/__tests__'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/src/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'json', 'node'],
  moduleNameMapper: {
    // @openvtc/vti-tsp-js is ESM-only with an import-condition-only exports
    // map, which jest's require-based resolver cannot see through — same
    // reason @bifold/core's jest config maps it, and the same reason that
    // config already documents for @openvtc/trust-tasks. Only
    // @bifold/trust-tasks depends on it, so it's hoisted to the bifold
    // workspace root rather than into this package's own node_modules.
    '^@openvtc/vti-tsp-js$': '<rootDir>/../../node_modules/@openvtc/vti-tsp-js/dist/index.js',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  coverageDirectory: 'coverage',
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
    // credo-ts 0.6 ships ESM-only (.mjs); transpile it to CJS for jest
    '^.+\\.m?js$': ['babel-jest', { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }],
  },
  transformIgnorePatterns: [
    // Matches @bifold/witness-server's jest config, plus @bifold (this
    // package's own workspace dependency, @bifold/trust-tasks) — @credo-ts
    // 0.6's transitive deps (e.g. uuid) ship ESM-only too.
    'node_modules/(?!(@credo-ts|@openvtc|@openwallet-foundation|@noble|@stablelib|@digitalcredentials|base58-universal|base64url-universal|@openid4vc|dcql|valibot|uuid|query-string|decode-uri-component|split-on-first|filter-obj|@bifold)/)',
  ],
}
