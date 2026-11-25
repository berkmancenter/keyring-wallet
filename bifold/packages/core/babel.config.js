const presets = ['module:@react-native/babel-preset']
const plugins = [
  '@babel/plugin-transform-export-namespace-from',
  // credo 0.7's @owf/mdoc ships static class blocks, which the RN preset does not lower
  '@babel/plugin-transform-class-static-block',
  [
    'module-resolver',
    {
      root: ['.'],
      extensions: ['.tsx', '.ts', '.js', '.jsx', '.json'],
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
