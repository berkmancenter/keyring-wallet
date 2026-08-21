module.exports = {
  preset: 'react-native',
  testTimeout: 10000,
  setupFiles: ['<rootDir>/jestSetup.js'],
  setupFilesAfterEnv: ['@testing-library/jest-native/extend-expect'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  // Force Jest to resolve modules from app's node_modules first, not from bifold's
  // This is necessary when using portal: with a submodule that has its own node_modules
  modulePaths: ['<rootDir>/node_modules'],
  moduleNameMapper: {
    '\\.(jpg|ico|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$':
      '<rootDir>/__mocks__/file.js',
    '\\.(css|less)$': '<rootDir>/__mocks__/style.js',
    axios: require.resolve('axios'),
    'react-i18next': '<rootDir>/__mocks__/react-i18next.ts',
    '^uuid$': require.resolve('uuid'),
    '@credo-ts/core': require.resolve('@credo-ts/core'),
    '@credo-ts/anoncreds': require.resolve('@credo-ts/anoncreds'),
    '@credo-ts/didcomm': require.resolve('@credo-ts/didcomm'),
    // Use bifold sources directly (like bifold's own jest configs) to avoid
    // circular-require issues in the lib/commonjs build under jest
    '^@bifold/core$': '<rootDir>/../bifold/packages/core/src/index.ts',
    '^@bifold/verifier$': '<rootDir>/../bifold/packages/verifier/src/index.ts',
    '^@bifold/oca/build/legacy$': '<rootDir>/../bifold/packages/oca/src/legacy/index.ts',
    '^@bifold/oca$': '<rootDir>/../bifold/packages/oca/src/index.ts',
    '^@bifold/react-hooks$': '<rootDir>/../bifold/packages/react-hooks/src/index.ts',
    '@bifold/remote-logs': '<rootDir>/__mocks__/@bifold/remote-logs.ts',
    '@openwallet-foundation/askar-react-native': require.resolve('@openwallet-foundation/askar-react-native'),
    // CRITICAL: Force Jest to use app's React instead of bifold's
    // Multiple copies of React cause "Invalid hook call" errors
    '^react$': require.resolve('react'),
    '^react/jsx-runtime$': require.resolve('react/jsx-runtime'),
    // Force Jest to use app's React Native packages instead of bifold's
    // When portal: follows symlink to bifold, it can resolve packages from bifold's node_modules
    // This ensures tests use app's versions with proper mocks from jestSetup.js
    '^react-native$': require.resolve('react-native'),
    // Also map react-native subpath imports (e.g. react-native/Libraries/...)
    // so bifold sources can't drag in bifold/node_modules' second RN copy
    '^react-native/(.*)$': `${require('path').dirname(require.resolve('react-native/package.json'))}/$1`,
    '^react-native-reanimated$': require.resolve('react-native-reanimated'),
    '^react-native-keyboard-controller$': require.resolve('react-native-keyboard-controller'),
    '^react-native-splash-screen$': require.resolve('react-native-splash-screen'),
    '^react-native-toast-message$': require.resolve('react-native-toast-message'),
    '^react-native-device-info$': require.resolve('react-native-device-info'),
    '^react-native-orientation-locker$': require.resolve('react-native-orientation-locker'),
    '^react-native-localize$': require.resolve('react-native-localize'),
    '^react-native-safe-area-context$': require.resolve('react-native-safe-area-context'),
    '^react-native-permissions$': require.resolve('react-native-permissions'),
    '^react-native-config$': require.resolve('react-native-config'),
    '^react-native-svg$': require.resolve('react-native-svg'),
    '^react-native-gesture-handler$': require.resolve('react-native-gesture-handler'),
    '^react-native-keychain$': require.resolve('react-native-keychain'),
    '^react-native-fs$': require.resolve('react-native-fs'),
    '^react-native-vision-camera$': require.resolve('react-native-vision-camera'),
    // Additional packages used in bifold - add proactively to prevent future failures
    '^react-native-gifted-chat$': require.resolve('react-native-gifted-chat'),
    '^react-native-qrcode-svg$': require.resolve('react-native-qrcode-svg'),
    '^react-native-uuid$': require.resolve('react-native-uuid'),
    '^react-native-logs$': require.resolve('react-native-logs'),
    '^react-native-bouncy-checkbox$': require.resolve('react-native-bouncy-checkbox'),
    '^react-native-collapsible$': require.resolve('react-native-collapsible'),
    '^react-native-confirmation-code-field$': require.resolve('react-native-confirmation-code-field'),
    '^react-native-animated-pagination-dots$': require.resolve('react-native-animated-pagination-dots'),
    '^react-native-argon2$': require.resolve('react-native-argon2'),
    '^react-native-screenguard$': require.resolve('react-native-screenguard'),
    '^react-native-tcp-socket$': require.resolve('react-native-tcp-socket'),
    '^react-native-vector-icons$': require.resolve('react-native-vector-icons'),
    // Expo modules used by bifold core - reuse bifold's jest mocks
    'expo-crypto': '<rootDir>/../bifold/packages/core/__mocks__/@expo/expo-crypto.js',
    '@expo/app-integrity': '<rootDir>/../bifold/packages/core/__mocks__/@expo/app-integrity.js',
    // @openvtc/trust-tasks is ESM-only with an import-condition exports map,
    // which Jest's CJS resolver can't follow — same fix as bifold/core's own
    // jest.config.js, pointed at the root-hoisted copy (this package isn't
    // nested under app/node_modules; modulePaths above only searches app's
    // own node_modules, so the mapping has to name the root path explicitly).
    '^@openvtc/trust-tasks$': '<rootDir>/../node_modules/@openvtc/trust-tasks/dist/index.js',
    '^@openvtc/trust-tasks/(.*)$': '<rootDir>/../node_modules/@openvtc/trust-tasks/dist/$1.js',
  },
  transform: {
    '^.+\\.(js|jsx|ts|tsx|mjs)$': 'babel-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(.*react-native.*|@credo-ts|@openwallet-foundation|@openid4vc|@noble|@stablelib|@digitalcredentials|base58-universal|base64url-universal|dcql|valibot|query-string|decode-uri-component|filter-obj|split-on-first|uuid|@bifold|@openvtc|expo(nent)?|@expo(nent)?/.*)/)',
  ],
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.[jt]sx?$',
  testPathIgnorePatterns: ['\\.snap$', '<rootDir>/node_modules/', '<rootDir>/lib', '<rootDir>/__tests__/contexts/'],
  cacheDirectory: '.jest/cache',
  // Force Jest to exit even if there are open handles (prevents "Jest environment torn down" errors)
  // This is needed because React Native's timer mocking can leave timers running after tests complete
  forceExit: true,
}
