module.exports = {
  testEnvironment: 'node',
  transformIgnorePatterns: [
    'node_modules/(?!(.*react-native.*|@credo-ts|@noble|@scure|@owf|@verifiables|ky|cbor-x|@stablelib|@digitalcredentials|dcql|valibot|query-string|decode-uri-component|filter-obj|split-on-first|uuid|@bifold)/)',
  ],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    '^.+\\.(js|jsx|mjs)$': 'babel-jest',
  },
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node', 'mjs'],
  moduleNameMapper: {
    // credo 0.7's mdoc code imports @verifiables/request-converter, whose exports map has
    // only `import`/`types` conditions; jest (CJS) cannot resolve it without a mapping.
    '^@verifiables/request-converter$': require('fs').existsSync(
      __dirname + '/node_modules/@verifiables/request-converter'
    )
      ? '<rootDir>/node_modules/@verifiables/request-converter/dist/index.js'
      : '<rootDir>/../../node_modules/@verifiables/request-converter/dist/index.js',

    '^react-native$': 'react-native-web',
  },
  testPathIgnorePatterns: [
    '\\.snap$',
    '<rootDir>/node_modules/',
    '<rootDir>/lib',
    '<rootDir>/build',
    '<rootDir>/coverage',
  ],
  coveragePathIgnorePatterns: [
    '\\.snap$',
    '<rootDir>/node_modules/',
    '<rootDir>/lib',
    '<rootDir>/build',
    '<rootDir>/coverage',
  ],
}
