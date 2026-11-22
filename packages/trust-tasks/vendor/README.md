# Vendored `@openvtc/vti-tsp-js`

`@bifold/trust-tasks` depends on `@openvtc/vti-tsp-js` for the TSP wire layer
(the binary CESR tables, the version marker, the relationship state machine and
the raw-key reference `pack`/`unpack` the tests cross-check against). This
directory holds a prebuilt copy of that package, because the version this
package needs is not on npm yet.

|                        |                                                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tarball                | `openvtc-vti-tsp-js-0.3.0-bfdb0dc.tgz`                                                                                                                                       |
| Upstream               | `OpenVTC/vta-browser-plugin`, `packages/tsp-js`, commit `bfdb0dcbd875db56b75003c7ab89ae1b92325fd6` (main, after PR #253 merged TSP Rev 3 and #249–#252, #254, #255 followed) |
| Version in the tarball | 0.3.0 — packs TSP **Rev 3** (`YTSP-AAC`), reads Rev 3 and Rev 2                                                                                                              |
| Local change           | `vti-tsp-js-hermes-textdecoder.patch`, applied to `src/` before building                                                                                                     |
| SHA-256                | `6b5054dafa35becb05977c8fba17c825a6ac8693afdb86d9de759846303769f8`                                                                                                           |

## Why a tarball, not a registry version

npm has `@openvtc/vti-tsp-js` 0.1.0 and 0.2.0, both Rev 2. Rev 3 (0.3.0) is
merged on upstream `main` but unpublished. A git dependency on the upstream
monorepo would have every `yarn install` clone the whole browser-plugin
repository and run its Node 24 workspace install just to build one `tsc`
package; a prebuilt tarball pinned to the commit is the same code with none of
that cost, and it is dropped the day 0.3.x reaches npm.

## The patch

`new TextDecoder("utf-8", { fatal: true })` throws at construction on React
Native's Hermes engine, and five upstream modules construct one at import time
— so the package cannot be imported on a phone without the patch. The patch
adds `src/cesr/utf8.ts` (feature-detect `fatal`; fall back to a lenient decode
verified by re-encoding, which rejects the same inputs) and points the five
sites at it. Same fix Keyring carried against 0.1.0 as a `.yarn/patches` entry;
it is a standing request to upstream.

## Rebuilding

```sh
node scripts/openvtc/setup-external.mjs          # at the wallet root: clones the upstream repos
cd bifold/packages/trust-tasks
node vendor/build-vti-tsp-js.mjs ../../../external/vta-browser-plugin [<commit>]
```

The script archives `packages/tsp-js` at the commit, applies the patch,
installs the package's own three `@noble` dependencies and TypeScript, builds,
runs upstream's test suite (124 tests at this pin), packs, and prints the
tarball's SHA-256. Compare rebuilt tarballs by content (`tar -xzf` both and
`diff -r`): npm's tarball bytes are not reproducible across machines, the
extracted files are.

Bumping the pin: rebuild against the new commit, replace the tarball, update
the `file:` reference in `../package.json`, the table above, and re-run the
`tsp` test suites in `@bifold/core` — the cross-checks there are what catch a
wire change.
