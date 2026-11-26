/**
 * The hidden-vetting modules must still be evaluated after Metro inlines requires.
 *
 * `app/metro.config.js` turns on `inlineRequires` for every build that is not
 * Storybook. It moves a module's `require` to the first use of its binding —
 * and for a re-export, the only use is inside the export's getter, which
 * nothing calls. An adapter that registers a seam on import is then bundled
 * and never run: that is how build 254 shipped with private vetting invisible,
 * with the code present in the APK and every unit test green, because jest
 * does not inline requires.
 *
 * So this is deliberately not a test of behaviour. It runs the real
 * `modules/trust-tasks/index.ts` through the app's own two passes — the React
 * Native babel preset, then metro-transform-worker's inline-requires plugin —
 * and asserts each adapter's require is reached when the module is evaluated
 * rather than parked inside a function.
 */
import * as fs from 'fs'
import * as path from 'path'

import * as babel from '@babel/core'
import traverse from '@babel/traverse'
import { inlineRequiresPlugin } from 'metro-transform-plugins'

const INDEX = path.join(__dirname, '../index.ts')

/** The app's transform, in the order metro-transform-worker applies it. */
function asBundled(source: string, filename: string): string {
  const toCommonJs = babel.transformSync(source, {
    babelrc: false,
    configFile: false,
    filename,
    presets: [require('@react-native/babel-preset')],
    sourceType: 'module',
  })
  const inlined = babel.transformSync(toCommonJs!.code!, {
    babelrc: false,
    configFile: false,
    filename,
    // The same plugin and option metro-transform-worker passes when
    // `inlineRequires` is on (metro-transform-worker/src/index.js).
    plugins: [[inlineRequiresPlugin, { inlineableCalls: ['_$$_REQUIRE'] }]],
    sourceType: 'script',
  })
  return inlined!.code!
}

/** Every module this file requires when evaluated, not merely mentions. */
function requiredWhenEvaluated(code: string, filename: string): string[] {
  const ast = babel.parseSync(code, { babelrc: false, configFile: false, filename, sourceType: 'script' })
  const found: string[] = []
  traverse(ast!, {
    CallExpression(nodePath) {
      const callee = nodePath.node.callee
      if (!babel.types.isIdentifier(callee) || callee.name !== 'require') return
      const arg = nodePath.node.arguments[0]
      if (!babel.types.isStringLiteral(arg)) return
      // Inside a function body it runs only when that function is called, and
      // the export getters are exactly that case.
      if (nodePath.getFunctionParent()) return
      found.push(arg.value)
    },
  })
  return found
}

const MODULES = path.join(__dirname, '../hiddenVettingModules.ts')

describe("the hidden-vetting wiring, as the app's bundler leaves it", () => {
  it('still reaches both adapters from the registering module', () => {
    // Here the requires are expected INSIDE the exported function, which is
    // where inlineRequires puts them and where they belong: they run when the
    // function is called, which is the whole design. What matters is that they
    // are reachable from it at all — that `registerHiddenVettingModules` has
    // not been reduced to something that registers nothing.
    const bundled = asBundled(fs.readFileSync(MODULES, 'utf8'), MODULES)
    expect(bundled).toContain('./module/hiddenVettingAdapter')
    expect(bundled).toContain('./module/hiddenVetterAdapter')
    // And that calling it registers both is asserted for real, against the
    // behaviour, in hiddenSeamsRegistered.test.ts.
  })

  it('calls the registration from the trust-tasks index, rather than re-exporting it', () => {
    // A re-export would be deferred into a getter; a call is a use, so it
    // runs whenever this index is evaluated at all.
    const required = requiredWhenEvaluated(asBundled(fs.readFileSync(INDEX, 'utf8'), INDEX), INDEX)
    expect(required).toContain('./hiddenVettingModules')
  })

  it('a plain re-export would not have, which is the trap this guards', () => {
    // The shape the index used until 254's cause was found. If this ever stops
    // holding, inlineRequires has changed and the assertion above is measuring
    // nothing — so it is asserted, not described in a comment.
    const asReExport = "export { hiddenVettingSeamImplementation } from './module/hiddenVettingAdapter'\n"
    expect(requiredWhenEvaluated(asBundled(asReExport, INDEX), INDEX)).not.toContain('./module/hiddenVettingAdapter')
  })
})
