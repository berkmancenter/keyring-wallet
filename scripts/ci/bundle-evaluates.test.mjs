// node --test scripts/ci/bundle-evaluates.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { evaluate, moduleTable, withoutEntry } from './bundle-evaluates.mjs'

// A Metro-shaped bundle: the module system is a stand-in with the same __d/__r contract (define by id, require by id,
// evaluate lazily once), and the footers carry the paths the real one does.
const prelude = `
var __m = {}, __cache = {};
function __d(f, id, deps, path) { __m[id] = { f, deps, path } }
function __r(id) {
  if (__cache[id]) return __cache[id].exports
  var m = __cache[id] = { exports: {} }
  var def = __m[id]
  def.f(global, __r, function (i) { return __r(def.deps[i]) }, m, m.exports, def.deps)
  return m.exports
}
`
const bundle = (modules, entry) =>
  prelude +
  modules
    .map(
      ({ id, deps, path, body }) =>
        `__d(function (global, _$$_REQUIRE, _$$_IMPORT_DEFAULT, module, exports, _dependencyMap) {\n${body}\n},${id},[${deps.join(',')}],"${path}")`
    )
    .join('\n') +
  `\n__r(0);\n__r(${entry});\n`

const MODULES = [
  { id: 0, deps: [], path: 'node_modules/reflect-metadata/Reflect.js', body: 'global.__reflect = true' },
  { id: 1, deps: [2], path: '../packages/trust-tasks/src/index.ts', body: 'exports.v = _$$_REQUIRE(_dependencyMap[0]).Ajv2020' },
  { id: 2, deps: [], path: 'node_modules/ajv/dist/2020.js', body: 'module.exports = function Ajv2020() {}; module.exports.Ajv2020 = module.exports' },
  { id: 3, deps: [4], path: '../packages/core/src/modules/x.ts', body: 'var Base = _$$_REQUIRE(_dependencyMap[0]).Missing; exports.X = Base.prototype' },
  { id: 4, deps: [], path: 'node_modules/old-copy/dist/2020.js', body: 'module.exports = function Old() {}' },
  { id: 5, deps: [], path: 'src/index.js', body: 'throw new Error("the app entry must not run")' },
]

test('the table maps paths to ids, the ../ prefix of workspace paths dropped', () => {
  const t = moduleTable(bundle(MODULES, 5))
  assert.equal(t.get('packages/trust-tasks/src/index.ts'), 1)
  assert.equal(t.get('node_modules/ajv/dist/2020.js'), 2)
  assert.equal(t.size, 6)
})

test('the entry calls are stripped, so loading the table runs nothing', () => {
  assert.doesNotMatch(withoutEntry(bundle(MODULES, 5)), /__r\(5\)/)
  const r = evaluate(bundle(MODULES, 5), ['packages/trust-tasks/src/index.ts'])
  assert.deepEqual(r.map((x) => [x.path, x.ok]), [['packages/trust-tasks/src/index.ts', true]])
})

test('a module whose evaluation reads a property of an undefined import is reported with its path and the throw', () => {
  const r = evaluate(bundle(MODULES, 5), ['packages/trust-tasks/src/index.ts', 'packages/core/src/modules/x.ts'])
  assert.equal(r[0].ok, true)
  assert.equal(r[1].ok, false)
  assert.match(r[1].error.message, /prototype/)
})

test('a path that is not in the bundle is a failure of the list, not a pass', () => {
  const r = evaluate(bundle(MODULES, 5), ['packages/gone/src/index.ts'])
  assert.equal(r[0].ok, false)
  assert.match(r[0].error.message, /not in the bundle/)
})
