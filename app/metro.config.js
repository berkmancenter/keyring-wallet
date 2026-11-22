const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')
const fs = require('fs')
const path = require('path')
// metro 0.83+ moved internal files under exports "./private/*"
const exclusionListModule = require('metro-config/private/defaults/exclusionList')
const exclusionList = exclusionListModule.default ?? exclusionListModule
const { isDemoProfilesBarrelImport } = require('./metro/isDemoProfilesImport')
require('dotenv').config()

// The framework's packages (@bifold/*) are workspaces of this repository at packages/*, installed by the one
// `yarn install` at the root (docs/plans/single-codebase-plan.md, Phase 2). Each resolves to its TypeScript source
// through its `source` main field (resolverMainFields below puts it first), in development and release bundles
// alike: there is no built lib/ to fall out of date, and no second install whose node_modules could hold a second
// copy of anything. Metro only resolves files inside its watch folders, so the repository root is watched: it
// covers packages/*, app/ and the hoisted node_modules.
const repoRoot = fs.realpathSync(path.join(__dirname, '..'))
const rootNodeModules = path.join(repoRoot, 'node_modules')

// ACTIVE_DEMO_PROFILE=none already means "no demo profiles" at RUNTIME (see
// src/demo-profiles/index.ts's selectDemoProfiles) — every installed
// profile's code still ships in the bundle, just unregistered. This reuses
// the SAME lever to also mean "no demo profiles in the BUNDLE": one flag,
// one README table, no way for "runtime says none" and "bundle still has
// them" to drift apart. See src/demo-profiles/README.md's "Stripping demos
// from a build" section.
// Unset strips too: a shipped build carries no demo code at all (decided
// 2026-09-25). A demo build sets a profile id or `all`, which keeps them.
const stripDemoProfiles = !process.env.ACTIVE_DEMO_PROFILE || process.env.ACTIVE_DEMO_PROFILE === 'none'
const demoProfilesStubPath = path.join(__dirname, 'metro', 'demoProfilesStub.ts')

// Rooms' sample data (bifold modules/rooms/sample/sampleRooms) ships only in a build made with
// ROOMS_SAMPLE=1: an internal install or a local development build. Unset, as on every store and CI
// build, the module resolves to a stub, so none of it is bundled. One switch decides both the data
// and the Developer switch that reveals it. The store workflow refuses ROOMS_SAMPLE outright, and
// scripts/ci/check-no-rooms-sample.sh checks the bundle itself.
const stripRoomsSample = process.env.ROOMS_SAMPLE !== '1'
const roomsSampleStubPath = path.join(__dirname, 'metro', 'roomsSampleStub.ts')
// `useRoomsService` is the only file that imports the sample, as `./sample/sampleRooms`, from inside
// the framework's modules/rooms (packages/core/src/modules/rooms, resolved as source in every bundle).
const isRoomsSampleImport = (moduleName, originModulePath) =>
  /^\.\/sample\/sampleRooms(\.[jt]sx?)?$/.test(moduleName) && /[\\/]modules[\\/]rooms[\\/]/.test(originModulePath ?? '')

