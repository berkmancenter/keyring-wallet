# CLAUDE.md — `docs/plans/`

Guidance for writing and maintaining planning documents in this directory. The
root `CLAUDE.md` covers the repo itself; this covers only how plans are written,
and exists because these documents are read twice — once by a human deciding, and
once by an agent implementing, months apart and with no shared memory.

## Layout

One plan is one file plus a companion folder:

```
<plan-name>.md                       the plan
<plan-name>/
  <YYYY-MM-DD>-<initials>.md         findings and decisions, dated and attributed
  <topic>_subtask.md                 a sub-plan owned by the parent
  mockups/mockups.ts                 the spec that draws the mockups (see "Diagrams and mockups")
  mockups/<NN>-<screen>.svg          UI mockups, generated from mockups.ts (the editable source)
  mockups/sheet.png                  the contact sheet of all of them, which the plan embeds
  mockups/sheet.manifest.json        what the sheet was built from (SVG hashes, token fingerprint)
```

A starting skeleton for a plan and for a companion is in
[`PLAN_TEMPLATE.md`](./PLAN_TEMPLATE.md).

## Two parts: an overview for people, a precision section for implementers

Every plan, subtask plan and dated companion has two parts, in this order in the
file:

1. **Overview** — the human section. A single `## Overview` directly under the
   header block, unnumbered, ending with a `---` rule. It says what this is, why,
   what it changes for a person, where it stands and what is needed from whom,
   with the diagrams, the mockups (when there is UI) and a summary of how it will
   be tested. It is about one screen of prose plus its pictures. It is written by
   the [`technical-plan-humanizer`](../../.claude/skills/technical-plan-humanizer/SKILL.md)
   skill **from** the precision section, and adds nothing normative: every claim
   in it is traceable to a numbered section below.
2. **Precision section** — `## 1.` onward, numbered, for an implementer with no
   memory of the conversation. Everything needed for full correctness lives
   here: scope and non-goals, current state, design, constraints with citations,
   decisions and rejected alternatives, steps with acceptance criteria, the
   detailed test plan, what is blocked on whom, and open questions. If the
   overview and the precision section ever disagree, the precision section wins
   and the overview is the bug.

The overview is unnumbered so it can be added to an existing plan without
renumbering, and so `§` references always point into the precision section.

### Telling the two parts apart

Each part opens with a machine-readable marker and a visible banner, so a person
and a tool can both tell which is which without guessing from headings:

```markdown
## Overview
<!-- plan-part: human -->

> **Human part: for people deciding and reviewing.** What this is, what a person
> sees, how we'll know it works, and what is needed from whom. It adds nothing: the
> numbered precision part below is authoritative, and if the two disagree, the
> precision part wins and this part is the bug.

…

---

<!-- plan-part: precision -->

> **Precision part: for implementers and agents.** Complete, exact and normative:
> implement from this part. Sections are numbered, and a bare `§n` means this
> plan's section n.

## 1. …
```

- The human marker is the first line after `## Overview` (a companion: after
  `## Summary`). The precision marker sits after the Overview's closing `---` and
  before `## 1.` (a companion: before its first `##` heading after the Summary,
  `## Precision check` or `## Findings and decisions`).
- Each marker is followed by its banner, a blockquote starting
  `> **Human part` or `> **Precision part`. Keep the template's wording unless
  the part needs a sentence more; a companion's banners say "findings" for
  "precision part" and "the plan's section n" for a bare `§n`.
- **To split a file**, take the human part from `<!-- plan-part: human -->` up
  to `<!-- plan-part: precision -->`, and the precision part from there to the
  end. The header block above the human marker is metadata.
- The checker requires both markers and banners in every file it checks; legacy
  files are skipped as before.

### Reading a plan (for agents)

