/**
 * Whether `moduleName` is the demo-profiles barrel import (`./src/demo-profiles`
 * — App.tsx is the only file that imports it, see
 * `src/demo-profiles/README.md`'s "Stripping demos from a build" section) that
 * `metro.config.js`'s `resolveRequest` swaps for `demoProfilesStub.ts` when
 * `ACTIVE_DEMO_PROFILE=none`.
 *
 * Pulled out of `metro.config.js` into its own module purely so it's
 * unit-testable without booting Metro's whole config pipeline (which
 * `metro.config.js` itself, as an async IIFE wired to `getDefaultConfig`, is
 * awkward to exercise directly in a plain jest run).
 */
function isDemoProfilesBarrelImport(moduleName) {
  return moduleName === './src/demo-profiles' || moduleName.endsWith('/demo-profiles')
}

module.exports = { isDemoProfilesBarrelImport }
