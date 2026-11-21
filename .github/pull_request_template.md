## What is in this PR?

<!-- The goal, and the steps taken to reach it. -->

## Changes in the codebase

<!-- The engineering side: what is added or changed, and any refactoring. -->

-

## Stack

<!-- Delete this section for a PR that is not part of a plan's stack (a hot fix, a small change).
     Format: docs/plans/CLAUDE.md, "Implementing a plan: stacked PRs". -->

Stack: <n> of <m>. Base: <branch> (#<PR below>), at <sha8>.
Plan section: <docs/plans/…-plan.md §N, at a commit permalink if the plan may move>
Above / below: <#PR above>, <#PR below>

## Before opening

<!-- Tick what you ran, and note any result that is not a plain pass. Commands: docs/TESTING.md.
     A PR that changes only plans and their assets runs the plan checker instead of the app checks
     (docs/plans/CLAUDE.md, "A plan-only PR runs no app tests locally"); say so here. -->

- [ ] `yarn lint`, `yarn prettier`, `yarn typecheck` (root)
- [ ] The build this change could break (native build for `app/ios`, `app/android`, native modules or patches)
- [ ] Tests for what changed (`yarn test`, or the package's own `yarn test` under `bifold/packages/*`)
- [ ] Every commit is signed and has a `Signed-off-by:` trailer (root `CLAUDE.md`, "Commit conventions")
- [ ] Docs, comments and environment-variable notes updated as needed; breaking changes noted in the commit messages
- [ ] A PR that adds or substantively changes a plan under `docs/plans/` links the dated companion recording its completeness and correctness check: <link>

## Testing this PR

<!-- Steps a reviewer can follow to see it work. -->

- [ ]

## Additional information

<!-- Anything else useful for review: performance, design choices, follow-ups. -->
