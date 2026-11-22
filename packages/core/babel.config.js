const presets = ['module:@react-native/babel-preset']
const plugins = [
  '@babel/plugin-transform-export-namespace-from',
  // credo 0.7's @owf/mdoc ships static class blocks, which the RN preset does not lower
  '@babel/plugin-transform-class-static-block',
  // No module-resolver here. It carried `root: ['.']`, which nothing in core uses (no bare import names a path from
  // the package root), and which rewrites a dependency's `from '.'` (react-native-gesture-handler's
  // ReanimatedSwipeable, reached through gifted-chat) to this package's own entry. While core was built, that entry
  // was lib/commonjs: a second, compiled copy of core loaded silently into every jest run that rendered a chat. Since
  // the one-tree move the entry is src/index.ts, the same modules the test is loading, and the rewrite became a
  // circular import (App → navigators → sharedConnectInviterCeremony → ../ceremony, half-evaluated: "is not a
  // function"). The app's babel.config.js avoids the same `root` for the same reason.
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
