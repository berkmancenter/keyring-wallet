# `.yarn/patches/`

Patches applied through the `patch:` protocol in the root `package.json`'s
`resolutions`. Yarn applies them at install; nothing here is read at runtime.

To change one, use `yarn patch <package>` / `yarn patch-commit -s`, which
regenerates the file and the lockfile checksum together. A hand-edited patch
needs `yarn install` afterwards so the lockfile's checksum matches, or CI's
`yarn install --immutable` fails on the mismatch.

## Two things about the credo-ts `0.7.1-pr-2704` patches

**The installed version string says `0.6.3`.** That build's own
`package.json` carries `"version": "0.6.3"` even though it resolves as
`0.7.1-pr-2704-20260909134930`. Yarn resolves it correctly, so builds and the
lockfile are right, but anything that *reads* the installed version — a doctor
script, a support banner, a gate assertion, `node -e
"require('@credo-ts/core/package.json').version"` — will report 0.6.3 and look
as though the upgrade never happened. Check the resolution in `package.json`, or
grep the patch marker in the installed file, rather than the version string.
Nothing in this repository gates on it today (checked 2026-10-14); this note is
for whoever adds the first such check.

**Keep `.orig` files out of a patch.** `patch-package`-style workflows leave
`<file>.orig` beside an edited file, and if one is present when the patch is
generated it is captured as a new-file hunk: the pr-2704 patch carried
`DcqlService.mjs.orig` (578 lines) and `validators.mjs.orig` (106 lines), 684 of
its 943 lines, writing two dead copies into every install. They change no
behaviour, which is why they survived review — delete the `.orig` files before
generating, and check the hunk list (`grep '^diff --git' <patch>`) after.
