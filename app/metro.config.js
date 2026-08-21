const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')
const fs = require('fs')
const path = require('path')
const escape = require('escape-string-regexp')
// metro 0.83+ moved internal files under exports "./private/*"
const exclusionListModule = require('metro-config/private/defaults/exclusionList')
const exclusionList = exclusionListModule.default ?? exclusionListModule
require('dotenv').config()

const packageDirs = [
  fs.realpathSync(path.join(__dirname, 'node_modules', '@bifold/oca')),
  fs.realpathSync(path.join(__dirname, 'node_modules', '@bifold/remote-logs')),
  fs.realpathSync(path.join(__dirname, 'node_modules', '@bifold/core')),
  fs.realpathSync(path.join(__dirname, 'node_modules', '@bifold/verifier')),
  fs.realpathSync(path.join(__dirname, 'node_modules', '@bifold/react-native-attestation')),
  fs.realpathSync(path.join(__dirname, 'node_modules', '@bifold/vrc-contexts')),
  fs.realpathSync(path.join(__dirname, 'node_modules', '@bifold/react-hooks')),
  // @bifold/trust-tasks: platform-neutral trust-task plumbing shared with the
  // witness-server (document proofs, carriage message, payload validator)
  fs.realpathSync(path.join(__dirname, 'node_modules', '@bifold/trust-tasks')),
]

// In development, resolve these to source for hot reload; CI/production uses built output.
const BIFOLD_SOURCE_PACKAGES = [
  '@bifold/core',
  '@bifold/verifier',
  '@bifold/vrc-contexts',
  '@bifold/react-native-attestation',
  '@bifold/react-hooks',
  '@bifold/trust-tasks',
]
const bifoldSourceDirByPackage = {}
for (const dir of packageDirs) {
  try {
    const pak = require(path.join(dir, 'package.json'))
    if (BIFOLD_SOURCE_PACKAGES.includes(pak.name)) {
      bifoldSourceDirByPackage[pak.name] = dir
    }
  } catch (_) {
    // ignore missing or invalid package.json
  }
}

// bifold workspace deps hoist to bifold/node_modules; metro must watch it to
// resolve them from bifold's built lib output (production bundles)
const bifoldNodeModules = fs.realpathSync(path.join(__dirname, '..', 'bifold', 'node_modules'))

const watchFolders = [...packageDirs, bifoldNodeModules]

const extraExclusionlist = []
const extraNodeModules = {}

// Module aliases for React Native compatibility
const polyfillModules = {
  // js-sha256 is used by the patched rdf-canonize (RDFC SHA-256 on RN).
  // (jsonld-signatures no longer needs a patch: v12 ships its own RN shim
  // built on expo-crypto — see docs/CRYPTO_SUITE_FOLLOWUP.md.)
  'js-sha256': path.join(__dirname, 'node_modules', 'js-sha256', 'src', 'sha256.js'),
  // Stream and buffer polyfills
  stream: path.join(__dirname, 'node_modules', 'stream-browserify'),
  buffer: path.join(__dirname, 'node_modules', 'buffer'),
  // Force rdf-canonize to use our patched version from app's node_modules
  'rdf-canonize': path.join(__dirname, 'node_modules', 'rdf-canonize'),
  // bifold workspace cross-deps hoist to bifold/node_modules, which metro
  // doesn't watch; resolve them through the app's portals instead
  '@bifold/react-hooks': path.join(__dirname, 'node_modules', '@bifold/react-hooks'),
}

for (const packageDir of packageDirs) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pak = require(path.join(packageDir, 'package.json'))
  const modules = Object.keys({
    ...pak.peerDependencies,
    ...pak.devDependencies,
  })
  extraExclusionlist.push(...modules.map((m) => path.join(packageDir, 'node_modules', m)))

  modules.reduce((acc, name) => {
    acc[name] = path.join(__dirname, 'node_modules', name)
    return acc
  }, extraNodeModules)
}