Read the header block, then the human part for orientation only: it tells you
what the plan is for and where each topic lives (the `§` at each paragraph's end).
Then implement from the precision part. Never act on a claim that appears only in
the human part. If the two disagree, the precision part is right; say so in your
report, because the overview needs fixing. A step's acceptance criteria and the
test plan are in the precision part, never in the human part's summary table.

The header block above the overview is metadata only (title, status, roadmap
epic, one line of scope, the companion folder, parent/related plans) and stays
short. Dependency tables and the review index belong in the precision section,
not above the overview. Where they go when an existing plan migrates is in
"Existing plans".

## The order of work

A new plan, and any substantive revision of one, goes through these steps in
order. Do not start a later step on a precision section that has not passed step 2.

1. **Draft the precision section.** Precision first: the overview is a summary of
   something, and summarising a draft just produces a confident summary of gaps.
2. **Check it for completeness and correctness.** Run the checklist below.
   The check scales with the plan (below, "How much checking a plan
   needs"). Correctness means checking claims against their sources, not re-reading
   prose: every file path, symbol and line against the tree at the stated
   baseline commit; every upstream claim against the pinned clone in `external/`
   (root `CLAUDE.md`, "OpenVTC/TSP upstream clones"); every citation against its
   source text. Prefer a fresh reviewer (a separate agent given only the plan and
   the repo, not your conclusions). Record what was checked, against which
   commits, and what was fixed, in that session's dated companion. The PR that
   adds or substantively changes the plan links that companion (the PR
   template has the checkbox), so a reviewer can see the check was run.
3. **Humanize.** Write or update the overview with the
   `technical-plan-humanizer` skill.
4. **Diagrams and mockups.** Draw the flows and architecture, and the mockups if
   the plan has UI, per the convention below. They are part of the overview but a
   separate step because they need their own check against the precision section
   (every arrow and every string must exist there).
5. **Review.** A human reviews the overview and mockups; an agent or a second
   person reviews the precision section. Findings go in a dated companion, and
   changes they cause start again at step 1 for the sections they touch.

For a revision, steps 3–4 can be limited to the parts of the overview that
summarise the sections changed, but they are not skipped: a stale overview is the
failure this ordering most often produces, because it is read first and changed
last.

### How much checking a plan needs

The completeness and correctness check scales with the plan's size and risk. A
**light check** is enough for a small plan: one with at most about three numbered
sections of design, no external specification it must conform to, and no
security, privacy or migration consequence. A light check still includes, at
minimum: every checklist item below present or marked "not applicable" with a
reason; every file path and symbol checked against the tree at the baseline
commit; every quoted citation checked against its source; and the record in a
dated companion (a small companion is enough). Anything larger, anything with
external constraints, and anything touching keys, credentials, attestation or
stored data gets the full check, preferably by a fresh reviewer.

## Completeness checklist for the precision section

Each item is either present or explicitly marked "not applicable" with a reason.

- [ ] **Baseline.** The commits the plan was measured at (Keyring, bifold, and any
      upstream pins), so "current state" can be re-checked.
- [ ] **Scope and non-goals**, including what the plan does *not* claim.
- [ ] **Current state**, with file paths and symbols at the baseline.
- [ ] **Design**, including data formats, message shapes, state, and error
      behaviour, specific enough to implement without asking.
- [ ] **External constraints** quoted with citations (see "Citing external
      specifications").
- [ ] **Decisions and rejected alternatives** as standing rationale; open
      decisions with pros, cons and a recommendation first (or a plain statement
      that there is none, and why).
- [ ] **Conditional designs** flagged at the point of use.
- [ ] **Security and privacy**: what is exposed, to whom, and the threats
      considered (state "none" only if that is a finding).
- [ ] **Migration and compatibility**: existing data, older app versions, rollout
      and rollback.
- [ ] **UX, when there is UI**: every screen and state including errors, empty and
      loading states, the exact copy (including each screen's header title and
      main action, or that it has none), where each screen sits in the
      navigation (in a tab or above the tabs), and accessibility. The mockups
      are drawn from this, not the other way round.
- [ ] **Steps with acceptance criteria**, each checkable.
- [ ] **Test plan** (below).
- [ ] **Blocked on whom**, and **open questions** with an owner each.

### The test plan

Detailed test guidance lives in the precision section, either per step or in one
`Testing` section the steps reference. For each claim the plan makes, say:

- which tier proves it: unit (jest, which package), a package's own suite, a
  reference rung, simulator/emulator e2e, the lab stack, the VTA Farm, or
  physical phones (`vti-lab-and-field` skill for which claims each can support);
- the command that runs it and where the tests live or will live;
- the negative and failure cases, not only the happy path;
- what only real devices can prove (attestation, BLE, background behaviour), and
  so what simulator runs do **not** show;
- which CI gate or release gate runs it, or that it is run by hand;
- any testing requirements the request, ticket or reviewer asked for, and how
  each is met.

The overview carries a short "How we'll know it works" summary of this, one row
per claim, never more than the precision section says.

## Diagrams and mockups

**Diagrams are Mermaid, inline in the plan.** GitHub and VS Code render fenced
` ```mermaid ` blocks, the source is text that diffs and reviews like the rest of
the plan, and there is no rendered copy to fall out of date. Use `flowchart` for
architecture (what talks to what) and for a person's journey through screens,
`sequenceDiagram` for protocol and ceremony flows, `stateDiagram-v2` for screen and
lifecycle states. ASCII drawings are only for what Mermaid cannot express (byte
layouts, a screen sketched in a companion); existing ASCII diagrams stay until
their plan migrates. Every diagram has a one-sentence caption saying what to look
at, and uses the precision section's names for components and messages. Render
each one before committing; the skill has the offline command and the syntax
traps (`;` and `#` in sequence messages, unquoted brackets in labels).

**Mockups are SVG files in `<plan-name>/mockups/`, drawn with the app's real
theme and component shapes by `scripts/plans/mockup-kit`.** They exist so a
person can review the flow and the words, and they should look like Keyring
while doing it, so a reviewer is not judging a wireframe that the real screen
will contradict.

- **The mechanism.** `scripts/plans/mockup-kit/tokens.ts` holds the theme values
  the app renders (palette, Source Sans 3 sizes, spacing, the gradient header,
  `Button` tiers, `ContactCard`, `RelationshipLayers` rows, the bottom sheet,
  `InfoBox`, the tab bar and its labels), each with an anchor into the real
  source (`app/src/keyring-theme/theme.ts`, `GradientHeaderBackground.tsx`, the
  bifold components and the English strings). Its test fails when
  the source no longer says what the token says. `kit.ts` draws screens from
  fragments named after the components they imitate (`header`, which includes
  the status bar, `tabBar`, `primaryButton`, `secondaryButton`,
  `tertiaryButton`, `cardRow`, `layerRow`, `bottomSheet`, `errorNotice` (an
  `InfoBox` error), `heading`, `body`, `display`, `placeholder`). Notes and the
  legend are wrapped for the widest likely system font, and the kit refuses notes
  that would run into the legend or past the canvas.
- **The app's chrome, or a declared reason.** What makes a screen read as
  Keyring is its header title (centred, white, bold, on the gradient), a filled
  primary button with its shadow for the main action, and the dark tab bar. Each
  mockup accounts for each of the three, and the SVG records how
  (`<!-- mockup-chrome: title=… tabBar=… primary=… -->`):
  - *drawn*, from the plan's copy or the code. The tab bar is drawn only where
    the code puts the screen in a tab: a screen in a stack above the tab
    navigator (`MainStack.tsx`, e.g. `ConnectStack`) has none;
  - *assumed*, when the screen has the element but the plan defines no words
    for it: a stand-in in angle brackets (`<title>`, `<action>`), outlined
    with an orange "assumed" tag and listed in the notes and in an "Assumed in
    these mockups" list under the sheet;
  - *omitted*, declared in the spec's `omits` with the reason, which the notes
    show and the SVG records (`<!-- mockup-omits tabBar: … -->`).

  The kit refuses to render a mockup that does none of these, or a stand-in that
  is not `<…>`, and the checker flags a linked SVG without the record.
- **The contact sheet is what reviewers see; the SVGs are source.** An SVG alone
  may not render correctly in some viewers: in VS Code the mockups were reported
  with no purple at all (header gradient and primary buttons), while the same
  files render correctly in Chromium. So every plan with mockups commits
  `mockups/sheet.png`, one PNG of all its screens side by side with their notes
  and file-name captions in the app's real Source Sans 3 (about 2000 px wide,
  three to a row), and embeds that, not the SVGs:
  `node --experimental-strip-types scripts/plans/mockup-kit/kit.ts sheet
  docs/plans/<plan-name>/mockups` (needs Chromium; `CHROMIUM=` overrides its
  path). It writes `sheet.manifest.json` beside it, recording the sha256 of each
  SVG, the kit's token fingerprint, the sheet layout version and the PNG's own
  hash. The checker compares those hashes, without a browser, and fails a sheet
  that is missing, not embedded, or stale, with the command to regenerate it.
- **Viewers.** The SVGs are still opened as images (GitHub's `<img>`, VS Code's
  Markdown preview, file viewers) by anyone editing them, so they use only
  presentation attributes and SVG 1.1
  features: no `<style>`, CSS variables, `foreignObject`, scripts, links or
  external fonts, and no filter but a Gaussian blur, applied only to a separate
  shadow shape so a viewer without filters loses the shadow, not the shape. The
  kit's test checks every committed mockup for this.
- **One spec per plan.** `<plan-name>/mockups/mockups.ts` lists the screens and
  writes the SVGs: `node --experimental-strip-types
  docs/plans/<plan-name>/mockups/mockups.ts`. Edit the spec, never the SVG.
- **Each SVG names what it uses**: a `<title>` naming the screen and the plan
  section, a `<desc>` and a visible legend listing the components and tokens,
  the theme, and a `mockup-kit tokens:` fingerprint comment.
- **Theme.** Keyring has one theme, light (`app/src/theme.ts`); every mockup
  shows it and says so in its legend. If a dark theme is ever added, the kit
  gains a second token set and each plan states which theme its mockups show, or
  draws both for screens where the difference matters.
- **Fonts.** The SVGs ask for Source Sans 3 and fall back to `system-ui`, since an
  SVG on GitHub cannot load the app's font. The contact sheet (`kit.ts sheet`)
  loads the real font from `app/src/assets/fonts/`.
- **Words.** Every visible string is copied verbatim from the precision section's
  copy for that screen; a mockup never introduces wording. A screen whose copy is
  not defined is not drawn: list it under the mockups as "not drawn, because its
  copy is not defined (§n)". A title or main action whose words are not defined
  is an assumed `<…>` stand-in (above), never invented copy. An existing
  screen's own title (e.g. "Contact Details") is the app's string, taken from a
  token anchored to the localization file. Grey bars (`placeholder`) stand for
  content that is not the subject, never for undefined copy on the subject. Notes beside the
  phone are annotations, not copy, and say where the mockup made a choice the
  plan does not (a button tier, a sheet rather than a screen).
- One file per screen or state, `NN-<screen>[-<state>].svg`, numbered in flow
  order. Self-contained: no scripts, external fonts, images or links.
- In the overview, the sheet is embedded as
  `![Screens 1–N: 1. <caption>; 2. <caption>; …](./<plan-name>/mockups/sheet.png)`,
  with alt text naming every screen (one `;`-separated item per SVG, which the
  checker counts), a one-line caption, and a link to each SVG as its source
  (the template shows the form). The SVGs are not embedded one by one.
- A screen that needs a component the kit lacks gets a new fragment in `kit.ts`,
  with its tokens anchored in `tokens.ts` and a test, in the same change.
- An interactive prototype, when a flow genuinely needs one, is an additional
  self-contained `<plan-name>/mockups/<flow>.html`, linked (not embedded) from
  the overview. The sheet and its SVGs remain the reviewed record, because
  GitHub does not render HTML.

**Maintenance.** A change to the theme or to a component the kit imitates fails
the token test: update `tokens.ts` (and the fragment if the shape changed), then
regenerate every plan's mockups from their specs. The checker flags any linked
mockup whose fingerprint is not the current one, so a stale mockup cannot pass
unnoticed. A change to a screen's copy or states in the precision section
regenerates that plan's mockups in the same commit. **Any change to a mockup,
its spec, the kit or the theme means regenerating the contact sheet
(`kit.ts sheet`) and committing `sheet.png` and `sheet.manifest.json` with the
SVGs**: the sheet is what reviewers see, so a sheet older than its SVGs shows
them the wrong screens, and the checker fails it.

**Keeping them current.** A change to a flow, component name, screen, state or
copy string in the precision section updates the matching diagram or SVG in the
same commit. A superseded mockup is not kept in the folder: the dated companion
that records the change links the old version by commit permalink.

**Dates go on point-in-time artifacts, not on living ones.** A dated companion
records what someone concluded on a day and is never revised afterwards, so the
date is part of its identity. A plan — including a subtask plan — is revised
continuously, so a date in its filename is wrong the moment it is edited, and
worse, it advertises a currency the file may not have.

**One dated file per author per working session, not per topic.** The initials
are of the person or people behind it. A session that produces both a review of
the plan and design decisions for a subtask writes *one* file with two parts —
splitting by topic instead duplicates whatever the two share, and the reader has
no way to tell which file is authoritative on the overlap.

**There is no running changelog, and do not add one.** Three artifacts already
cover the ground: the plan holds current design, the dated documents hold
reasoning with an author's name and a date on it, and `git log` holds the
sequence of edits. A changelog is a fourth thing that duplicates the third
without attribution and the second without argument. If you find yourself writing
"what changed on <date>", write a dated document saying what you concluded and
why instead.

Cross-link them explicitly in the headers — parent → subtask and subtask →
parent. A plan that does not name its companions gets read alone and acted on
alone.

## Every substantive change writes a companion

**Changing a plan — or adding a subplan — is not done until a dated companion
records why.** Write it *with* the change, not afterwards: the argument is
cheapest to capture while it is still live, and batching it up later is how it
gets lost. That is the failure this rule exists to prevent, and the reason the
obligation is on the change rather than on the author's discretion.

- **Same author, same working session → update that day's file.** One file per
  author per session still holds; a second change that afternoon extends the
  morning's document rather than starting a new one.
- **Otherwise → create one**, `<YYYY-MM-DD>-<initials>.md`.
- **Add the pointer to the plan's review index** in the same commit, so the
  companion is reachable from the document it explains. A companion nothing
  links to is a file nobody opens.

**Substantive** means: a new or restructured subplan, a design position adopted
or rejected, a phase's scope or acceptance criteria changed, or an external
constraint that moved under us. Mechanical edits — a typo, a dead link, a
reflow, renumbering a list — do not need one, and demanding a companion for them
devalues the ones that matter.

The content rule is unchanged: state what was concluded, the evidence, and what
position it supersedes. If a change only reverses something you wrote an hour
ago, that still counts — a superseded position of your own is exactly what the
next reader needs, because otherwise the corrected version reads as though it
were obvious from the start.

## Three kinds of content, kept apart

| Kind | Where | Voice |
|---|---|---|
| **Current design** — what we are building and why | the plan | present tense |
| **Reasoning and superseded positions** — why we decided this, what it replaced | a dated, attributed companion | past tense, dated |
| **External constraints** — what a spec requires of us | the plan, or a constraints companion for large sets | quoted, with citation |

The mistake this file exists to prevent is putting change history in the plan.
It accumulates fast, it lands at the top where it is read first, and it is the
least useful content in the document for anyone implementing.

## The test for any note

**Would an implementer with no memory of the conversation make a wrong decision
without this?**

- Yes → it belongs in the plan, as standing rationale.
- It only explains how we got here → it belongs in a dated companion.

Rejected alternatives usually pass this test, which is why "just delete
superseded material" is wrong. If an option is silently removed, the next
implementer re-proposes it, because the reason it fails is exactly the context
that was deleted. Worked example from this directory: an early draft had the
r-card delivered by the same Trust Task as the relationship credential. Delete
that and the design looks obvious again — it is only wrong if you know the r-card
is a verifiable data structure rather than a `DTGCredential` subtype, which is a
fact about an external spec, not about our history.

## Writing the plan

- **Present tense, no revision markers.** No "revised 2026-08-05", no "an earlier
  version of this section said", no pass-by-pass header. Those go in a dated
  companion.
- **A disposition index is not a changelog.** A plan may carry a short map from
  each revision to the review that drove it — that keeps companions discoverable
  from the plan. It must name the companion, not restate what changed.
- **Rejected alternatives stay, rewritten as standing rationale.** State the
  constraint that rules the option out, not the fact that we changed our minds.
  *"RCard does not ride this task: it is a VDS, not a `DTGCredential` subtype
  [quote], so it fails the Base Structure `type` requirement"* is checkable.
  *"An earlier version had RCard sharing this task; corrected"* is not.
- **Every normative constraint carries a citation.** Name the document and the
  section, and quote the operative sentence. An uncited MUST cannot be verified
  at implementation time and will either be ignored or over-applied.
- **Every implementation step carries acceptance criteria.** "Author the specs"
  and "implement layer C" are not actionable — say what makes each done
  (schemas validate against the meta-schema; the witness e2e passes; a credential
  round-trips with its outcome evidence retained). Without this an agent stops
  short or gold-plates, and the gap only surfaces at review.
- **Name what is blocked and on whom.** Distinguish "not decided" from "decided,
  waiting on someone else" — they need different follow-up.
- **Flag conditional designs.** If an approach depends on a decision that has not
  been made, say so at the approach, not only in an open-questions list. A plan
  that quietly assumes its own precondition reads as settled.

## Writing a dated companion

One document, one point in time, one author. Structure it as findings or
decisions — what was concluded, the evidence, and what position it supersedes —
so it can be evidence-checked and adopted or rejected on its own terms.

Preserve superseded reasoning in full. The argument is the point: a conclusion
that moved is cheap to record, but re-deriving why it moved is expensive. When a
proposal is applied, mark it applied rather than deleting it, so the document
reads as current status rather than as a stale snapshot.

A companion has the same two parts as a plan, sized to the companion:

- **`## Summary`** (human section): what was concluded, what it changes in the
  plan, and any decision it asks for and from whom. A diagram or mockup only
  when the companion changes a flow, architecture or screen, and then usually a
  link to the plan's updated one plus the superseded version (copied inline for
  a diagram, a commit permalink for a mockup). It does not re-summarise the
  plan.
- **The findings or decisions** (precision section): each with its evidence,
  citations, the position it supersedes, the plan sections it touches, and its
  effect on the test plan. A session that ran the completeness and correctness
  check records it here: what was checked, at which commits, and what changed.

The human section is always headed `## Summary`, never `## Overview`, and is
never a full overview. How long it is depends on the companion's size:

- **A small companion gets a one-paragraph Summary**, with no diagram, mockup
  or test table. A companion is small when it changes no flow, architecture or
  screen **and** touches at most three numbered sections of the plan: most
  review notes, a precision check that fixed a few claims, a single decision,
  a "plan done" record with few deviations.
- **Any other companion** gets a Summary of up to a few short paragraphs, plus
  the diagram or mockup described above when it changes one.

Write the summary last, with the humanizer skill, as for a plan.

## Implementing a plan: stacked PRs

A plan is implemented as a **stack of PRs**, so a person can review the whole
plan one step at a time, in the order the plan was written.

- **One PR per step.** Each PR implements one reviewable step of the plan's
  steps section (§7 in [`PLAN_TEMPLATE.md`](./PLAN_TEMPLATE.md)), in the plan's
  order. Keep it small; a step too big to review splits into sub-steps, and the
  plan says so.
- **Each PR is based on the previous PR's branch**; the first is based on
  `main`. A PR's diff is then its own step only.
- **The description says where it sits.** It links the plan section it
  implements (path and `§`, at a commit permalink when the plan may move), and
  gives its place in the stack: `Stack: 2 of 5. Base: <branch> (#N), at <sha8>.`,
  plus the PRs above and below it. The `Base:` line is the form already used on
  stacked PRs in this repo (e.g. #931).
- **Checks before opening each PR, and no PR if any fail.** Run, as the change
  needs: `yarn lint`, `yarn prettier` and `yarn typecheck` at the root; the
  tests for what changed (`yarn test`, or the package's own `yarn test` under
  `bifold/packages/*`); and the build the change could break (a native build
  when it touches `app/ios`, `app/android`, native modules or patches). The
  tiers and exact commands are in [`../TESTING.md`](../TESTING.md). Put what
  you ran, and its result, in the PR description (the PR template,
  `.github/pull_request_template.md`, has the stack fields and this
  checklist). Code Quality and Commit Requirements also run on a PR whose base
  is another PR's branch, but the `main` ruleset only blocks merges into
  `main`, so on a mid-stack PR a red check must be fixed before review rather
  than being enforced; see [`../TESTING.md`](../TESTING.md), "Before opening a
  PR".
- **A plan-only PR runs no app tests locally.** A PR whose changed files are all
  plans and their assets (Markdown, and the `mockups/` SVG, PNG and manifest,
  under `docs/`) skips the lint, prettier, typecheck, build and jest steps
  above: nothing they check has changed. Run the structure checker
  (`node --experimental-strip-types scripts/plans/check-plans.ts`) and, if a
  mockup changed, regenerate and commit its sheet. CI is the check for the
  rest: Code Quality still runs on the PR. The `pre-push` hook runs the whole
  `yarn test` regardless, so push such a PR with `git push --no-verify`; that
  skips only the push hook, and the commit hooks and signing still apply. A PR
  that also changes anything outside `docs/` (a script, a workflow, app or
  bifold code) is not plan-only and follows the checks above.
- **Heavy operations follow the shared-machine rules** in `/srv/dev/CLAUDE.md`
  ("Heavy operations", "Disk space in /var/tmp"): check memory and CPU first,
  run `vartmp-tidy check`, and prefix builds, tests and typechecks with
  `nice -n 10`.
- **Commits** follow the root `CLAUDE.md` "Commit conventions" (conventional
  commits, signed, `Signed-off-by:`). A step that changes `bifold/packages/*`
  is a paired PR in `keyring-bifold`, with its own sign-off rules there and the
  order in [`release-flow-plan.md`](./release-flow-plan.md) §5 (bifold merges
  first; the wallet PR bumps the pin).
- **Hot fixes are exempt.** A hot fix goes straight to its own PR against
  the branch it fixes (`main`, or a `hotfix/*` branch), without a plan or a
  stack.

**When a lower PR merges.** The repos do not delete branches on merge, so
GitHub does not retarget the PR above it; do it by hand. Merge bottom-up.
After PR 1 merges into `main`:

```sh
git fetch origin
git rebase --onto origin/main <PR-1 branch tip before merge> <PR-2 branch>
git push --force-with-lease origin <PR-2 branch>
gh pr edit <PR-2> --base main
```

`--onto` drops PR 1's commits, which are already on `main` (they arrive with new
hashes when PR 1 was squash-merged, and a plain rebase would replay them). Then
update PR 2's `Base:` line, and do the same for each PR above it, each onto its
new base. The alternative also used here, merging each PR into a long-lived
feature branch and that branch into `main` once (the `feat/sedi-state-office`
stack), needs no retargeting but leaves one large final merge; use it only when
the steps cannot reach `main` one at a time.

### When the plan is done

A plan is done when the last PR of its stack
merges, and that PR (or one straight after it) does two things:

- updates the plan's `**Status:**` line, and its row in
  [`README.md`](./README.md), to `Implemented`, naming the merged PRs; and
- records every deviation from the plan in a dated companion: each step that
  was built differently, cut, split or deferred, with the reason and the PR,
  and the precision section updated to describe what was built (the plan
  states current design). If nothing deviated, the companion says so in one
  line; it is a small companion.

Until both are in, the plan is "Accepted, building", however much has merged.

## Checking a plan's structure

`scripts/plans/check-plans.ts` checks the mechanical parts of the two-part
format, so a reviewer can spend their time on the content:

- **Plans and subtask plans:** one `## Overview`, unnumbered, as the first `##`
  heading, closed by a `---` rule; every `##` after it numbered `## 1.`, `## 2.`,
  … without gaps (a trailing `## Appendix …` is allowed); every local `§N`,
  `§N.M` or range `§N–§M` resolves to a heading carrying that number in the same
  file.
- **Dated companions:** `## Summary` is the first `##` heading. Their bare `§`
  references mean the parent plan's and are not resolved.
- **Both:** the part markers and banners ("Telling the two parts apart"); no
  bare `§` on a line that also names another document (below); every
  ` ```mermaid ` block is non-empty and opens with a diagram type (`flowchart`,
  `sequenceDiagram`, `stateDiagram-v2`, …); every relative image, `.svg` or
  `mockups/` path exists, every linked mockup carries the current
  `mockup-kit tokens:` fingerprint, and it records its header title, tab bar
  and primary button as drawn, assumed or omitted with a reason. A file that
  links a `mockups/` folder (an SVG or the sheet) embeds that folder's
  `sheet.png` with alt text naming each screen, links every SVG in it, and its
  `sheet.manifest.json` matches the SVGs' hashes, the token fingerprint and the
  sheet layout; otherwise it fails with the regeneration command. This is a
  hash compare: the check needs no browser, and regenerating is a local step.

**Which files it checks.** A plan or subtask plan is checked once it has a
`## Overview` heading, which is exactly what migrating it adds; a dated
companion is checked when its date is 2026-11-20 or later. Every other file
under `docs/plans/` is legacy and skipped, as are this file, `README.md` and
`PLAN_TEMPLATE.md`. So the checker never fails an unmigrated plan.

**§ references to other documents.** A `§` is read as another document's when
what comes right before it is a link, a code span, a file name (`*.md`), a name
ending in `-plan` or `_subtask`, an RFC, or a version number, or when "there" or
"of <document>" follows it: `[release-flow-plan.md](./release-flow-plan.md) §5`,
`locality-plan §2.1`, `framework 0.3 §7.3`, `RFC 9110 §15`, `§5.3 there`. A line
break between the name and the `§` does not matter. A range or list continues
the first reference's document: `locality-plan.md §5.1–§5.4` and
`locality-plan §9.1, §9.2` are all the locality plan's.

A bare `§N` means this file (in a companion, the parent plan), **except that it
is an error on a line that also names another document**, because a reader
cannot tell which one it means. Write it explicitly: the other document's as
`locality-plan §2.1`, this file's as "this plan's §2" (or "§2 of this plan",
"§2 here", "§2 above"), and in a companion the parent's as "plan §2". The plan's
own name and its companion folder do not count as another document.

