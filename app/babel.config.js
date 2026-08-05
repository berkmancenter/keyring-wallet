const presets = ['module:@react-native/babel-preset']
const plugins = [
  '@babel/plugin-transform-export-namespace-from',
  [
    'module-resolver',
    {
      // NOTE: no `root` here on purpose - with root: ['.'] module-resolver
      // rewrites `from '.'` imports inside node_modules (e.g. gesture-handler's
      // ReanimatedSwipeable) to the app root index.js, breaking jest
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
      alias: {
        '@': './src',
        '@assets': './src/assets',
        '@keyring-theme': './src/keyring-theme',
        '@components': './src/components',
        '@events': './src/events',
        '@hooks': './src/hooks',
        '@screens': './src/screens',
        '@services': './src/services',
        '@types': './src/types',
        '@utils': './src/utils',
      },
    },
  ],
]

if (process.env['ENV'] === 'prod') {
  plugins.push('transform-remove-console')
}

// react-native-reanimated plugin must be listed last
plugins.push('react-native-reanimated/plugin')

module.exports = {
  presets,
  plugins,
}