module.exports = (async () => {
  const defaultConfig = await getDefaultConfig(__dirname)
  const {
    resolver: { sourceExts, assetExts },
  } = defaultConfig
  const metroConfig = {
    projectRoot: path.resolve(__dirname, './'),
    transformer: {
      babelTransformerPath: require.resolve('react-native-svg-transformer'),
      getTransformOptions: async () => ({
        transform: {
          experimentalImportSupport: false,
          inlineRequires: process.env.LOAD_STORYBOOK !== 'true',
        },
      }),
      minifierPath: 'metro-minify-terser',
      minifierConfig: {
        keep_classnames: true,
        keep_fnames: true,
        mangle: {
          keep_classnames: true,
          keep_fnames: true,
        },
        compress: {
          drop_console: process.env.NODE_ENV === 'production',
          drop_debugger: true,
          pure_funcs: ['console.log'],
        },
      },
    },
    resolver: {
      blacklistRE: exclusionList(extraExclusionlist.map((m) => new RegExp(`^${escape(m)}\\/.*$`))),
      extraNodeModules: {
        ...extraNodeModules,
        ...polyfillModules,
      },
      assetExts: assetExts.filter((ext) => ext !== 'svg'),
      sourceExts: [...sourceExts, 'svg', 'cjs'],
      // Prefer browser builds (e.g. nanoid) over node builds that require('crypto').
      // Same setup as bifold samples/app.
      unstable_enablePackageExports: true,
      unstable_conditionNames: ['react-native', 'browser', 'require'],
      nodeModulesPaths: [path.join(__dirname, 'node_modules'), bifoldNodeModules],
      // Force specific module imports to use our polyfilled/patched versions
      resolveRequest: (context, moduleName, platform) => {
        // Singleton packages: always resolve from the app's node_modules so
        // bifold sources never load a second copy (bifold/node_modules is on
        // nodeModulesPaths, which would otherwise win for react etc.)
        const singletonPrefixes = [
          'react',
          'react-native',
          'react-dom',
          '@credo-ts/core',
          '@credo-ts/didcomm',
          '@credo-ts/anoncreds',
        ]
        const isSingleton = singletonPrefixes.some((pkg) => moduleName === pkg || moduleName.startsWith(`${pkg}/`))
        if (isSingleton && !context.originModulePath.startsWith(__dirname)) {
          // Re-resolve as if requested from the app root (keeps package
          // "exports" handling intact, unlike remapping to an absolute path)
          return context.resolveRequest(
            { ...context, originModulePath: path.join(__dirname, 'index.js') },
            moduleName,
            platform
          )
        }
        // Ensure js-sha256 is resolved from app's node_modules
        // This is needed by the patched rdf-canonize (jsonld-signatures v12
        // no longer needs it — its RN SHA-256 shim uses expo-crypto)
        if (moduleName === 'js-sha256') {
          return context.resolveRequest(context, path.join(__dirname, 'node_modules', 'js-sha256'), platform)
        }
        // Intercept rdf-canonize package requests to ensure patched version is used
        if (moduleName === 'rdf-canonize' || moduleName.startsWith('rdf-canonize/')) {
          const subPath = moduleName.replace('rdf-canonize', '')
          const resolvedPath = path.join(__dirname, 'node_modules', 'rdf-canonize') + subPath
          return context.resolveRequest(context, resolvedPath, platform)
        }
        // Resolve @noble/curves subpath exports (e.g., @noble/curves/p256)
        // Metro has trouble with ESM subpath exports, so we resolve them explicitly
        if (moduleName.startsWith('@noble/curves/') || moduleName.startsWith('@noble/hashes/')) {
          // Extract the subpath (e.g., 'p256' from '@noble/curves/p256')
          const parts = moduleName.split('/')
          const packageName = parts.slice(0, 2).join('/') // '@noble/curves' or '@noble/hashes'
          const subPath = parts.slice(2).join('/') // 'p256' or 'sha2' etc.

          // Handle .js extension - some imports include it, some don't
          const fileName = subPath.endsWith('.js') ? subPath : `${subPath}.js`
          const resolvedPath = path.join(__dirname, 'node_modules', packageName, fileName)

          // Check if the file exists and return resolved path
          if (fs.existsSync(resolvedPath)) {
            return {
              filePath: resolvedPath,
              type: 'sourceFile',
            }
          }
          // If .js doesn't exist, try without extension
          const resolvedPathNoExt = path.join(__dirname, 'node_modules', packageName, subPath)
          if (fs.existsSync(resolvedPathNoExt)) {
            return {
              filePath: resolvedPathNoExt,
              type: 'sourceFile',
            }
          }
        }
        // In development only: resolve bifold packages to source for hot reload
        if (process.env.NODE_ENV !== 'production' && bifoldSourceDirByPackage[moduleName]) {
          const packageDir = bifoldSourceDirByPackage[moduleName]
          const sourceEntry = path.join(packageDir, 'src', 'index.ts')
          if (fs.existsSync(sourceEntry)) {
            return {
              filePath: sourceEntry,
              type: 'sourceFile',
            }
          }
        }
        return context.resolveRequest(context, moduleName, platform)
      },
    },
    watchFolders,
  }

  return mergeConfig(defaultConfig, metroConfig)
})()
