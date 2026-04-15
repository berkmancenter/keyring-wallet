process.env.TZ = 'UTC'

module.exports = {
  preset: 'react-native',
  testTimeout: 12012,
  setupFiles: ['<rootDir>/jestSetup.js'],
  setupFilesAfterEnv: ['@testing-library/jest-native/extend-expect', '<rootDir>/jestSetupAfterEnv.js'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    '\\.(jpg|ico|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$':
      '<rootDir>/__mocks__/file.js',
    '\\.(css|less)$': '<rootDir>/__mocks__/style.js',
    axios: require.resolve('axios'),
    'react-i18next': '<rootDir>/__mocks__/react-i18next.ts',
    '^uuid$': require.resolve('uuid'),
    '@credo-ts/core': require.resolve('@credo-ts/core'),
    '@credo-ts/anoncreds': require.resolve('@credo-ts/anoncreds'),
    '^../../../../witness-server/src/pseudonym-dictionaries$': '/home/brendan/code/asml/AdvancedIdentity/bifold/packages/witness-server/src/pseudonym-dictionaries.ts',
  },
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest',
  },
  transformIgnorePatterns: ['node_modules\\/(?!(.*react-native.*)|(uuid)|(@credo-ts\\/core)|(@credo-ts\\/anoncreds)|(@noble\\/curves))'],
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.[jt]sx?$',
  testPathIgnorePatterns: [
    '\\.snap$',
    '<rootDir>/node_modules/',
    '<rootDir>/lib',
    '<rootDir>/__tests__/contexts/',
    '<rootDir>/__tests__/helpers/',
    '<rootDir>/__tests__/screens/fixtures',
    '<rootDir>/__tests__/modules/vrc/fixtures',
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
