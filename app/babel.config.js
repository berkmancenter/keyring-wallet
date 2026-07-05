const presets = ['module:@react-native/babel-preset']
const plugins = [
  [
    'module-resolver',
    {
      root: ['.'],
      extensions: ['.tsx', 'ts'],
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

module.exports = {
  presets,
  plugins,
}
