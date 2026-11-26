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
// through Metro's default main fields: the React Native packages name src/index.ts as `main`, the Node-consumed
// ones (whose `main` is a build/ for Node) name it in their `react-native` field, which Metro reads first. So the
// bundle is built from source in development and release alike: no built lib/ to fall out of date, and no second
// install whose node_modules could hold a second copy of anything. Metro only resolves files inside its watch
// folders, so the repository root is watched: it covers packages/*, app/ and the hoisted node_modules.
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

// Should a bare request (`react`, `@scope/name`, or a subpath of either) made from OUTSIDE the app resolve to the
// app's copy of that package? Yes when the requesting workspace lists it as a peer or dev dependency (the app
// provides it: react, react-native, i18next, the navigation packages, …; this is the rule the pre-move config
// applied through its per-package `extraNodeModules` map), and yes when the copy the requester would otherwise get
// is the SAME VERSION as the app's (one copy in the bundle instead of two). No when the requester declares the
// package as its own dependency and its resolution is another version: that version is what its code was written
// against. Phase 2's first Test build died on exactly this: trust-tasks asks for ajv ^8.17 and imports
// `{ Ajv2020 } from 'ajv/dist/2020'`, the app carries ajv 8.12 as a transitive dependency of something else, and a
// rule of "the app's copy wins" handed trust-tasks the older copy, where that named export does not exist
// (`new undefined`, "Cannot read property 'prototype' of undefined" on the device, at the first lazy require of
// @bifold/trust-tasks). Relative and absolute requests are not packages. Answers are cached per
// (requesting directory, package).
const appNodeModules = path.join(__dirname, 'node_modules')
const packageNameOf = (moduleName) => {
  if (moduleName.startsWith('.') || path.isAbsolute(moduleName)) return null
  const parts = moduleName.split('/')
  if (moduleName.startsWith('@')) return parts.length >= 2 ? parts.slice(0, 2).join('/') : null
  return parts[0] || null
}
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (_) {
    return null
  }
}
const versionAt = (dir, pkg) => readJson(path.join(dir, 'node_modules', pkg, 'package.json'))?.version ?? null
// The version Node's own resolution would give `pkg` from `fromDir`: the nearest node_modules up the tree that has it.
const resolvedVersion = (fromDir, pkg) => {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const v = versionAt(dir, pkg)
    if (v) return v
    if (dir === repoRoot || dir === path.dirname(dir)) return null
  }
}
// The workspace package.json that owns a file under packages/<name>/…, or null (a file under node_modules, or the app).
const workspaceManifestOf = (fromDir) => {
  const rel = path.relative(repoRoot, fromDir)
  const m = rel.match(/^packages\/([^/]+)(\/|$)/)
  return m && !rel.includes('node_modules') ? readJson(path.join(repoRoot, 'packages', m[1], 'package.json')) : null
}
const appCopyCache = new Map()
const appCopy = (moduleName, originModulePath) => {
  const pkg = packageNameOf(moduleName)
  if (!pkg) return false
  const fromDir = path.dirname(originModulePath)
  const key = `${fromDir}\u0000${pkg}`
  let use = appCopyCache.get(key)
  if (use === undefined) {
    const appVersion = versionAt(__dirname, pkg)
    if (!appVersion) use = false
    else {
      const manifest = workspaceManifestOf(fromDir)
      const provided = !!(manifest?.peerDependencies?.[pkg] || manifest?.devDependencies?.[pkg])
      use = provided || resolvedVersion(fromDir, pkg) === appVersion
    }
    appCopyCache.set(key, use)
  }
  return use
}

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
      // Metro's default main fields, deliberately: the framework's packages resolve to source through them. The
      // React Native packages name src/index.ts as `main`; the Node-consumed ones (trust-tasks, dtg-vocab,
      // credo-tsp-adapter, vrc-contexts) keep a build/ as `main` for Node and name src/index.ts in their
      // `react-native` field, which Metro reads first. (A `source`-first list was tried and resolved third-party
      // packages to sources they do not ship: html-parse-stringify's `source` is a file that is not in its tarball.)
      resolverMainFields: ['react-native', 'browser', 'main'],
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
        // twice, once in each, and a request from packages/* walks up to the
        // root's copy first. So the rule is general: ANY package the app has
        // under app/node_modules resolves from there, whoever asks (appCopy
        // below; 35 shared packages at the move, among them safe-area-context,
        // gesture-handler, screens and reanimated, whose providers and
        // consumers must be one module). The list that follows is the set
        // whose two copies have already broken the app or would break it
        // silently; it is asserted present in app/node_modules at config
        // load, so a dependency the app drops cannot leave a framework-only
        // copy unnoticed. core's jest pins askar-shared and class-transformer
        // the same way (moduleNameMapper in packages/core/jest.config.js); a
        // dependency added here may belong there too. Changing this file
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
        for (const pkg of singletonPrefixes) {
          if (!fs.existsSync(path.join(__dirname, 'node_modules', pkg))) {
            throw new Error(
              `[metro.config] ${pkg} is pinned to the app's copy but app/node_modules has none: ` +
                `every request for it would fall through to the root's copy (add it to app/package.json, or drop the pin)`
            )
          }
        }
        const isSingleton = singletonPrefixes.some((pkg) => moduleName === pkg || moduleName.startsWith(`${pkg}/`))
        if (
          !context.originModulePath.startsWith(__dirname + path.sep) &&
          (isSingleton || appCopy(moduleName, context.originModulePath))
        ) {
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
              bases.map((base) => `  ${path.join(base, '@openvtc', 'trust-tasks', 'dist', `${subPath}.js`)}`).join('\n')
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
