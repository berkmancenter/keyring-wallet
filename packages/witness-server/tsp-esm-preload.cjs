// Witness only: @openvtc/vti-tsp-js is ESM-only (its exports map has an "import" condition and no "require"), and the
// witness runs as CommonJS, so `require('@openvtc/vti-tsp-js')` (from @bifold/trust-tasks' CommonJS build) throws
// ERR_PACKAGE_PATH_NOT_EXPORTED. This preload points exactly that package's two entry points at their files; Node
// 20.19+ can require() an ES module that has no top-level await, which these have none of. Nothing else is touched.
'use strict'
const Module = require('module')
const fs = require('fs')
const path = require('path')

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 20 || (major === 20 && minor < 19)) {
  throw new Error(
    `witness: Node ${process.versions.node} cannot load @openvtc/vti-tsp-js (ESM-only); it needs Node 20.19 or later`
  )
}
const ENTRY = { '@openvtc/vti-tsp-js': 'dist/index.js', '@openvtc/vti-tsp-js/hpke': 'dist/crypto/hpke.js' }
const resolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  const file = ENTRY[request]
  if (file) {
    for (const dir of Module._nodeModulePaths(parent && parent.path ? parent.path : process.cwd())) {
      const f = path.join(dir, '@openvtc', 'vti-tsp-js', file)
      if (fs.existsSync(f)) return f
    }
  }
  return resolve.call(this, request, parent, ...rest)
}
