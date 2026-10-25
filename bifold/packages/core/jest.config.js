process.env.TZ = 'UTC'

module.exports = {
  preset: 'react-native',
  testTimeout: 12000,
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  setupFiles: [],
  setupFilesAfterEnv: [
    '<rootDir>/jestSetup.js',
    '@testing-library/jest-native/extend-expect',
    '<rootDir>/jestSetupAfterEnv.js',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node', 'mjs'],
  moduleNameMapper: {
    // class-transformer keeps its @Expose metadata in a MODULE-LOCAL store (0.5.1), and
    // this tree carries nested copies under the @credo-ts packages. @bifold/trust-tasks'
    // v2 envelope registers Expose renames that Credo's JsonTransformer must see, so every
    // import of class-transformer has to land on one copy (Metro does the same via its
    // singleton list; see didcomm_v2_subtask.md C10).
    '^class-transformer$': '<rootDir>/../../node_modules/class-transformer',
    // askar-shared defines AskarError, and @credo-ts/askar decides whether a store must be provisioned with
    // `instanceof AskarError`. This tree nests a copy of @credo-ts/askar under core while askar-nodejs (the Node binding
    // a real-agent test loads) uses the root copy of askar-shared, so the check failed across copies and a new store
    // was opened instead of provisioned ("database path was not found"). One copy, as for class-transformer above.
    // The app's bundle has pinned the same package for the same reason since 2026-08-26 (singletonPrefixes in the
    // wallet's app/metro.config.js); a native-backed dependency added to one list belongs in the other too.
    '^@openwallet-foundation/askar-shared$': '<rootDir>/../../node_modules/@openwallet-foundation/askar-shared',
    // @openvtc/vti-tsp-js ships its test-vector helpers behind an exports-map
    // subpath with only `import`/`types` conditions, which jest (CJS) will not
    // resolve. They are how the relationship-forming invite is checked against
    // upstream's own bytes, so the path is mapped rather than the check dropped.
    '^@openvtc/vti-tsp-js/unsafe-testing$': '<rootDir>/../../node_modules/@openvtc/vti-tsp-js/dist/unsafe-testing.js',
    // credo 0.7's mdoc code imports @verifiables/request-converter, whose exports map has
    // only `import`/`types` conditions; jest (CJS) cannot resolve it without a mapping.
    '^@verifiables/request-converter$': require('fs').existsSync(
      __dirname + '/node_modules/@verifiables/request-converter'
    )
      ? '<rootDir>/node_modules/@verifiables/request-converter/dist/index.js'
      : '<rootDir>/../../node_modules/@verifiables/request-converter/dist/index.js',

    // @openvtc/trust-tasks is ESM-only with an import-condition exports map,
    // which jest's require-based resolver cannot see through — map straight
    // to the dist files (babel transforms them; the package is allowlisted
    // in transformIgnorePatterns).
    '^@openvtc/trust-tasks$': '<rootDir>/node_modules/@openvtc/trust-tasks/dist/index.js',
    '^@openvtc/trust-tasks/(.*)$': '<rootDir>/node_modules/@openvtc/trust-tasks/dist/$1.js',
    // Same reason as @openvtc/trust-tasks above: ESM-only, import-condition-only exports map.
    // Only @bifold/trust-tasks depends on it, so yarn hoists it to the bifold
    // workspace root rather than into this package's own node_modules.
    '^@openvtc/vti-tsp-js$': '<rootDir>/../../node_modules/@openvtc/vti-tsp-js/dist/index.js',
    // tsp-js 0.4.0 (TSP 1.0) under a test-only alias: the 1.0 codec is
    // cross-checked against upstream's 1.0 packer and unpacker. A devDependency
    // of this package only; nothing the app bundles imports it.
    '^@openvtc/vti-tsp-js-v1$': '<rootDir>/node_modules/@openvtc/vti-tsp-js-v1/dist/index.js',
    '^@openvtc/vti-tsp-js-v1/unsafe-testing$': '<rootDir>/node_modules/@openvtc/vti-tsp-js-v1/dist/unsafe-testing.js',
    '\\.(jpg|ico|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$':
      '<rootDir>/__mocks__/file.js',
    '\\.(css|less)$': '<rootDir>/__mocks__/style.js',
    axios: require.resolve('axios'),
    'react-i18next': '<rootDir>/__mocks__/react-i18next.ts',
    '^uuid$': require.resolve('uuid'),
    '^@bifold/oca$': '<rootDir>/../oca/src/index.ts',
    '^@bifold/trust-tasks$': '<rootDir>/../trust-tasks/src/index.ts',
    '^@bifold/verifier$': '<rootDir>/../verifier/src/index.ts',
    'expo-crypto': '<rootDir>/__mocks__/@expo/expo-crypto.js',
    'expo-image-picker': '<rootDir>/__mocks__/@expo/expo-image-picker.js',
    'expo-image-manipulator': '<rootDir>/__mocks__/@expo/expo-image-manipulator.js',
    '@expo/app-integrity': '<rootDir>/__mocks__/@expo/app-integrity.js',
  },
  transform: {
    '^.+\\.(js|jsx|ts|tsx|mjs)$': 'babel-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(.*react-native.*|@credo-ts|@openvtc|@openid4vc|@noble|@scure|@owf|@verifiables|ky|cbor-x|@stablelib|@digitalcredentials|base58-universal|base64url-universal|dcql|valibot|query-string|decode-uri-component|filter-obj|split-on-first|uuid|@bifold|expo(nent)?|@expo(nent)?/.*)/)',
  ],
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.[jt]sx?$',
  testPathIgnorePatterns: [
    '\\.snap$',
    // `__tests__/fixtures/` holds vendored schemas and the helper that compares
    // them with upstream — data and support, never tests. testRegex treats
    // every .ts under __tests__ as a suite, so without this a helper file fails
    // the run with "your test suite must contain at least one test".
    '/__tests__/fixtures/',
    '<rootDir>/node_modules/',
    '<rootDir>/lib',
    '<rootDir>/__tests__/contexts/',
    '<rootDir>/__tests__/helpers/',
    '<rootDir>/__tests__/screens/fixtures',
    '<rootDir>/__tests__/modules/vrc/fixtures',
    '<rootDir>/__tests__/hardware-signing/fixtures',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/__tests__/',
    '<rootDir>/src/navigators/defaultStackOptions.tsx',
    '<rootDir>/src/defaultConfiguration.ts',
    '<rootDir>/src/components/buttons/InfoIcon.tsx',
    '<rootDir>/src/hooks/deep-links.ts',
  ],
  cacheDirectory: '.jest/cache',
  snapshotFormat: {
    escapeString: true,
    printBasicPrototype: true,
  },
}