It does not check that mockup text matches the plan's copy; the humanizer
self-check covers that.

```sh
node --experimental-strip-types scripts/plans/check-plans.ts            # all of docs/plans/
node --experimental-strip-types scripts/plans/check-plans.ts <file.md>  # one file
node --experimental-strip-types --test scripts/plans/check-plans.test.ts scripts/plans/mockup-kit/*.test.ts
```

It needs Node 22.6 or later (the app's Node 20 cannot strip types), or
`bun scripts/plans/check-plans.ts`. CI runs it as **Plan structure**
(`.github/workflows/plans.yml`) on PRs touching `docs/plans/**`; it is not a
required check.

## Existing plans

Plans written before this structure migrate **on their next substantive edit**
(as defined above), not in a bulk rewrite: that edit adds the overview and the
part markers, and fills checklist gaps in the sections it touches.

**Where things go when a plan migrates, without renumbering.** Existing numbered
sections keep their numbers, because other plans and companions cite them.
Anything that sat above the old first section (a dependency table, a review
index, a scope paragraph, a pass-by-pass header) moves to the **end** of the
precision section as new numbered sections after the last existing one, in the
template's order: blocked-on-whom, then open questions, then reviews. Scope and
non-goal prose merges into the existing section 1 if it has a scope section,
otherwise it also becomes a new last section. Nothing is inserted before an
existing number. Record the moves in the migration's dated companion, so links
to the old positions can be followed. Existing dated companions are point-in-time records and are
never retrofitted; new ones (dated 2026-11-20 or later) follow the two-part
form.

## Citing external specifications

Cite **by name with a pinned `MAJOR.MINOR`**, not by item ordinal. Ordinals shift
when a spec adds requirements, and nothing in anyone's CI guards them — the Trust
Tasks framework moved its §7.3 item numbering between 0.2 and 0.3, which silently
invalidates any citation written as "§7.3 item 8". Prefer *"the proof-requirement
declaration (framework 0.3)"*.

Where a plan depends on more than a handful of external requirements, extract
them into a constraints companion: quotes and citations only, no design. That
half is stable while the design churns, and it lets conformance be checked
without re-reading the source specs.