const watchFolders = [repoRoot]

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
      // The former framework-package exclusion list (their nested node_modules) is gone with the second install:
      // one tree has nothing to exclude. exclusionList() with no entries is Metro's default block list.
      blacklistRE: exclusionList([]),
      extraNodeModules: polyfillModules,
      assetExts: assetExts.filter((ext) => ext !== 'svg'),
      sourceExts: [...sourceExts, 'svg', 'cjs'],
      // `source` first: the @bifold/* workspaces name their src/index.ts there, so the bundle is built from the
      // framework's TypeScript directly (no lib/ build step, in dev and release alike). Third-party packages
      // rarely declare `source`; when one does it is its own TypeScript, which Metro transforms as it does ours.
      resolverMainFields: ['source', 'react-native', 'browser', 'main'],
      // Prefer browser builds (e.g. nanoid) over node builds that require('crypto').
      unstable_enablePackageExports: true,
      unstable_conditionNames: ['react-native', 'browser', 'require'],
      // The app's own node_modules (hoistingLimits keeps its dependencies there: the native projects hardcode
      // app/node_modules paths), then the root's, where the packages/* dependencies hoist.
      nodeModulesPaths: [path.join(__dirname, 'node_modules'), rootNodeModules],
      // Force specific module imports to use our polyfilled/patched versions
      resolveRequest: (context, moduleName, platform) => {
        // ACTIVE_DEMO_PROFILE=none: swap the demo-profiles barrel import for
        // a zero-dependency stub (see demoProfilesStub.ts's own comment).
        // App.tsx is the ONLY file that imports './src/demo-profiles' (no
        // other file reaches into demo-profiles/ at all — enforced by
        // convention, see src/demo-profiles/README.md), so intercepting that
        // one specifier is sufficient: Metro's dependency graph then never
        // has an edge into approver/, trading-card/, or starter/, and none
        // of that code is walked, transformed, or included in the bundle —
        // not just unregistered at runtime the way ACTIVE_DEMO_PROFILE=none
        // already worked before this rule existed.
        if (stripDemoProfiles && isDemoProfilesBarrelImport(moduleName)) {
          return { filePath: demoProfilesStubPath, type: 'sourceFile' }
        }
        if (stripRoomsSample && isRoomsSampleImport(moduleName, context.originModulePath)) {
          return { filePath: roomsSampleStubPath, type: 'sourceFile' }
        }
        // Singleton packages: always resolve from the app's node_modules so
        // the framework's sources never load a second copy (the root's
        // node_modules is on nodeModulesPaths, and a request from packages/*
        // would otherwise find the root's copy of react etc. first)
        //
        // The native-binding families below are here for a sharper reason than
        // react's: each registers its native implementation on a MODULE-LEVEL
        // singleton as an import side effect (NativeAskar.register(...) in
        // @openwallet-foundation/askar-react-native, and the anoncreds/indy-vdr
        // equivalents). Two physical copies means two singletons, so the copy
        // that gets registered is not necessarily the copy a consumer reads,
        // and the consumer then throws "Native askar has not been registered
        // yet" even though everything installed correctly.
        //
        // This is not hypothetical: it made every correct PIN be reported as
        // wrong on device (2026-08-26). AuthProvider's checkWalletPIN opens the
        // Askar store through @credo-ts/askar, which resolved into the bifold
        // submodule's tree, while askar-react-native resolved to the app's —
        // registration landed on one singleton and the store check read the
        // other. It surfaced only after the credo 0.6 upgrade put openStore in
        // that path, since nothing else needs native askar before the main
        // agent exists.
        //
        // Since the fold there is one install, but still two places a copy can
        // live: the app's node_modules (its `hoistingLimits: workspaces` keeps
        // its dependencies there, because the native projects hardcode that
        // path) and the root's, where the packages/* dependencies hoist. A
        // package both sides depend on at the same version is installed
        // twice, once in each, so pinning still has to happen here. Keep this
        // list in sync when a new native-backed dependency reaches
        // packages/*. core's jest has the same pin for its own tests
        // (moduleNameMapper for askar-shared in packages/core/jest.config.js);
        // a dependency added here may belong there too. Changing this file
        // runs the android-apk and ios-simulator builds (paths in
        // .github/workflows/test-builds.yml), so a resolution mistake here is
        // caught before merge.
        const singletonPrefixes = [
          'react',
          'react-native',
          'react-dom',
          '@credo-ts/core',
          '@credo-ts/didcomm',
          '@credo-ts/anoncreds',
          '@credo-ts/askar',
          '@credo-ts/indy-vdr',
          '@credo-ts/react-native',
          '@credo-ts/webvh',
          '@openwallet-foundation/askar-shared',
          '@openwallet-foundation/askar-react-native',
          '@hyperledger/anoncreds-shared',
          '@hyperledger/anoncreds-react-native',
          '@hyperledger/indy-vdr-shared',
          '@hyperledger/indy-vdr-react-native',
          // class-transformer's @Expose metadata store is module-local: @bifold/trust-tasks'
          // DIDComm v2 envelope registers renames Credo's JsonTransformer must see, so the
          // bundle needs exactly one copy (didcomm_v2_subtask.md C10).
          'class-transformer',
          // Carries a keyring patch (utf8 always uses its pure-JS codec; the
          // built-in path breaks credo's first agent start in release bundles,
          // 2026-09-21). The root's copy may be unpatched, so pin it.
          '@scure/base',
        ]
        const isSingleton = singletonPrefixes.some((pkg) => moduleName === pkg || moduleName.startsWith(`${pkg}/`))
        if (isSingleton && !context.originModulePath.startsWith(__dirname)) {
          // Re-resolve as if requested from the app root (keeps package
          // "exports" handling intact, unlike remapping to an absolute path)
          return context.resolveRequest(
            { ...context, originModulePath: path.join(__dirname, 'index.js') },
            moduleName,
            platform,
          )
        }
        // Ensure js-sha256 is resolved from app's node_modules
        // This is needed by the patched rdf-canonize (jsonld-signatures v12
        // no longer needs it — its RN SHA-256 shim uses expo-crypto)
        if (moduleName === 'js-sha256') {
          return context.resolveRequest(context, path.join(__dirname, 'node_modules', 'js-sha256'), platform)
        }
        // @openvtc/trust-tasks subpaths (e.g. '@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload')
        //
        // Its exports map declares only `types` and `import` conditions:
        //   "./*": { "types": "./dist/*.d.ts", "import": "./dist/*.js" }
        //
        // There is no `require` and no `default`, so under CommonJS resolution
        // nothing matches, Metro warns ("no match was resolved for this
        // request"), falls back to file-based resolution, and fails — the
        // subpath only exists under dist/. Before the fold, dev bundles never
        // hit this because core resolved to ESM source while the release
        // bundle resolved core to lib/commonjs, which is why `assembleRelease`
        // broke while every debug build was fine; both resolve to source now,
        // and the mirror below is what makes the subpaths resolve at all.
        // Mirror the map's `import` target explicitly. Adding `require` to
        // unstable_conditionNames does not help: the package declares no such
        // condition to match.
        if (moduleName.startsWith('@openvtc/trust-tasks/')) {
          // `./runtime` (from 0.27.8: the runtime without the prebuilt spec modules) is the one
          // export whose file is not dist/<path>.js. dist/_runtime/index.js exists in 0.9 as well.
          const requested = moduleName.slice('@openvtc/trust-tasks/'.length)
          const subPath = requested === 'runtime' ? '_runtime/index' : requested
          // The app's copy first, then the root's (where packages/* dependencies hoist).
          const bases = [path.join(__dirname, 'node_modules'), rootNodeModules]
          for (const base of bases) {
            const candidate = path.join(base, '@openvtc', 'trust-tasks', 'dist', `${subPath}.js`)
            if (fs.existsSync(candidate)) {
              return { filePath: candidate, type: 'sourceFile' }
            }
          }
          // No dist/<subPath>.js in any base — falling through to Metro's default
          // resolution would just reproduce the "no match was resolved" failure
          // this block exists to work around. Fail loudly instead.
          throw new Error(
            `[metro.config] Could not resolve '${moduleName}': no dist/${subPath}.js found under any of:\n` +
              bases
                .map((base) => `  ${path.join(base, '@openvtc', 'trust-tasks', 'dist', `${subPath}.js`)}`)
                .join('\n'),
          )
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
        return context.resolveRequest(context, moduleName, platform)
      },
    },
    watchFolders,
  }

  return mergeConfig(defaultConfig, metroConfig)
})()
