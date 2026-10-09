# The testID manifest

`packages/core/testids.json` lists every accessibility `testID` the core package
hands to React Native. It is generated from the source tree, committed, and
checked in CI, so the wallet's e2e drivers can read it instead of retyping the
strings, and a PR that removes or renames an id the drivers rely on fails at PR
time rather than at the next gate.

## What is in it

```json
{
  "generatedFrom": "<bifold commit the file was generated at>",
  "prefix": "com.ariesbifold:id/",
  "keys": { "AgentCreateDone": ["src/modules/trust-tasks/screens/VtaCreateAgent.tsx:850"] },
  "stems": { "AgentDevice_": ["src/modules/trust-tasks/screens/DeviceRow.tsx:74"] },
  "raw": { "ListCredentialsRoot": ["src/screens/ListCredentials.tsx:268"] },
  "derived": [{ "src/navigators/TabStack.tsx:339": "t('TabStack.Messages')" }]
}
```

- `keys`: literal keys passed to `testIdWithKey(...)` (including
  `tabBarTestID: testIdWithKey('...')`) and every string value of an exported
  `<Name>Ids` map, the screen-contract pattern
  (`export const VettingIds = { root: 'VettingRoot' } as const`). Both branches
  of a conditional count. The runtime id is `prefix + key`.
- `stems`: the literal head of a dynamic key, `AgentDevice_` for
  ``testIdWithKey(`AgentDevice_${key}`)`` or `testIdWithKey('AgentDevice_' + key)`.
  Most end in `_`; a few older ones do not (`Dismiss`, `button-`). The runtime
  id is `prefix + stem + <value>`.
- `raw`: `testID="Literal"` or `testID={'Literal'}` written without the helper.
  No prefix is applied to these at runtime, so they are kept apart from `keys`.
- `derived`: calls whose key comes from a function or variable
  (`testIdWithKey(t('...'))`, `testIdWithKey(label)`). The manifest cannot name
  these; they are listed with their expression so the lint and cleanup work can
  see them. A key derived from translated text changes with the language and is
  a cleanup candidate.

Each entry maps to the call sites that produce it (`path:line`, relative to
`packages/core`), sorted, so the file is deterministic for a given tree.

The generator walks the TypeScript AST of `src/**/*.{ts,tsx}` (no type
checker), skipping `__tests__/` and `*.test.*`.

## When it changes

Whenever a `testID` is added, removed, renamed or moved to another line. After
such a change, regenerate and commit the result alongside it:

```sh
cd packages/core
yarn testids          # rewrites testids.json
yarn testids:check    # what CI runs: exit 1 and list the differences if the file is stale
yarn testids:test     # the extractor's own tests (node:test, not jest)
```

`generatedFrom` records the commit the file was generated at and is ignored by
the check, so an unrelated commit does not make the file stale. Moving a call
site does: the drivers use the locations to find where an id lives.

CI runs the check in the `Linting and formatter` job of `quality.yaml`, after
the linter. A failing check prints the added (`+`), removed (`-`) and moved
(`~`) entries; the fix is to run `yarn testids` and commit.

## Who reads it

The wallet repository's e2e drivers (the Appium two-device tests) import this
file for their selectors. Removing or renaming a key here therefore shows up as
a manifest diff in the PR, which is the signal to update the drivers in the
same change rather than discover the breakage at gate time.

Script: `packages/core/scripts/gen-testids.mjs` (`--check`, `--json`,
`--out <path>`). Fixtures for its tests live in `scripts/__fixtures__/`; they are
excluded from the package's `tsc` run and from the published package.
